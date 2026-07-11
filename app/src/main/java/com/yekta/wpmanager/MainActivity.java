package com.yekta.wpmanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean loading = new AtomicBoolean(false);
    private SecureStore secureStore;
    private PostAdapter adapter;
    private ProgressBar progress;
    private TextView emptyView;
    private TextView postCount;
    private TextView syncStatus;
    private EditText searchInput;
    private View addButton;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        secureStore = new SecureStore(this);
        adapter = new PostAdapter(this);
        progress = findViewById(R.id.progress);
        emptyView = findViewById(R.id.emptyView);
        postCount = findViewById(R.id.postCount);
        syncStatus = findViewById(R.id.syncStatus);
        searchInput = findViewById(R.id.searchInput);
        addButton = findViewById(R.id.addButton);

        ListView list = findViewById(R.id.postsList);
        list.setAdapter(adapter);
        list.setEmptyView(emptyView);
        list.setOnItemClickListener((parent, view, position, id) -> openGutenberg(adapter.getItem(position).id));

        findViewById(R.id.settingsButton).setOnClickListener(v -> showSettings());
        findViewById(R.id.searchButton).setOnClickListener(v -> loadPosts());
        addButton.setOnClickListener(v -> createDraftAndOpen());
        searchInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                loadPosts();
                return true;
            }
            return false;
        });

        if (secureStore.load().isComplete()) loadPosts(); else showSettings();
    }

    @Override protected void onResume() {
        super.onResume();
        if (secureStore != null && secureStore.load().isComplete() && !loading.get()) loadPosts();
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void createDraftAndOpen() {
        SecureStore.Credentials credentials = secureStore.load();
        if (!credentials.isComplete()) { showSettings(); return; }
        setLoading(true, "در حال ساخت پیش‌نویس…");
        addButton.setEnabled(false);
        executor.execute(() -> {
            try {
                Post draft = new WordPressClient(credentials.site, credentials.username, credentials.password).createDraft();
                runOnUiThread(() -> {
                    addButton.setEnabled(true);
                    setLoading(false, "پیش‌نویس ساخته شد");
                    openGutenberg(draft.id);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    addButton.setEnabled(true);
                    setLoading(false, "ساخت پیش‌نویس ناموفق بود");
                    showCreationError(e);
                });
            }
        });
    }

    private void openGutenberg(int postId) {
        SecureStore.Credentials credentials = secureStore.load();
        if (!credentials.isComplete()) { showSettings(); return; }
        String base = credentials.site.replaceAll("/+$", "");
        String url = postId > 0
            ? base + "/wp-admin/post.php?post=" + postId + "&action=edit"
            : base + "/wp-admin/post-new.php";
        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(browser);
        } catch (ActivityNotFoundException e) {
            Intent fallback = new Intent(this, GutenbergActivity.class);
            fallback.putExtra(GutenbergActivity.EXTRA_SITE_URL, credentials.site);
            fallback.putExtra(GutenbergActivity.EXTRA_POST_ID, postId);
            startActivity(fallback);
        }
    }

    private void showCreationError(Exception e) {
        new AlertDialog.Builder(this)
            .setTitle("درج مقاله انجام نشد")
            .setMessage(error(e) + "\n\nمی‌توانی صفحه افزودن وردپرس را مستقیم باز کنی.")
            .setNegativeButton("بستن", null)
            .setPositiveButton("باز کردن صفحه افزودن", (dialog, which) -> openGutenberg(0))
            .show();
    }

    private void showSettings() {
        View view = LayoutInflater.from(this).inflate(R.layout.dialog_settings, null);
        EditText site = view.findViewById(R.id.siteUrl);
        EditText username = view.findViewById(R.id.username);
        EditText password = view.findViewById(R.id.appPassword);
        SecureStore.Credentials current = secureStore.load();
        site.setText(current.site); username.setText(current.username); password.setText(current.password);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("اتصال به وردپرس")
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
        if (!credentials.isComplete() || !loading.compareAndSet(false, true)) return;
        final String search = searchInput.getText().toString();
        setLoadingUi(true, "در حال همگام‌سازی…");
        executor.execute(() -> {
            try {
                List<Post> posts = new WordPressClient(credentials.site, credentials.username, credentials.password).listPosts(search);
                runOnUiThread(() -> {
                    adapter.replace(posts);
                    postCount.setText(posts.size() + " مقاله");
                    syncStatus.setText("همگام‌سازی انجام شد");
                    loading.set(false);
                    setLoadingUi(false, null);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loading.set(false);
                    syncStatus.setText("خطا در همگام‌سازی");
                    setLoadingUi(false, null);
                    toast(error(e));
                });
            }
        });
    }

    private void setLoading(boolean value, String status) {
        loading.set(value);
        setLoadingUi(value, status);
    }

    private void setLoadingUi(boolean value, String status) {
        progress.setVisibility(value ? View.VISIBLE : View.GONE);
        if (status != null) syncStatus.setText(status);
    }

    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private String error(Exception e) { return e.getMessage() == null ? "خطای نامشخص" : e.getMessage(); }
}
