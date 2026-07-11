package com.yekta.wpmanager;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.URI;

public final class GutenbergActivity extends Activity {
    public static final String EXTRA_SITE_URL = "site_url";
    public static final String EXTRA_POST_ID = "post_id";
    private static final int FILE_CHOOSER_REQUEST = 7001;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private String allowedHost;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);

        String siteUrl = getIntent().getStringExtra(EXTRA_SITE_URL);
        int postId = getIntent().getIntExtra(EXTRA_POST_ID, 0);
        if (siteUrl == null || !siteUrl.startsWith("https://")) {
            finish();
            return;
        }

        try { allowedHost = new URI(siteUrl).getHost(); }
        catch (Exception e) { finish(); return; }

        webView = new WebView(this);
        setContentView(webView);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " WPArticleManager/1.1");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent;
                try { intent = params.createIntent(); }
                catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("https".equalsIgnoreCase(uri.getScheme()) && host != null && sameSite(host, allowedHost)) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });

        String base = siteUrl.replaceAll("/+$", "");
        String target = postId > 0
            ? base + "/wp-admin/post.php?post=" + postId + "&action=edit"
            : base + "/wp-admin/post-new.php";
        webView.loadUrl(target);
    }

    private boolean sameSite(String a, String b) {
        return a.equalsIgnoreCase(b)
            || a.equalsIgnoreCase("www." + b)
            || b.equalsIgnoreCase("www." + a);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
