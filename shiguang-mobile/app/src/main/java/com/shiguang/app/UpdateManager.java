package com.shiguang.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 应用内更新：
 *   查 latest.json → 验签 → 下载 APK → 校验 sha256 → 交给系统安装器。
 * 清单用 RSA 签名，所以即使走明文 HTTP，别人也没法伪造一个假版本让你装。
 */
class UpdateManager {

    /** 更新清单地址（换成自己的域名时只改这里，发布脚本里的 BASE 也要同步改） */
    static final String MANIFEST_URL = "http://your-server.example/shiguang/latest.json";

    private final Activity act;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private volatile WebView web;
    private volatile JSONObject lastManifest;
    private volatile File apkFile;
    private volatile boolean busy = false;

    UpdateManager(Activity act) {
        this.act = act;
    }

    void bindWeb(WebView w) {
        this.web = w;
    }

    // ------------------------------------------------------------------ 查

    void check(final boolean manual) {
        if (busy) return;
        busy = true;
        if (manual) push(state("checking", null, 0, null));
        pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject o = fetchManifest();
                    lastManifest = o;
                    int code = o.optInt("versionCode", 0);
                    int mine = myVersionCode();
                    if (code <= mine) {
                        push(state("latest", o, 100, null));
                    } else {
                        push(state("found", o, 0, null));
                    }
                } catch (Throwable t) {
                    push(state("error", null, 0, shortMsg(t)));
                } finally {
                    busy = false;
                }
            }
        });
    }

    private JSONObject fetchManifest() throws Exception {
        String url = MANIFEST_URL + (MANIFEST_URL.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis();
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setRequestProperty("Cache-Control", "no-cache");
        c.setRequestProperty("User-Agent", "ShiguangUpdater/1.0");
        InputStream in = c.getInputStream();
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
        in.close();
        c.disconnect();

        JSONObject o = new JSONObject(new String(bo.toByteArray(), "UTF-8"));
        String payload = payloadOf(o);
        String sig = o.optString("sig", "");
        if (sig.isEmpty()) throw new SecurityException("清单缺少签名");
        if (!verify(payload, sig)) throw new SecurityException("清单签名校验失败");

        int code = o.optInt("versionCode", 0);
        if (code <= 0) throw new IllegalArgumentException("versionCode 无效");
        if (o.optString("url").isEmpty()) throw new IllegalArgumentException("下载地址为空");
        return o;
    }

    private static String payloadOf(JSONObject o) {
        return o.optInt("versionCode", 0) + "|"
                + o.optString("versionName", "") + "|"
                + o.optString("sha256", "") + "|"
                + o.optLong("size", 0) + "|"
                + o.optString("url", "");
    }

    private static boolean verify(String payload, String sigB64) {
        try {
            byte[] der = Base64.decode(UpdateKey.PUBKEY_B64, Base64.DEFAULT);
            PublicKey pk = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
            Signature s = Signature.getInstance("SHA256withRSA");
            s.initVerify(pk);
            s.update(payload.getBytes("UTF-8"));
            return s.verify(Base64.decode(sigB64, Base64.DEFAULT));
        } catch (Throwable t) {
            return false;
        }
    }

    // ---------------------------------------------------------------- 下载

    void download() {
        final JSONObject o = lastManifest;
        if (o == null) {
            push(state("error", null, 0, "请先检查更新"));
            return;
        }
        if (busy) return;
        busy = true;
        pool.execute(new Runnable() {
            @Override
            public void run() {
                File tmp = null;
                try {
                    String url = o.optString("url");
                    long expectSize = o.optLong("size", 0);
                    String expectSha = o.optString("sha256", "");

                    File dir = new File(act.getCacheDir(), "update");
                    if (!dir.exists()) dir.mkdirs();
                    tmp = new File(dir, "dl-" + o.optInt("versionCode") + ".part");

                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(10000);
                    c.setReadTimeout(20000);
                    c.setRequestProperty("User-Agent", "ShiguangUpdater/1.0");
                    long total = c.getContentLength();
                    if (total <= 0) total = expectSize;

                    InputStream in = c.getInputStream();
                    OutputStream out = new FileOutputStream(tmp);
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int r;
                    long lastPush = 0;
                    pushProgress(0, o);
                    while ((r = in.read(buf)) > 0) {
                        out.write(buf, 0, r);
                        done += r;
                        long now = System.currentTimeMillis();
                        if (now - lastPush > 200) {
                            lastPush = now;
                            pushProgress(total > 0 ? (int) (done * 100 / total) : 0, o);
                        }
                    }
                    out.flush();
                    out.close();
                    in.close();
                    c.disconnect();

                    if (expectSize > 0 && done != expectSize) throw new Exception("文件大小不一致");
                    String sha = sha256(tmp);
                    if (!expectSha.isEmpty() && !sha.equalsIgnoreCase(expectSha)) {
                        throw new SecurityException("文件校验失败（sha256 不一致）");
                    }

                    File dst = new File(dir, "shiguang-" + o.optString("versionName") + ".apk");
                    if (dst.exists()) dst.delete();
                    if (!tmp.renameTo(dst)) {
                        // 跨卷/占用时退化复制
                        copy(tmp, dst);
                        tmp.delete();
                    }
                    apkFile = dst;
                    push(state("ready", o, 100, null));
                } catch (Throwable t) {
                    if (tmp != null) tmp.delete();
                    push(state("error", o, 0, shortMsg(t)));
                } finally {
                    busy = false;
                }
            }
        });
    }

    // ---------------------------------------------------------------- 安装

    void install() {
        final File f = apkFile;
        if (f == null || !f.exists()) {
            push(state("error", null, 0, "安装包还没下载好"));
            return;
        }
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= 26
                            && !act.getPackageManager().canRequestPackageInstalls()) {
                        push(state("needPermission", lastManifest, 100, null));
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + act.getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        act.startActivity(i);
                        return;
                    }
                    ApkProvider.setFile(f);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(Uri.parse("content://" + ApkProvider.AUTHORITY + "/update.apk"),
                            "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(i);
                } catch (Throwable t) {
                    push(state("error", lastManifest, 100, shortMsg(t)));
                }
            }
        });
    }

    // ---------------------------------------------------------------- 状态

    String stateJson() {
        JSONObject o = lastManifest;
        return state(apkFile != null && apkFile.exists() ? "ready" : (o == null ? "idle" : "found"), o, 0, null);
    }

    private String state(String st, JSONObject o, int pct, String msg) {
        JSONObject j = new JSONObject();
        try {
            j.put("state", st);
            j.put("pct", pct);
            j.put("curCode", myVersionCode());
            j.put("curName", myVersionName());
            if (msg != null) j.put("msg", msg);
            if (o != null) {
                j.put("code", o.optInt("versionCode"));
                j.put("ver", o.optString("versionName"));
                j.put("notes", o.optString("notes"));
                j.put("size", o.optLong("size"));
                j.put("force", o.optBoolean("force"));
            }
        } catch (Throwable ignored) { }
        return j.toString();
    }

    private String state(String st, JSONObject o, int pct) {
        return state(st, o, pct, null);
    }

    private void pushProgress(int pct, JSONObject o) {
        JSONObject j = new JSONObject();
        try {
            j.put("state", "downloading");
            j.put("pct", pct);
            j.put("code", o.optInt("versionCode"));
            j.put("ver", o.optString("versionName"));
            j.put("notes", o.optString("notes"));
            j.put("size", o.optLong("size"));
            j.put("curCode", myVersionCode());
            j.put("curName", myVersionName());
        } catch (Throwable ignored) { }
        push(j.toString());
    }

    private void push(final String json) {
        final WebView w = web;
        if (w == null) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    w.evaluateJavascript("window.SGUpdate&&window.SGUpdate(" + json + ")", null);
                } catch (Throwable ignored) { }
            }
        });
    }

    // ---------------------------------------------------------------- 工具

    private int myVersionCode() {
        try {
            return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionCode;
        } catch (Throwable t) {
            return 0;
        }
    }

    private String myVersionName() {
        try {
            return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (Throwable t) {
            return "";
        }
    }

    private static String shortMsg(Throwable t) {
        String m = t.getMessage();
        if (m == null) m = t.getClass().getSimpleName();
        return m.length() > 120 ? m.substring(0, 120) : m;
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        FileInputStream in = new FileInputStream(f);
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) > 0) md.update(buf, 0, r);
        in.close();
        byte[] d = md.digest();
        StringBuilder sb = new StringBuilder(64);
        for (byte b : d) {
            String s = Integer.toHexString(b & 0xff);
            if (s.length() == 1) sb.append('0');
            sb.append(s);
        }
        return sb.toString();
    }

    private static void copy(File src, File dst) throws Exception {
        InputStream in = new FileInputStream(src);
        OutputStream out = new FileOutputStream(dst);
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        out.close();
        in.close();
    }
}
