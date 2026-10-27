package com.shiguang.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Size;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 相册索引：把系统 MediaStore 里的照片和视频读成一份按时间倒序的清单，
 * 并按需生成缩略图（磁盘缓存）。全部只读，不修改用户的任何文件。
 */
public class MediaRepo {

    public static final int TYPE_IMAGE = 1;
    public static final int TYPE_VIDEO = 2;

    public static class Item {
        public long id;
        public String name = "";
        public long ts;         // 毫秒
        public int type;        // 1 照片 / 2 视频
        public int w, h;
        public long dur;        // 毫秒，视频
        public long size;       // 字节
        public String mime = "";
        public String bucket = "";
        public String uri = "";
    }

    private final Context ctx;
    private final ContentResolver cr;
    private final File thumbDir;
    private final List<Item> items = new ArrayList<>();
    private final Map<Long, Item> byId = new HashMap<>();
    private volatile boolean loaded = false;
    private volatile long buildMs = 0;

    public MediaRepo(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.cr = this.ctx.getContentResolver();
        this.thumbDir = new File(this.ctx.getCacheDir(), "thumbs");
        if (!thumbDir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            thumbDir.mkdirs();
        }
    }

    public File thumbDir() {
        return thumbDir;
    }

    public synchronized void invalidate() {
        loaded = false;
        items.clear();
        byId.clear();
    }

    public boolean isLoaded() {
        return loaded;
    }

    public long buildMs() {
        return buildMs;
    }

    // ------------------------------------------------------------------ 索引

    private void ensure() {
        if (loaded) return;
        long t0 = System.currentTimeMillis();
        items.clear();
        byId.clear();

        List<Item> out = new ArrayList<>();
        queryInto(out, TYPE_IMAGE);
        queryInto(out, TYPE_VIDEO);

        Collections.sort(out, new Comparator<Item>() {
            @Override
            public int compare(Item a, Item b) {
                if (a.ts != b.ts) return Long.compare(b.ts, a.ts);
                return Long.compare(b.id, a.id);
            }
        });

        for (Item it : out) {
            it.uri = uriFor(it).toString();
            items.add(it);
            byId.put(it.id, it);
        }
        buildMs = System.currentTimeMillis() - t0;
        loaded = true;
    }

    /**
     * 照片和视频分开查：老机型上 MediaStore.Files 视图不一定有 duration / width 这些列，
     * 一次合并查询很容易整条 query 直接抛错、导致整个相册读不出来。
     */
    private void queryInto(List<Item> out, int type) {
        boolean modern = Build.VERSION.SDK_INT >= 29;
        Uri base = type == TYPE_VIDEO
                ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;

        List<String> proj = new ArrayList<>(Arrays.asList(
                "_id", "_display_name", "date_taken", "date_modified", "date_added",
                "width", "height", "_size", "mime_type"));
        if (type == TYPE_VIDEO) proj.add("duration");
        if (modern) proj.add("bucket_display_name");

        StringBuilder sel = new StringBuilder();
        if (modern) sel.append("is_pending=0");
        if (type == TYPE_VIDEO && Build.VERSION.SDK_INT >= 30) {
            if (sel.length() > 0) sel.append(" AND ");
            sel.append("is_trashed=0");
        }

        Cursor c = null;
        try {
            c = cr.query(base, proj.toArray(new String[0]),
                    sel.length() > 0 ? sel.toString() : null, null, "date_modified DESC");
            readRows(c, out, type);
            return;
        } catch (Throwable ignored) {
            // 落到下面的最小列表重试
        } finally {
            if (c != null) try { c.close(); } catch (Throwable ignored) { }
        }

        try {
            List<String> p2 = new ArrayList<>(Arrays.asList(
                    "_id", "_display_name", "date_modified", "_size", "mime_type"));
            if (type == TYPE_VIDEO) p2.add("duration");
            c = cr.query(base, p2.toArray(new String[0]), null, null, "date_modified DESC");
            readRows(c, out, type);
        } catch (Throwable ignored) {
        } finally {
            if (c != null) try { c.close(); } catch (Throwable ignored) { }
        }
    }

    private void readRows(Cursor c, List<Item> out, int type) {
        if (c == null) return;
        int iId = c.getColumnIndex("_id");
        if (iId < 0) return;
        int iName = c.getColumnIndex("_display_name");
        int iTaken = c.getColumnIndex("date_taken");
        int iMod = c.getColumnIndex("date_modified");
        int iAdd = c.getColumnIndex("date_added");
        int iW = c.getColumnIndex("width");
        int iH = c.getColumnIndex("height");
        int iSize = c.getColumnIndex("_size");
        int iMime = c.getColumnIndex("mime_type");
        int iDur = c.getColumnIndex("duration");
        int iBucket = c.getColumnIndex("bucket_display_name");

        while (c.moveToNext()) {
            Item it = new Item();
            it.id = c.getLong(iId);
            it.type = type;
            it.name = iName >= 0 && !c.isNull(iName) ? c.getString(iName) : "未命名";
            if (it.name.isEmpty()) it.name = "未命名";

            long taken = iTaken >= 0 && !c.isNull(iTaken) ? c.getLong(iTaken) : 0L;
            long mod = iMod >= 0 && !c.isNull(iMod) ? c.getLong(iMod) : 0L;
            long add = iAdd >= 0 && !c.isNull(iAdd) ? c.getLong(iAdd) : 0L;
            if (taken > 0) it.ts = taken;
            else if (add > 0) it.ts = add * 1000L;
            else it.ts = mod * 1000L;
            if (it.ts <= 0) continue;

            it.w = iW >= 0 ? c.getInt(iW) : 0;
            it.h = iH >= 0 ? c.getInt(iH) : 0;
            it.size = iSize >= 0 ? c.getLong(iSize) : 0L;
            it.dur = iDur >= 0 && !c.isNull(iDur) ? c.getLong(iDur) : 0L;
            it.mime = iMime >= 0 && !c.isNull(iMime) ? c.getString(iMime) : "";
            it.bucket = iBucket >= 0 && !c.isNull(iBucket) ? c.getString(iBucket) : "";
            out.add(it);
        }
    }

    public static Uri uriFor(Item it) {
        Uri base = it.type == TYPE_VIDEO
                ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        return ContentUris.withAppendedId(base, it.id);
    }

    public synchronized int size() {
        ensure();
        return items.size();
    }

    public synchronized List<Item> all() {
        ensure();
        return items;
    }

    public synchronized Item byId(long id) {
        ensure();
        return byId.get(id);
    }

    public synchronized int[] counts() {
        ensure();
        int img = 0, vid = 0;
        long photoBytes = 0, videoBytes = 0;
        for (Item it : items) {
            if (it.type == TYPE_VIDEO) { vid++; videoBytes += it.size; }
            else { img++; photoBytes += it.size; }
        }
        return new int[]{img, vid};
    }

    public synchronized long[] rangeTs() {
        ensure();
        if (items.isEmpty()) return new long[]{0, 0};
        long max = items.get(0).ts, min = items.get(items.size() - 1).ts;
        for (Item it : items) {
            if (it.ts > max) max = it.ts;
            if (it.ts < min) min = it.ts;
        }
        return new long[]{min, max};
    }

    /** 按月统计，供时间线右侧刻度使用：[year, month(1-12), count] */
    public synchronized List<int[]> months() {
        ensure();
        Map<Long, int[]> m = new LinkedHashMap<>();
        for (Item it : items) {
            java.util.Calendar c = java.util.Calendar.getInstance();
            c.setTimeInMillis(it.ts);
            int y = c.get(java.util.Calendar.YEAR);
            int mo = c.get(java.util.Calendar.MONTH) + 1;
            long key = y * 100L + mo;
            int[] v = m.get(key);
            if (v == null) {
                v = new int[]{y, mo, 0};
                m.put(key, v);
            }
            v[2]++;
        }
        return new ArrayList<>(m.values());
    }

    // ------------------------------------------------------------------ JSON

    static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
                    else b.append(ch);
            }
        }
        return b.toString();
    }

    private static void itemJson(StringBuilder sb, Item it) {
        sb.append("{\"id\":").append(it.id)
          .append(",\"n\":\"").append(esc(it.name)).append('"')
          .append(",\"t\":").append(it.ts)
          .append(",\"k\":").append(it.type)
          .append(",\"w\":").append(it.w)
          .append(",\"h\":").append(it.h)
          .append(",\"d\":").append(it.dur)
          .append(",\"s\":").append(it.size)
          .append(",\"m\":\"").append(esc(it.mime)).append('"')
          .append(",\"b\":\"").append(esc(it.bucket)).append('"')
          .append('}');
    }

    /** 分页取条目；offset 越界时返回空数组（JS 用它判断读完）。 */
    public synchronized String page(int offset, int limit, String filter) {
        ensure();
        if (limit <= 0 || limit > 2000) limit = 400;
        StringBuilder sb = new StringBuilder(64 + limit * 180);
        sb.append('[');
        int n = 0;
        int i = Math.max(0, offset);
        while (i < items.size() && n < limit) {
            Item it = items.get(i++);
            if ("image".equals(filter) && it.type != TYPE_IMAGE) continue;
            if ("video".equals(filter) && it.type != TYPE_VIDEO) continue;
            if (n > 0) sb.append(',');
            itemJson(sb, it);
            n++;
        }
        sb.append(']');
        return sb.toString();
    }

    public synchronized String statsJson() {
        ensure();
        int img = 0, vid = 0;
        long bytes = 0;
        for (Item it : items) {
            if (it.type == TYPE_VIDEO) vid++; else img++;
            bytes += it.size;
        }
        long[] r = rangeTs();
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\"count\":").append(items.size())
          .append(",\"images\":").append(img)
          .append(",\"videos\":").append(vid)
          .append(",\"bytes\":").append(bytes)
          .append(",\"minTs\":").append(r[0])
          .append(",\"maxTs\":").append(r[1])
          .append(",\"buildMs\":").append(buildMs)
          .append(",\"months\":[");
        List<int[]> ms = months();
        for (int i = 0; i < ms.size(); i++) {
            int[] v = ms.get(i);
            if (i > 0) sb.append(',');
            sb.append('[').append(v[0]).append(',').append(v[1]).append(',').append(v[2]).append(']');
        }
        sb.append("]}");
        return sb.toString();
    }

    public synchronized String infoJson(long id) {
        Item it = byId(id);
        if (it == null) return "null";
        StringBuilder sb = new StringBuilder(256);
        sb.append('{');
        itemJson(sb, it);
        sb.append(",\"uri\":\"").append(esc(it.uri)).append("\"}");
        return sb.toString();
    }

    // ----------------------------------------------------------------- 缩略图

    /** 缓存键带版本：换了生成算法就换文件名，老缓存自然失效。 */
    private static final int THUMB_VER = 2;

    public File thumbFile(long id, int w) {
        return new File(thumbDir, id + "_" + w + "_v" + THUMB_VER + ".jpg");
    }

    /** 读取（或生成）缩略图字节；失败返回 null。 */
    public byte[] thumb(Item it, int w) {
        if (it == null) return null;
        File f = thumbFile(it.id, w);
        if (f.exists() && f.length() > 0) {
            try {
                return readFile(f);
            } catch (Throwable ignored) { }
        }
        Bitmap bmp;
        try {
            bmp = makeThumb(it, w);
        } catch (Throwable t) {
            bmp = null;
        }
        if (bmp == null) return null;
        ByteArrayOutputStream bo = new ByteArrayOutputStream(32 * 1024);
        bmp.compress(Bitmap.CompressFormat.JPEG, w > 700 ? 88 : 84, bo);
        bmp.recycle();
        byte[] data = bo.toByteArray();
        try {
            File tmp = new File(thumbDir, it.id + "_" + w + ".tmp");
            FileOutputStream fo = new FileOutputStream(tmp);
            fo.write(data);
            fo.flush();
            fo.close();
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(f);
        } catch (Throwable ignored) { }
        return data;
    }

    private static byte[] readFile(File f) throws Exception {
        long len = f.length();
        if (len <= 0 || len > 32L * 1024 * 1024) return null;
        byte[] buf = new byte[(int) len];
        java.io.FileInputStream in = new java.io.FileInputStream(f);
        int off = 0;
        try {
            while (off < buf.length) {
                int r = in.read(buf, off, buf.length - off);
                if (r < 0) break;
                off += r;
            }
        } finally {
            in.close();
        }
        return buf;
    }

    /**
     * 生成缩略图。
     * 小图（列表用<=512）走系统的 loadThumbnail，快；
     * 大图（大屏预览 / 放映）必须从原图解码 —— 系统缩略图在很多机型上只有 512，
     * 之前直接放大到 1440 就是「幻灯片很糊」的根源。
     */
    private Bitmap makeThumb(Item it, int w) throws Exception {
        Uri uri = uriFor(it);
        final int target = Math.min(w, 2560);

        if (target <= 512) {
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    Bitmap b = cr.loadThumbnail(uri, new Size(target, target), null);
                    if (b != null) return scaleTo(b, target);
                } catch (Throwable ignored) { }
            }
            return it.type == TYPE_IMAGE ? decodeImage(uri, target, true) : videoFrame(uri, target);
        }

        // 大图：限制同时解码的数量，避免几张大图一起解把内存顶爆
        try { LARGE_CODES.acquire(); } catch (InterruptedException ignored) { }
        try {
            Bitmap b = it.type == TYPE_IMAGE ? decodeImage(uri, target, false) : videoFrame(uri, target);
            if (b != null) return b;
        } finally {
            LARGE_CODES.release();
        }

        // 兜底：还是不行就退回系统缩略图
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                Bitmap b = cr.loadThumbnail(uri, new Size(target, target), null);
                if (b != null) return scaleTo(b, target);
            } catch (Throwable ignored) { }
        }
        return null;
    }

    private static final java.util.concurrent.Semaphore LARGE_CODES = new java.util.concurrent.Semaphore(2);

    /** 从原图流里按目标尺寸降采样解码（inSampleSize 只能是 2 的幂）。 */
    private Bitmap decodeImage(Uri uri, int target, boolean lowMem) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        InputStream in = cr.openInputStream(uri);
        if (in == null) return null;
        try {
            BitmapFactory.decodeStream(in, null, o);
        } finally {
            try { in.close(); } catch (Throwable ignored) { }
        }
        int ow = o.outWidth, oh = o.outHeight;
        if (ow <= 0 || oh <= 0) return null;

        int maxDim = Math.max(ow, oh);
        int sample = 1;
        while (maxDim / (sample * 2) >= target) sample *= 2;      // 解码后不小于目标
        long maxBytes = lowMem ? 12L * 1024 * 1024 : 32L * 1024 * 1024;
        while ((long) (ow / sample) * (long) (oh / sample) * 4 > maxBytes) sample *= 2;

        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        o2.inPreferredConfig = lowMem ? Bitmap.Config.RGB_565 : Bitmap.Config.ARGB_8888;
        InputStream in2 = null;
        Bitmap b = null;
        try {
            in2 = cr.openInputStream(uri);
            if (in2 != null) b = BitmapFactory.decodeStream(in2, null, o2);
        } finally {
            if (in2 != null) try { in2.close(); } catch (Throwable ignored) { }
        }
        return b == null ? null : scaleTo(b, target);
    }

    private Bitmap videoFrame(Uri uri, int target) throws Exception {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, uri);
            Bitmap b = null;
            if (Build.VERSION.SDK_INT >= 27) {
                try {
                    b = r.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, target, target);
                } catch (Throwable ignored) { }
            }
            if (b == null) b = r.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (b == null) b = r.getFrameAtTime();
            return b == null ? null : scaleTo(b, target);
        } finally {
            try { r.release(); } catch (Throwable ignored) { }
        }
    }

    private static Bitmap scaleTo(Bitmap b, int w) {
        int bw = b.getWidth(), bh = b.getHeight();
        if (bw <= 0 || bh <= 0) return b;
        int target = Math.max(w, 64);
        if (bw <= target && bh <= target) return b;
        float ratio = Math.min((float) target / bw, (float) target / bh);
        int nw = Math.max(1, Math.round(bw * ratio));
        int nh = Math.max(1, Math.round(bh * ratio));
        Bitmap s = Bitmap.createScaledBitmap(b, nw, nh, true);
        if (s != b) b.recycle();
        return s;
    }

    /** 清掉过老的缩略图缓存，避免无限增长（上限约 400MB / 60 天）。 */
    public void trimThumbs() {
        try {
            File[] fs = thumbDir.listFiles();
            if (fs == null || fs.length == 0) return;
            long total = 0;
            for (File f : fs) total += f.length();
            long cutoff = System.currentTimeMillis() - 60L * 24 * 3600 * 1000;
            if (total < 400L * 1024 * 1024) {
                for (File f : fs) if (f.lastModified() < cutoff) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
                return;
            }
            Arrays.sort(fs, new Comparator<File>() {
                @Override
                public int compare(File a, File b) {
                    return Long.compare(a.lastModified(), b.lastModified());
                }
            });
            for (File f : fs) {
                if (total < 320L * 1024 * 1024) break;
                total -= f.length();
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        } catch (Throwable ignored) { }
    }

    // ---------------------------------------------------------------- 音乐

    /** assets/music 下的音频文件名（已排序）。 */
    public List<String> musicFiles() {
        List<String> out = new ArrayList<>();
        try {
            String[] list = ctx.getAssets().list("music");
            if (list != null) {
                Arrays.sort(list);
                for (String n : list) {
                    String ln = n.toLowerCase();
                    if (ln.endsWith(".m4a") || ln.endsWith(".mp3") || ln.endsWith(".aac") || ln.endsWith(".ogg")) {
                        out.add(n);
                    }
                }
            }
        } catch (Throwable ignored) { }
        return out;
    }

    private Map<String, String> trackTitles = null;

    /** 从 assets/music/tracks.txt 读显示名（"文件名|标题"），读不到就退回文件名。 */
    private Map<String, String> trackTitles() {
        if (trackTitles != null) return trackTitles;
        Map<String, String> m = new HashMap<>();
        InputStream in = null;
        try {
            in = ctx.getAssets().open("music/tracks.txt");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int r;
            while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
            String txt = new String(bo.toByteArray(), "UTF-8");
            for (String line : txt.split("\n")) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int p = line.indexOf('|');
                if (p > 0) m.put(line.substring(0, p).trim(), line.substring(p + 1).trim());
            }
        } catch (Throwable ignored) {
        } finally {
            if (in != null) try { in.close(); } catch (Throwable ignored) { }
        }
        trackTitles = m;
        return m;
    }

    public String musicTitle(String file) {
        String t = trackTitles().get(file);
        if (t != null && !t.isEmpty()) return t;
        int dot = file.lastIndexOf('.');
        return dot > 0 ? file.substring(0, dot) : file;
    }
}
