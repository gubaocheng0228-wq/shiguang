package com.shiguang.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.List;

public class MainActivity extends Activity {

    private static final int REQ_PERM = 101;

    private WebView web;
    private MediaRepo repo;
    private UpdateManager update;
    private AssetServer server;
    private int barTop = 0, barBottom = 0, barLeft = 0, barRight = 0;
    private int kbInset = 0;
    private boolean pageReady = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        update = new UpdateManager(this);
        repo = new MediaRepo(this);
        server = new AssetServer(this, repo);
        int port;
        try {
            port = server.start();
        } catch (Throwable t) {
            Toast.makeText(this, "本地服务启动失败：" + t.getMessage(), Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A0C12"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);
        s.setUserAgentString(s.getUserAgentString() + " ShiguangApp/1.0");

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                android.util.Log.println(cm.messageLevel() == ConsoleMessage.MessageLevel.ERROR
                        ? android.util.Log.ERROR : android.util.Log.INFO,
                        "SGWeb", cm.message() + " @" + cm.sourceId() + ":" + cm.lineNumber());
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith("http://127.0.0.1:" + server.port());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                pushInsets(barTop, barBottom, barLeft, barRight, kbInset);
            }
        });

        web.addJavascriptInterface(new Bridge(), "SG");
        update.bindWeb(web);

        if (Build.VERSION.SDK_INT >= 20) {
            web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    int t, b, l, r, kb = 0;
                    if (Build.VERSION.SDK_INT >= 30) {
                        android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                        android.graphics.Insets cut = insets.getInsets(WindowInsets.Type.displayCutout());
                        android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                        t = Math.max(bars.top, cut.top);
                        b = bars.bottom;
                        l = Math.max(bars.left, cut.left);
                        r = Math.max(bars.right, cut.right);
                        kb = ime.bottom;
                    } else {
                        t = insets.getSystemWindowInsetTop();
                        b = insets.getSystemWindowInsetBottom();
                        l = insets.getSystemWindowInsetLeft();
                        r = insets.getSystemWindowInsetRight();
                    }
                    barTop = t; barBottom = b; barLeft = l; barRight = r; kbInset = kb;
                    pushInsets(t, b, l, r, kb);
                    return insets;
                }
            });
        }

        setContentView(web);
        web.loadUrl("http://127.0.0.1:" + port + "/");

        new Thread(new Runnable() {
            @Override
            public void run() {
                try { Thread.sleep(2500); } catch (Throwable ignored) { }
                repo.trimThumbs();
            }
        }, "sg-trim").start();
    }

    private void pushInsets(final int t, final int b, final int l, final int r, final int kb) {
        if (!pageReady || web == null) return;
        final String js = "window.__inset&&window.__inset(" + t + "," + b + "," + l + "," + r + "," + kb + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try { web.evaluateJavascript(js, null); } catch (Throwable ignored) { }
            }
        });
    }

    // ------------------------------------------------------------------ 权限

    private String[] mediaPerms() {
        if (Build.VERSION.SDK_INT >= 34) {
            return new String[]{Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
                    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"};
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[]{Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO};
        }
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
    }

    private boolean hasPerm() {
        if (Build.VERSION.SDK_INT >= 34) {
            // Android 14「仅选中的照片」也算可用
            if (checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
                    == PackageManager.PERMISSION_GRANTED) return true;
        }
        for (String p : mediaPerms()) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    private void askPerm() {
        if (hasPerm()) {
            pushPerm(true);
            return;
        }
        requestPermissions(mediaPerms(), REQ_PERM);
    }

    private void pushPerm(final boolean ok) {
        if (web == null) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try { web.evaluateJavascript("window.SGPerm&&SGPerm(" + ok + ")", null); } catch (Throwable ignored) { }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERM) {
            boolean ok = hasPerm();
            if (ok) repo.invalidate();
            pushPerm(ok);
        }
    }

    // ------------------------------------------------------------------ 沉浸

    private void applyImmersive(final boolean on) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Window w = getWindow();
                if (Build.VERSION.SDK_INT >= 30) {
                    WindowInsetsController c = w.getInsetsController();
                    if (c != null) {
                        if (on) {
                            c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                            c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                        } else {
                            c.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                        }
                    }
                } else {
                    View d = w.getDecorView();
                    if (on) {
                        d.setSystemUiVisibility(
                                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                    } else {
                        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
                    }
                }
            }
        });
    }

    private void keepAwake(final boolean on) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    // ------------------------------------------------------------------ 返回键

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return (window.SGBack&&window.SGBack())?1:0}catch(e){return 0}})()",
                value -> {
                    if (value == null || !value.contains("1")) {
                        moveTaskToBack(true);
                    }
                });
    }

    // ------------------------------------------------------------------ 生命周期

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.onPause();
            web.pauseTimers();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        if (repo != null) repo.trimThumbs();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            try {
                web.loadUrl("about:blank");
                web.destroy();
            } catch (Throwable ignored) { }
            web = null;
        }
        if (server != null) server.stop();
        super.onDestroy();
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Throwable t) {
            return "1.0.1";
        }
    }

    // ------------------------------------------------------------------ JS 桥

    class Bridge {

        @JavascriptInterface
        public String env() {
            StringBuilder sb = new StringBuilder(256);
            sb.append("{\"port\":").append(server.port())
              .append(",\"sdk\":").append(Build.VERSION.SDK_INT)
              .append(",\"version\":\"").append(appVersion()).append('"')
              .append(",\"model\":\"").append(MediaRepo.esc(Build.MANUFACTURER + " " + Build.MODEL)).append('"')
              .append(",\"granted\":").append(hasPerm())
              .append(",\"insets\":[").append(barTop).append(',').append(barBottom).append(',')
              .append(barLeft).append(',').append(barRight).append(']')
              .append(",\"music\":[");
            List<String> mf = repo.musicFiles();
            for (int i = 0; i < mf.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append("{\"i\":").append(i)
                  .append(",\"file\":\"").append(MediaRepo.esc(mf.get(i)))
                  .append("\",\"title\":\"").append(MediaRepo.esc(repo.musicTitle(mf.get(i)))).append('"')
                  .append('}');
            }
            sb.append("]}");
            return sb.toString();
        }

        @JavascriptInterface
        public String stats() {
            return repo.statsJson();
        }

        @JavascriptInterface
        public String page(int offset, int limit, String filter) {
            return repo.page(offset, limit, filter);
        }

        @JavascriptInterface
        public String info(long id) {
            return repo.infoJson(id);
        }

        @JavascriptInterface
        public String thumbs() {
            return "ok";
        }

        @JavascriptInterface
        public void askPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    askPerm();
                }
            });
        }

        @JavascriptInterface
        public boolean granted() {
            return hasPerm();
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Throwable ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void rescan() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    repo.invalidate();
                }
            });
        }

        @JavascriptInterface
        public void share(long id) {
            final MediaRepo.Item it = repo.byId(id);
            if (it == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType(it.type == MediaRepo.TYPE_VIDEO ? "video/*" : "image/*");
                        i.putExtra(Intent.EXTRA_STREAM, MediaRepo.uriFor(it));
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(i, "分享"));
                    } catch (Throwable t) {
                        Toast.makeText(MainActivity.this, "没有可用的分享方式", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void immersive(boolean on) {
            applyImmersive(on);
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            keepAwake(on);
        }

        @JavascriptInterface
        public void toast(String msg) {
            final String m = msg;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try { Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show(); } catch (Throwable ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void checkUpdate(boolean manual) {
            update.check(manual);
        }

        @JavascriptInterface
        public void downloadUpdate() {
            update.download();
        }

        @JavascriptInterface
        public void installUpdate() {
            update.install();
        }

        @JavascriptInterface
        public String updateState() {
            return update.stateJson();
        }

        @JavascriptInterface
        public int sdk() {
            return Build.VERSION.SDK_INT;
        }
    }
}
