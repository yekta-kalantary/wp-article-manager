package com.yekta.wpmanager;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class WordPressClient {
    private final String baseUrl;
    private final String authorization;

    public WordPressClient(String siteUrl, String username, String appPassword) {
        String normalized = siteUrl.trim().replaceAll("/+$", "");
        if (!normalized.startsWith("https://")) {
            throw new IllegalArgumentException("آدرس سایت باید با https:// شروع شود.");
        }
        baseUrl = normalized + "/wp-json/wp/v2";
        String raw = username.trim() + ":" + appPassword.replace(" ", "");
        authorization = "Basic " + Base64.encodeToString(raw.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    public List<Post> listPosts(String search) throws Exception {
        String endpoint = "/posts?context=edit&per_page=50&orderby=modified&order=desc&status=publish,draft,pending,private,future";
        if (search != null && !search.trim().isEmpty()) endpoint += "&search=" + java.net.URLEncoder.encode(search.trim(), "UTF-8");
        JSONArray array = new JSONArray(request("GET", endpoint, null));
        List<Post> posts = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) posts.add(parse(array.getJSONObject(i)));
        return posts;
    }

    public Post save(Post post) throws Exception {
        JSONObject body = new JSONObject();
        body.put("title", post.title);
        body.put("content", post.content);
        body.put("excerpt", post.excerpt);
        body.put("status", post.status);
        if (post.slug != null && !post.slug.trim().isEmpty()) body.put("slug", post.slug.trim());
        String path = post.id > 0 ? "/posts/" + post.id : "/posts";
        return parse(new JSONObject(request("POST", path, body.toString())));
    }

    public void trash(int id) throws Exception {
        request("DELETE", "/posts/" + id, null);
    }

    private Post parse(JSONObject object) throws Exception {
        Post post = new Post();
        post.id = object.getInt("id");
        post.slug = object.optString("slug", "");
        post.status = object.optString("status", "draft");
        post.modified = object.optString("modified", "");
        post.title = object.optJSONObject("title") != null ? object.getJSONObject("title").optString("raw", object.getJSONObject("title").optString("rendered", "")) : "";
        post.content = object.optJSONObject("content") != null ? object.getJSONObject("content").optString("raw", object.getJSONObject("content").optString("rendered", "")) : "";
        post.excerpt = object.optJSONObject("excerpt") != null ? object.getJSONObject("excerpt").optString("raw", object.getJSONObject("excerpt").optString("rendered", "")) : "";
        return post;
    }

    private String request(String method, String path, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("Authorization", authorization);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        if (body != null) {
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        String response = read(stream);
        connection.disconnect();
        if (code < 200 || code >= 300) {
            String message = "خطای وردپرس (" + code + ")";
            try { message = new JSONObject(response).optString("message", message); } catch (Exception ignored) {}
            throw new IllegalStateException(message);
        }
        return response;
    }

    private String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
