package com.yekta.wpmanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Arrays;
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
        list.setOnItemClickListener((parent, view, position, id) -> showPostDialog(adapter.getItem(position)));
        findViewById(R.id.settingsButton).setOnClickListener(v -> showSettings());
        findViewById(R.id.searchButton).setOnClickListener(v -> loadPosts());
        findViewById(R.id.addButton).setOnClickListener(v -> showPostDialog(new Post()));

        if (secureStore.load().isComplete()) loadPosts(); else showSettings();
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
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
            .setPositiveButton("ذخیره و تست", null)
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
        if (!credentials.isComplete()) { showSettings(); return; }
        final String search = searchInput.getText().toString();
        setLoading(true);
        executor.execute(() -> {
            try {
                List<Post> posts = client(credentials).listPosts(search);
                runOnUiThread(() -> {
                    adapter.replace(posts);
                    emptyView.setVisibility(posts.isEmpty() ? View.VISIBLE : View.GONE);
                    setLoading(false);
                });
            } catch (Exception e) { runOnUiThread(() -> { setLoading(false); toast(error(e)); }); }
        });
    }

    private void showPostDialog(Post post) {
        View view = LayoutInflater.from(this).inflate(R.layout.dialog_post, null);
        EditText title = view.findViewById(R.id.postTitle);
        EditText slug = view.findViewById(R.id.postSlug);
        EditText excerpt = view.findViewById(R.id.postExcerpt);
        EditText content = view.findViewById(R.id.postContent);
        Spinner status = view.findViewById(R.id.postStatus);
        List<String> statusLabels = Arrays.asList("پیش‌نویس", "منتشرشده", "در انتظار بررسی", "خصوصی");
        List<String> statusValues = Arrays.asList("draft", "publish", "pending", "private");
        status.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, statusLabels));
        int statusIndex = statusValues.indexOf(post.status);
        status.setSelection(statusIndex >= 0 ? statusIndex : 0);
        title.setText(post.title); slug.setText(post.slug); excerpt.setText(post.excerpt); content.setText(post.content);

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle(post.id > 0 ? "ویرایش مقاله" : "مقاله جدید")
            .setView(view)
            .setNegativeButton("لغو", null)
            .setPositiveButton("ذخیره", null);
        if (post.id > 0) builder.setNeutralButton("انتقال به زباله‌دان", null);
        AlertDialog dialog = builder.create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                if (title.getText().toString().trim().isEmpty()) { toast("عنوان مقاله الزامی است."); return; }
                post.title = title.getText().toString().trim();
                post.slug = slug.getText().toString().trim();
                post.excerpt = excerpt.getText().toString();
                post.content = content.getText().toString();
                post.status = statusValues.get(status.getSelectedItemPosition());
                savePost(dialog, post);
            });
            if (post.id > 0) dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> confirmTrash(dialog, post));
        });
        dialog.show();
    }

    private void savePost(AlertDialog dialog, Post post) {
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
        executor.execute(() -> {
            try {
                client(secureStore.load()).save(post);
                runOnUiThread(() -> { dialog.dismiss(); toast("مقاله ذخیره شد."); loadPosts(); });
            } catch (Exception e) { runOnUiThread(() -> { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true); toast(error(e)); }); }
        });
    }

    private void confirmTrash(AlertDialog editor, Post post) {
        new AlertDialog.Builder(this)
            .setMessage("مقاله به زباله‌دان منتقل شود؟")
            .setNegativeButton("خیر", null)
            .setPositiveButton("بله", (d, w) -> executor.execute(() -> {
                try {
                    client(secureStore.load()).trash(post.id);
                    runOnUiThread(() -> { editor.dismiss(); toast("مقاله به زباله‌دان منتقل شد."); loadPosts(); });
                } catch (Exception e) { runOnUiThread(() -> toast(error(e))); }
            }))
            .show();
    }

    private WordPressClient client(SecureStore.Credentials credentials) {
        return new WordPressClient(credentials.site, credentials.username, credentials.password);
    }
    private void setLoading(boolean loading) { progress.setVisibility(loading ? View.VISIBLE : View.GONE); }
    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private String error(Exception e) { return e.getMessage() == null ? "خطای نامشخص" : e.getMessage(); }
}
