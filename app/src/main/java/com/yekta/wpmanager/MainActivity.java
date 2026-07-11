package com.yekta.wpmanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SecureStore secureStore;
    private PostAdapter adapter;
    private ProgressBar progress;
    private TextView emptyView;
    private EditText searchInput;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        secureStore = new SecureStore(this);
        adapter = new PostAdapter(this);
        progress = findViewById(R.id.progress);
        emptyView = findViewById(R.id.emptyView);
        searchInput = findViewById(R.id.searchInput);
        ListView list = findViewById(R.id.postsList);
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> openGutenberg(adapter.getItem(position).id));
        findViewById(R.id.settingsButton).setOnClickListener(v -> showSettings());
        findViewById(R.id.searchButton).setOnClickListener(v -> loadPosts());
        findViewById(R.id.addButton).setOnClickListener(v -> openGutenberg(0));

        if (secureStore.load().isComplete()) loadPosts(); else showSettings();
    }

    @Override protected void onResume() {
        super.onResume();
        if (secureStore != null && secureStore.load().isComplete()) loadPosts();
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void openGutenberg(int postId) {
        SecureStore.Credentials credentials = secureStore.load();
        if (!credentials.isComplete()) { showSettings(); return; }
        Intent intent = new Intent(this, GutenbergActivity.class);
        intent.putExtra(GutenbergActivity.EXTRA_SITE_URL, credentials.site);
        intent.putExtra(GutenbergActivity.EXTRA_POST_ID, postId);
        startActivity(intent);
    }

    private void showSettings() {
        View view = LayoutInflater.from(this).inflate(R.layout.dialog_settings, null);
        EditText site = view.findViewById(R.id.siteUrl);
        EditText username = view.findViewById(R.id.username);
        EditText password = view.findViewById(R.id.appPassword);
        SecureStore.Credentials current = secureStore.load();
        site.setText(current.site); username.setText(current.username); password.setText(current.password);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setView(view)
            .setNegativeButton("لغو", null)
            .setPositiveButton("ذخیره", null)
            .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String s = site.getText().toString().trim();
            String u = username.getText().toString().trim();
            String p = password.getText().toString().trim();
            if (TextUtils.isEmpty(s) || TextUtils.isEmpty(u) || TextUtils.isEmpty(p)) {
                toast("هر سه فیلد الزامی است."); return;
            }
            try {
                new WordPressClient(s, u, p);
                secureStore.save(s, u, p);
                dialog.dismiss();
                loadPosts();
            } catch (Exception e) { toast(error(e)); }
        }));
        dialog.show();
    }

    private void loadPosts() {
        SecureStore.Credentials credentials = secureStore.load();
        if (!credentials.isComplete()) return;
        final String search = searchInput.getText().toString();
        setLoading(true);
        executor.execute(() -> {
            try {
                List<Post> posts = new WordPressClient(credentials.site, credentials.username, credentials.password).listPosts(search);
                runOnUiThread(() -> {
                    adapter.replace(posts);
                    emptyView.setVisibility(posts.isEmpty() ? View.VISIBLE : View.GONE);
                    setLoading(false);
                });
            } catch (Exception e) { runOnUiThread(() -> { setLoading(false); toast(error(e)); }); }
        });
    }

    private void setLoading(boolean loading) { progress.setVisibility(loading ? View.VISIBLE : View.GONE); }
    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private String error(Exception e) { return e.getMessage() == null ? "خطای نامشخص" : e.getMessage(); }
}
