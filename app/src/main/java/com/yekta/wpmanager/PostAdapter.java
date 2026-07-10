package com.yekta.wpmanager;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

public final class PostAdapter extends BaseAdapter {
    private final LayoutInflater inflater;
    private final List<Post> posts = new ArrayList<>();

    public PostAdapter(Context context) { inflater = LayoutInflater.from(context); }
    public void replace(List<Post> values) { posts.clear(); posts.addAll(values); notifyDataSetChanged(); }
    @Override public int getCount() { return posts.size(); }
    @Override public Post getItem(int position) { return posts.get(position); }
    @Override public long getItemId(int position) { return getItem(position).id; }

    @Override public View getView(int position, View convertView, ViewGroup parent) {
        View view = convertView != null ? convertView : inflater.inflate(R.layout.item_post, parent, false);
        Post post = getItem(position);
        ((TextView) view.findViewById(R.id.itemTitle)).setText(post.title.isEmpty() ? "بدون عنوان" : post.title);
        ((TextView) view.findViewById(R.id.itemMeta)).setText(statusLabel(post.status) + " • " + post.modified.replace("T", " "));
        return view;
    }

    private String statusLabel(String status) {
        switch (status) {
            case "publish": return "منتشرشده";
            case "pending": return "در انتظار بررسی";
            case "private": return "خصوصی";
            case "future": return "زمان‌بندی‌شده";
            default: return "پیش‌نویس";
        }
    }
}
