package com.shiguang.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 把自己下载好的 APK 以 content:// 交给系统安装器。
 * 不依赖 androidX 的 FileProvider，功能一样：只读、只暴露当前这一个文件。
 */
public class ApkProvider extends ContentProvider {

    static final String AUTHORITY = "com.shiguang.app.apk";
    static final Uri CONTENT = Uri.parse("content://" + AUTHORITY + "/update.apk");

    private static volatile File current;

    static void setFile(File f) {
        current = f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = current;
        if (f == null || !f.exists() || f.length() <= 0) {
            throw new FileNotFoundException("安装包不存在");
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
