package com.shiguang.app;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.os.ParcelFileDescriptor;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 只监听 127.0.0.1 的迷你 HTTP 服务，给 WebView 取图用。
 *   /                 界面静态文件（assets/www）
 *   /t/&lt;id&gt;?w=360    缩略图（带磁盘缓存）
 *   /f/&lt;id&gt;          原图 / 原视频（支持 Range，播放器可拖动）
 *   /m/&lt;n&gt;           内置放映音乐
 * 不联网、不对外暴露：WebView 与它同进程，端口随机。
 */
public class AssetServer {

    private final Context ctx;
    private final MediaRepo repo;
    private final AssetManager am;
    private final Map<String, byte[]> smallCache = new HashMap<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    private ServerSocket server;
    private int port = 0;
    private Thread acceptor;

    public AssetServer(Context ctx, MediaRepo repo) {
        this.ctx = ctx.getApplicationContext();
        this.repo = repo;
        this.am = this.ctx.getAssets();
    }

    public int port() {
        return port;
    }

    public int start() throws IOException {
        server = new ServerSocket(0, 48, InetAddress.getByName("127.0.0.1"));
        port = server.getLocalPort();
        acceptor = new Thread(new Runnable() {
            @Override
            public void run() {
                while (server != null && !server.isClosed()) {
                    try {
                        final Socket s = server.accept();
                        s.setSoTimeout(20000);
                        pool.execute(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    handle(s);
                                } catch (Throwable ignored) {
                                } finally {
                                    try { s.close(); } catch (Throwable ignored) { }
                                }
                            }
                        });
                    } catch (Throwable t) {
                        break;
                    }
                }
            }
        }, "sg-http-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        return port;
    }

    public void stop() {
        try { if (server != null) server.close(); } catch (Throwable ignored) { }
        pool.shutdownNow();
    }

    // --------------------------------------------------------------- 请求处理

    private void handle(Socket s) throws IOException {
        InputStream rawIn = s.getInputStream();
        BufferedInputStream in = new BufferedInputStream(rawIn, 16 * 1024);
        OutputStream out = new BufferedOutputStream(s.getOutputStream(), 32 * 1024);

        String reqLine = readLine(in);
        if (reqLine == null || reqLine.isEmpty()) return;
        String[] parts = reqLine.split(" ");
        if (parts.length < 2) return;
        String method = parts[0].toUpperCase(Locale.US);
        String target = parts[1];

        Map<String, String> h = new HashMap<>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int c = line.indexOf(':');
            if (c > 0) h.put(line.substring(0, c).trim().toLowerCase(Locale.US), line.substring(c + 1).trim());
        }

        String path = target;
        String query = "";
        int q = target.indexOf('?');
        if (q >= 0) {
            path = target.substring(0, q);
            query = target.substring(q + 1);
        }
        boolean head = "HEAD".equals(method);

        try {
            if (path.equals("/") || path.equals("/index.html")) {
                serveAsset(out, head, "www/index.html", h);
            } else if (path.startsWith("/t/")) {
                serveThumb(out, head, path.substring(3), query, h);
            } else if (path.startsWith("/f/")) {
                serveOriginal(out, head, path.substring(3), h);
            } else if (path.startsWith("/m/")) {
                serveMusic(out, head, path.substring(3), h);
            } else if (path.equals("/ping")) {
                byte[] b = "ok".getBytes(StandardCharsets.UTF_8);
                writeSimple(out, head, 200, "text/plain; charset=utf-8", b, null);
            } else {
                // 其余当作界面静态文件
                String rel = path.startsWith("/") ? path.substring(1) : path;
                if (rel.isEmpty()) rel = "index.html";
                if (rel.contains("..")) {
                    writeSimple(out, head, 403, "text/plain", new byte[0], null);
                } else {
                    serveAsset(out, head, "www/" + rel, h);
                }
            }
        } catch (Throwable t) {
            try {
                writeSimple(out, false, 500, "text/plain; charset=utf-8",
                        ("error: " + t).getBytes(StandardCharsets.UTF_8), null);
            } catch (Throwable ignored) { }
        }
        out.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(128);
        int c;
        boolean any = false;
        while ((c = in.read()) >= 0) {
            any = true;
            if (c == '\n') break;
            if (c != '\r') bo.write(c);
            if (bo.size() > 8192) break;
        }
        if (!any) return null;
        return new String(bo.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    // ------------------------------------------------------------------ 输出

    private static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.US);
        if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (n.endsWith(".json")) return "application/json; charset=utf-8";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".woff2")) return "font/woff2";
        if (n.endsWith(".woff")) return "font/woff";
        if (n.endsWith(".ttf")) return "font/ttf";
        if (n.endsWith(".m4a")) return "audio/mp4";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".aac")) return "audio/aac";
        if (n.endsWith(".ogg")) return "audio/ogg";
        if (n.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }

    private static void writeSimple(OutputStream out, boolean head, int code, String mime,
                                    byte[] body, String extraHeaders) throws IOException {
        StringBuilder sb = new StringBuilder(200);
        sb.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        sb.append("Content-Type: ").append(mime).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Connection: close\r\n");
        sb.append("Cache-Control: no-store\r\n");
        if (extraHeaders != null) sb.append(extraHeaders);
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!head) out.write(body);
        out.flush();
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 304: return "Not Modified";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 416: return "Range Not Satisfiable";
            default: return "Server Error";
        }
    }

    /** 带 Range 的通用字节流响应。 */
    private void writeStream(OutputStream out, boolean head, String mime, long total,
                             long start, long end, boolean partial, String extra,
                             InputStream body) throws IOException {
        long len = end - start + 1;
        StringBuilder sb = new StringBuilder(320);
        sb.append("HTTP/1.1 ").append(partial ? 206 : 200).append(' ')
          .append(reason(partial ? 206 : 200)).append("\r\n");
        sb.append("Content-Type: ").append(mime).append("\r\n");
        sb.append("Content-Length: ").append(len).append("\r\n");
        sb.append("Accept-Ranges: bytes\r\n");
        sb.append("Connection: close\r\n");
        if (partial) {
            sb.append("Content-Range: bytes ").append(start).append('-').append(end)
              .append('/').append(total).append("\r\n");
        }
        if (extra != null) sb.append(extra);
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!head && body != null) {
            long skip = start;
            while (skip > 0) {
                long n = body.skip(skip);
                if (n <= 0) {
                    if (body.read() < 0) break;
                    n = 1;
                }
                skip -= n;
            }
            byte[] buf = new byte[64 * 1024];
            long remain = len;
            while (remain > 0) {
                int want = (int) Math.min(buf.length, remain);
                int r = body.read(buf, 0, want);
                if (r < 0) break;
                out.write(buf, 0, r);
                remain -= r;
            }
        }
        out.flush();
    }

    // ------------------------------------------------------------------ 路由

    private void serveAsset(OutputStream out, boolean head, String name, Map<String, String> h) throws IOException {
        byte[] data = null;
        synchronized (smallCache) {
            data = smallCache.get(name);
        }
        if (data == null) {
            InputStream in;
            try {
                in = am.open(name);
            } catch (IOException e) {
                writeSimple(out, head, 404, "text/plain; charset=utf-8",
                        "not found".getBytes(StandardCharsets.UTF_8), null);
                return;
            }
            ByteArrayOutputStream bo = new ByteArrayOutputStream(64 * 1024);
            byte[] buf = new byte[32 * 1024];
            int r;
            while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
            in.close();
            data = bo.toByteArray();
            if (data.length <= 1024 * 1024) {
                synchronized (smallCache) {
                    smallCache.put(name, data);
                }
            }
        }
        String mime = mimeOf(name);
        String extra = name.endsWith(".html")
                ? "Cache-Control: no-store\r\n"
                : "Cache-Control: public, max-age=86400\r\n";
        writeSimple(out, head, 200, mime, data, extra);
    }

    private void serveThumb(OutputStream out, boolean head, String idStr, String query,
                            Map<String, String> h) throws IOException {
        long id;
        try {
            id = Long.parseLong(idStr.trim());
        } catch (Throwable t) {
            writeSimple(out, head, 404, "text/plain", new byte[0], null);
            return;
        }
        int w = 360;
        for (String kv : query.split("&")) {
            int e = kv.indexOf('=');
            if (e > 0 && "w".equals(kv.substring(0, e))) {
                try { w = Integer.parseInt(kv.substring(e + 1)); } catch (Throwable ignored) { }
            }
        }
        if (w < 64) w = 64;
        if (w > 2560) w = 2560;

        MediaRepo.Item it = repo.byId(id);
        if (it == null) {
            writeSimple(out, head, 404, "text/plain", new byte[0], null);
            return;
        }
        String etag = "\"" + id + "_" + w + "\"";
        String inm = h.get("if-none-match");
        if (inm != null && inm.contains(etag)) {
            writeSimple(out, head, 304, "image/jpeg", new byte[0], "ETag: " + etag + "\r\n");
            return;
        }
        byte[] data = repo.thumb(it, w);
        if (data == null) {
            writeSimple(out, head, 404, "text/plain; charset=utf-8",
                    "nothumb".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        String extra = "ETag: " + etag + "\r\nCache-Control: public, max-age=2592000\r\n";
        writeSimple(out, head, 200, "image/jpeg", data, extra);
    }

    private void serveOriginal(OutputStream out, boolean head, String idStr, Map<String, String> h)
            throws IOException {
        long id;
        try {
            id = Long.parseLong(idStr.trim());
        } catch (Throwable t) {
            writeSimple(out, head, 404, "text/plain", new byte[0], null);
            return;
        }
        MediaRepo.Item it = repo.byId(id);
        if (it == null) {
            writeSimple(out, head, 404, "text/plain", new byte[0], null);
            return;
        }
        InputStream body = null;
        long total = it.size;
        try {
            android.os.ParcelFileDescriptor pfd = ctx.getContentResolver()
                    .openFileDescriptor(MediaRepo.uriFor(it), "r");
            if (pfd != null) {
                long sz = pfd.getStatSize();
                if (sz > 0) total = sz;
                body = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
            }
        } catch (Throwable ignored) { }
        if (body == null) {
            try {
                body = ctx.getContentResolver().openInputStream(MediaRepo.uriFor(it));
            } catch (Throwable ignored) { }
        }
        if (body == null) {
            writeSimple(out, head, 404, "text/plain; charset=utf-8",
                    "unreadable".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        if (total <= 0) {
            // 拿不到长度：整体读进内存（照片通常没问题），视频则退化为连接关闭即结束
            ByteArrayOutputStream bo = new ByteArrayOutputStream(512 * 1024);
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = body.read(buf)) > 0) {
                bo.write(buf, 0, r);
                if (bo.size() > 200 * 1024 * 1024) break;
            }
            body.close();
            byte[] data = bo.toByteArray();
            writeSimple(out, head, 200, mimeOrGuess(it), data, "Accept-Ranges: bytes\r\n");
            return;
        }
        String range = h.get("range");
        long start = 0, end = total - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6);
            int comma = spec.indexOf(',');
            if (comma > 0) spec = spec.substring(0, comma);
            spec = spec.trim();
            int dash = spec.indexOf('-');
            if (dash >= 0) {
                String a = spec.substring(0, dash).trim();
                String b = spec.substring(dash + 1).trim();
                try {
                    if (a.isEmpty() && !b.isEmpty()) {
                        long n = Long.parseLong(b);
                        start = Math.max(0, total - n);
                        end = total - 1;
                    } else if (!a.isEmpty()) {
                        start = Long.parseLong(a);
                        if (!b.isEmpty()) end = Math.min(Long.parseLong(b), total - 1);
                    }
                    if (start < 0) start = 0;
                    if (end >= total) end = total - 1;
                    partial = true;
                } catch (Throwable ignored) {
                    start = 0; end = total - 1; partial = false;
                }
            }
        }
        if (partial && (start > end || start >= total)) {
            body.close();
            writeSimple(out, head, 416, "text/plain", new byte[0],
                    "Content-Range: bytes */" + total + "\r\n");
            return;
        }
        String extra = "Cache-Control: private, max-age=3600\r\n";
        try {
            writeStream(out, head, mimeOrGuess(it), total, start, end, partial, extra, body);
        } finally {
            try { body.close(); } catch (Throwable ignored) { }
        }
    }

    private static String mimeOrGuess(MediaRepo.Item it) {
        if (it.mime != null && !it.mime.isEmpty()) return it.mime;
        String m = mimeOf(it.name);
        if (it.type == MediaRepo.TYPE_VIDEO && "application/octet-stream".equals(m)) return "video/mp4";
        return m;
    }

    private void serveMusic(OutputStream out, boolean head, String idxStr, Map<String, String> h)
            throws IOException {
        int idx;
        try {
            idx = Integer.parseInt(idxStr.trim());
        } catch (Throwable t) {
            idx = 0;
        }
        List<String> files = repo.musicFiles();
        if (files.isEmpty()) {
            writeSimple(out, head, 404, "text/plain; charset=utf-8",
                    "nomusic".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        if (idx < 0 || idx >= files.size()) idx = 0;
        String name = "music/" + files.get(idx);

        long total = -1;
        try {
            AssetFileDescriptor fd = am.openFd(name);
            total = fd.getLength();
            fd.close();
        } catch (Throwable ignored) { }

        if (total <= 0) {
            InputStream in = am.open(name);
            ByteArrayOutputStream bo = new ByteArrayOutputStream(256 * 1024);
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
            in.close();
            writeSimple(out, head, 200, mimeOf(name), bo.toByteArray(), null);
            return;
        }

        InputStream body = am.open(name);
        String range = h.get("range");
        long start = 0, end = total - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6).trim();
            int dash = spec.indexOf('-');
            try {
                if (dash >= 0) {
                    String a = spec.substring(0, dash).trim();
                    String b = spec.substring(dash + 1).trim();
                    if (!a.isEmpty()) start = Long.parseLong(a);
                    if (!b.isEmpty()) end = Math.min(Long.parseLong(b), total - 1);
                    if (start < 0) start = 0;
                    if (end >= total) end = total - 1;
                    partial = true;
                }
            } catch (Throwable ignored) {
                start = 0; end = total - 1; partial = false;
            }
        }
        try {
            writeStream(out, head, mimeOf(name), total, start, end, partial,
                    "Cache-Control: public, max-age=86400\r\n", body);
        } finally {
            try { body.close(); } catch (Throwable ignored) { }
        }
    }
}
