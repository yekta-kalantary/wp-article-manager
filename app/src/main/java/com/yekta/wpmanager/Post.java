package com.yekta.wpmanager;

public final class Post {
    public int id;
    public String title = "";
    public String content = "";
    public String excerpt = "";
    public String slug = "";
    public String status = "draft";
    public String modified = "";

    @Override public String toString() { return title; }
}
