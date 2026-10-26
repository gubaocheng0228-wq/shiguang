// 拾光 / shiguang 安装器 + 卸载器（单文件编译成两个 exe）
// 编译：
//   csc /target:winexe /main:Setup     /out:setup.exe     installer.cs
//   csc /target:winexe /main:Uninstall /out:uninstall.exe installer.cs
// 界面排版参考国内常见安装器（左侧品牌区 + 右侧协议/路径/选项 + 底部大按钮），
// 色系沿用拾光的深空蓝黑 + 金色。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

/** 安装包尾部格式： [payload(zip)] [8字节小端长度] [8字节 "SGSETUP1"] */
sealed class SubStream : Stream
{
    readonly Stream inner;
    readonly long start;
    readonly long len;
    long pos;
    public SubStream(Stream inner, long start, long len) { this.inner = inner; this.start = start; this.len = len; this.pos = 0; }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return true; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return len; } }
    public override long Position { get { return pos; } set { pos = value; } }
    public override int Read(byte[] buf, int off, int count)
    {
        if (pos >= len) return 0;
        if (pos + count > len) count = (int)(len - pos);
        inner.Seek(start + pos, SeekOrigin.Begin);
        int n = inner.Read(buf, off, count);
        pos += n;
        return n;
    }
    public override long Seek(long offset, SeekOrigin origin)
    {
        long np = origin == SeekOrigin.Begin ? offset : (origin == SeekOrigin.Current ? pos + offset : len + offset);
        pos = Math.Max(0, Math.Min(len, np));
        return pos;
    }
    public override void Flush() { }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buf, int off, int count) { throw new NotSupportedException(); }
}

static class Core
{
    public const string Magic = "SGSETUP1";
    public const string AppName = "拾光";
    public const string Folder = "shiguang";
    public const string Version = "1.6.2";
    public const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\shiguang";

    public static readonly Color BgDark = Color.FromArgb(10, 12, 18);
    public static readonly Color BgPanel = Color.FromArgb(15, 18, 27);
    public static readonly Color BgField = Color.FromArgb(22, 26, 38);
    public static readonly Color TxtMain = Color.FromArgb(236, 233, 226);
    public static readonly Color TxtDim = Color.FromArgb(146, 152, 168);
    public static readonly Color Gold = Color.FromArgb(224, 178, 106);
    public static readonly Color GoldDeep = Color.FromArgb(201, 151, 79);

    public static string DefaultTarget()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Folder);
    }

    public static Stream OpenPayload(string exePath)
    {
        FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (fs.Length < 32) throw new InvalidDataException("安装包不完整");
        byte[] tail = new byte[16];
        fs.Seek(-16, SeekOrigin.End);
        int got = 0;
        while (got < 16) { int n = fs.Read(tail, got, 16 - got); if (n <= 0) break; got += n; }
        if (Encoding.ASCII.GetString(tail, 8, 8) != Magic) throw new InvalidDataException("不是有效的 shiguang 安装包");
        long len = BitConverter.ToInt64(tail, 0);
        long start = fs.Length - 16 - len;
        if (start <= 0) throw new InvalidDataException("安装包已损坏");
        return new SubStream(fs, start, len);
    }

    public static long PayloadLength(string exePath)
    {
        using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            byte[] tail = new byte[16];
            fs.Seek(-16, SeekOrigin.End);
            fs.Read(tail, 0, 16);
            return BitConverter.ToInt64(tail, 0);
        }
    }

    public static void Extract(Stream payload, string target, Action<int, string> progress)
    {
        Directory.CreateDirectory(target);
        using (ZipArchive zip = new ZipArchive(payload, ZipArchiveMode.Read))
        {
            int total = zip.Entries.Count;
            if (total <= 0) throw new InvalidDataException("安装包内容为空");
            int i = 0;
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                i++;
                string rel = e.FullName.Replace('/', Path.DirectorySeparatorChar);
                string dest = Path.Combine(target, rel);
                if (string.IsNullOrEmpty(e.Name))
                {
                    Directory.CreateDirectory(dest);
                }
                else
                {
                    string dir = Path.GetDirectoryName(dest);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    e.ExtractToFile(dest, true);
                }
                if (progress != null) progress((int)((long)i * 100 / total), e.FullName);
            }
        }
    }

    public static void CreateShortcut(string lnk, string target, string workDir, string desc, string icon)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        if (t == null) return;
        object shell = Activator.CreateInstance(t);
        object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
        Type st = sc.GetType();
        st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
        st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
        st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { desc });
        st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { icon });
        st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
    }

    /** 读快捷方式指向的目标；读不到返回 null */
    public static string ShortcutTarget(string lnk)
    {
        try
        {
            if (!File.Exists(lnk)) return null;
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            if (t == null) return null;
            object shell = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            object tp = sc.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, sc, null);
            return tp as string;
        }
        catch { return null; }
    }

    /** 只删"确实指向本安装目录"的快捷方式，别误删用户原有的图标 */
    public static bool DeleteOwnShortcut(string lnk, string installDir)
    {
        string tp = ShortcutTarget(lnk);
        if (tp == null) return false;
        string a = tp.TrimEnd('\\');
        string b = installDir.TrimEnd('\\');
        if (a.StartsWith(b, StringComparison.OrdinalIgnoreCase))
        {
            try { File.Delete(lnk); return true; } catch { return false; }
        }
        return false;
    }

    public static void MakeShortcuts(string target, bool desktop)
    {
        string exe = Path.Combine(target, "shiguang.exe");
        CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk"),
            exe, target, AppName + " · 照片回忆库", exe);
        if (desktop)
        {
            CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"),
                exe, target, AppName + " · 照片回忆库", exe);
        }
    }

    public static void RegisterUninstall(string target, long payloadBytes)
    {
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstKey))
        {
            string exe = Path.Combine(target, "shiguang.exe");
            string un = Path.Combine(target, "uninstall.exe");
            k.SetValue("DisplayName", AppName + " (shiguang)");
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", "shiguang");
            k.SetValue("InstallLocation", target);
            k.SetValue("DisplayIcon", exe);
            k.SetValue("UninstallString", "\"" + un + "\"");
            k.SetValue("QuietUninstallString", "\"" + un + "\" /S");
            k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, payloadBytes / 1024), RegistryValueKind.DWord);
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    public static void Log(string msg)
    {
        try
        {
            File.AppendAllText(Path.Combine(Path.GetTempPath(), "shiguang-setup.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n", Encoding.UTF8);
        }
        catch { }
    }

    public static void SafeKill()
    {
        try
        {
            foreach (Process p in Process.GetProcessesByName("shiguang"))
            {
                try { p.Kill(); } catch { }
            }
        }
        catch { }
    }

    /** 圆角矩形路径，用于 logo 与按钮 */
    public static GraphicsPath RoundRect(Rectangle r, int radius)
    {
        GraphicsPath p = new GraphicsPath();
        int d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    /** 运行期画一个 logo（金色圆角方块 + 拾字），不依赖任何外部图片 */
    public static Bitmap MakeLogo(int size)
    {
        Bitmap bmp = new Bitmap(size, size);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
            Rectangle r = new Rectangle(0, 0, size - 1, size - 1);
            using (GraphicsPath path = RoundRect(r, size / 5))
            using (LinearGradientBrush br = new LinearGradientBrush(r, Color.FromArgb(240, 206, 150), GoldDeep, 55f))
            {
                g.FillPath(br, path);
            }
            using (Font f = new Font("Microsoft YaHei UI", size * 0.44f, FontStyle.Bold, GraphicsUnit.Pixel))
            using (SolidBrush tb = new SolidBrush(Color.FromArgb(38, 27, 14)))
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                g.DrawString("拾", f, tb, new RectangleF(0, 0, size, size), sf);
            }
        }
        return bmp;
    }
}

/* ───────────── 安装器 ───────────── */
static class Setup
{
    [STAThread]
    static int Main(string[] args)
    {
        bool silent = Array.IndexOf(args, "/S") >= 0;
        string target = Core.DefaultTarget();
        foreach (string a in args)
        {
            if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) target = a.Substring(3).Trim('"');
        }

        if (silent)
        {
            try
            {
                Core.Log("静默安装 → " + target);
                Core.SafeKill();
                using (Stream s = Core.OpenPayload(Application.ExecutablePath)) Core.Extract(s, target, null);
                Core.RegisterUninstall(target, Core.PayloadLength(Application.ExecutablePath));
                Core.MakeShortcuts(target, true);
                Core.Log("静默安装完成");
                return 0;
            }
            catch (Exception ex) { Core.Log("静默安装失败: " + ex); return 1; }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (InstallForm f = new InstallForm(target)) { Application.Run(f); return f.ExitCode; }
    }
}

/** 左品牌 / 右内容 的双栏安装器 */
sealed class InstallForm : Form
{
    const int W = 720, H = 460;
    const int LeftW = 248;

    readonly string target;
    Panel left, right;
    Label lblClose, lblLeftName, lblLeftVer, lblLeftTag, lblTitle, lblSub, lblPathTip, lblStatus, lblPct, lblFile, lblProgTitle;
    TextBox txtPath, txtLicense;
    CheckBox chkAgree, chkDesktop, chkRun;
    Button btnBrowse, btnMain;
    Panel pnlInstall, pnlProgress;
    ProgressBar bar;
    public int ExitCode = 0;
    int lastPct = -1;
    bool installed = false;
    string failText = null;

    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, int wp, int lp);
    const int WM_NCLBUTTONDOWN = 0xA1, HTCAPTION = 2;

    protected override CreateParams CreateParams
    {
        get { CreateParams cp = base.CreateParams; cp.ClassStyle |= 0x20000; return cp; } // CS_DROPSHADOW
    }

    public InstallForm(string target)
    {
        this.target = target;
        Text = "安装 " + Core.AppName;
        ClientSize = new Size(W, H);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Core.BgDark;
        Font = new Font("Microsoft YaHei UI", 9F);
        AutoScaleMode = AutoScaleMode.None;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        // ── 左侧品牌区 ──
        left = new Panel();
        left.SetBounds(0, 0, LeftW, H);
        left.BackColor = Core.BgPanel;
        left.MouseDown += DragWindow;
        Controls.Add(left);

        Panel logoBox = new Panel();
        logoBox.SetBounds(28, 46, 64, 64);
        logoBox.BackColor = Core.BgPanel;
        Image logo = Core.MakeLogo(64);
        logoBox.BackgroundImage = logo;
        logoBox.BackgroundImageLayout = ImageLayout.None;
        left.Controls.Add(logoBox);

        lblLeftName = new Label();
        lblLeftName.Text = Core.AppName;
        lblLeftName.ForeColor = Core.TxtMain;
        lblLeftName.Font = new Font("Microsoft YaHei UI", 22F, FontStyle.Bold);
        lblLeftName.SetBounds(26, 124, 200, 40);
        lblLeftName.MouseDown += DragWindow;
        left.Controls.Add(lblLeftName);

        Label en = new Label();
        en.Text = "PHOTO VAULT";
        en.ForeColor = Core.Gold;
        en.Font = new Font("Segoe UI", 8F, FontStyle.Regular);
        en.SetBounds(30, 166, 200, 18);
        en.MouseDown += DragWindow;
        left.Controls.Add(en);

        lblLeftTag = new Label();
        lblLeftTag.Text = "本地照片回忆库\n照片只存在你自己的电脑里";
        lblLeftTag.ForeColor = Core.TxtDim;
        lblLeftTag.Font = new Font("Microsoft YaHei UI", 9F);
        lblLeftTag.SetBounds(30, 200, 196, 46);
        lblLeftTag.MouseDown += DragWindow;
        left.Controls.Add(lblLeftTag);

        lblLeftVer = new Label();
        lblLeftVer.Text = "版本 " + Core.Version;
        lblLeftVer.ForeColor = Color.FromArgb(108, 114, 130);
        lblLeftVer.Font = new Font("Microsoft YaHei UI", 8.5F);
        lblLeftVer.SetBounds(30, H - 58, 190, 20);
        lblLeftVer.MouseDown += DragWindow;
        left.Controls.Add(lblLeftVer);

        // ── 右侧内容区 ──
        right = new Panel();
        right.SetBounds(LeftW, 0, W - LeftW, H);
        right.BackColor = Core.BgDark;
        Controls.Add(right);

        lblTitle = new Label();
        lblTitle.Text = "安装 " + Core.AppName;
        lblTitle.ForeColor = Core.TxtMain;
        lblTitle.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
        lblTitle.SetBounds(26, 26, 380, 32);
        right.Controls.Add(lblTitle);

        lblSub = new Label();
        lblSub.Text = "选择安装位置并同意许可协议后开始";
        lblSub.ForeColor = Core.TxtDim;
        lblSub.Font = new Font("Microsoft YaHei UI", 8.5F);
        lblSub.SetBounds(28, 58, 400, 20);
        right.Controls.Add(lblSub);

        lblClose = new Label();
        lblClose.Text = "✕";
        lblClose.ForeColor = Core.TxtDim;
        lblClose.Font = new Font("Segoe UI", 11F);
        lblClose.TextAlign = ContentAlignment.MiddleCenter;
        lblClose.SetBounds(W - LeftW - 36, 12, 26, 26);
        lblClose.Cursor = Cursors.Hand;
        lblClose.Click += delegate { Close(); };
        right.Controls.Add(lblClose);

        pnlInstall = new Panel();
        pnlInstall.SetBounds(0, 0, W - LeftW, H);
        pnlInstall.BackColor = Core.BgDark;
        right.Controls.Add(pnlInstall);
        pnlInstall.BringToFront();
        lblTitle.BringToFront(); lblSub.BringToFront(); lblClose.BringToFront();

        // 协议框：外面套一层同色面板当内边距，文字不贴边框
        Panel licWrap = new Panel();
        licWrap.SetBounds(28, 88, 418, 118);
        licWrap.BackColor = Core.BgField;
        pnlInstall.Controls.Add(licWrap);

        txtLicense = new TextBox();
        txtLicense.Multiline = true;
        txtLicense.ReadOnly = true;
        txtLicense.ScrollBars = ScrollBars.Vertical;
        txtLicense.BorderStyle = BorderStyle.None;
        txtLicense.BackColor = Core.BgField;
        txtLicense.ForeColor = Color.FromArgb(185, 191, 204);
        txtLicense.Font = new Font("Microsoft YaHei UI", 8.5F);
        txtLicense.SetBounds(10, 8, 398, 102);
        txtLicense.Text =
            "拾光 · 软件许可协议\r\n" +
            "\r\n" +
            "1. 本软件是一款纯本地运行的相册工具，不联网、不上传任何照片。\r\n" +
            "2. 所有索引、缩略图与回收站数据默认保存在 D:\\拾光数据；移动硬盘没插时不会删除任何索引。\r\n" +
            "3. 编辑照片会自动备份原文件到软件回收站，可随时还原。\r\n" +
            "4. 你可以自由复制、分发本软件；请自行备份重要照片，作者不对数据丢失负责。\r\n" +
            "5. 卸载本软件不会删除你的照片与数据目录。";
        txtLicense.SelectionStart = 0;
        licWrap.Controls.Add(txtLicense);

        chkAgree = new CheckBox();
        chkAgree.Text = "我已阅读并同意《拾光软件许可协议》";
        chkAgree.ForeColor = Core.TxtMain;
        chkAgree.Font = new Font("Microsoft YaHei UI", 8.5F);
        chkAgree.SetBounds(28, 212, 300, 22);
        chkAgree.Checked = true;
        chkAgree.CheckedChanged += delegate { UpdatePrimary(); };
        pnlInstall.Controls.Add(chkAgree);

        lblPathTip = new Label();
        lblPathTip.Text = "安装位置";
        lblPathTip.ForeColor = Core.TxtDim;
        lblPathTip.Font = new Font("Microsoft YaHei UI", 8.5F);
        lblPathTip.SetBounds(28, 246, 200, 18);
        pnlInstall.Controls.Add(lblPathTip);

        txtPath = new TextBox();
        txtPath.Text = target;
        txtPath.ReadOnly = true;
        txtPath.BorderStyle = BorderStyle.FixedSingle;
        txtPath.BackColor = Core.BgField;
        txtPath.ForeColor = Core.TxtMain;
        txtPath.Font = new Font("Microsoft YaHei UI", 8.5F);
        txtPath.SetBounds(28, 266, 336, 24);
        pnlInstall.Controls.Add(txtPath);

        btnBrowse = new Button();
        btnBrowse.Text = "浏览…";
        btnBrowse.SetBounds(370, 265, 76, 26);
        btnBrowse.FlatStyle = FlatStyle.Flat;
        btnBrowse.FlatAppearance.BorderColor = Color.FromArgb(58, 64, 80);
        btnBrowse.BackColor = Core.BgField;
        btnBrowse.ForeColor = Core.TxtMain;
        btnBrowse.Click += delegate
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                d.Description = "选择安装位置";
                d.SelectedPath = txtPath.Text;
                if (d.ShowDialog(this) == DialogResult.OK) txtPath.Text = d.SelectedPath;
            }
        };
        pnlInstall.Controls.Add(btnBrowse);

        chkDesktop = new CheckBox();
        chkDesktop.Text = "创建桌面快捷方式";
        chkDesktop.ForeColor = Core.TxtMain;
        chkDesktop.Font = new Font("Microsoft YaHei UI", 8.5F);
        chkDesktop.SetBounds(28, 302, 200, 22);
        chkDesktop.Checked = true;
        pnlInstall.Controls.Add(chkDesktop);

        chkRun = new CheckBox();
        chkRun.Text = "安装完成后运行 " + Core.AppName;
        chkRun.ForeColor = Core.TxtMain;
        chkRun.Font = new Font("Microsoft YaHei UI", 8.5F);
        chkRun.SetBounds(232, 302, 220, 22);
        chkRun.Checked = true;
        pnlInstall.Controls.Add(chkRun);

        btnMain = new Button();
        btnMain.Text = "立即安装";
        btnMain.SetBounds(28, 336, 418, 46);
        btnMain.FlatStyle = FlatStyle.Flat;
        btnMain.FlatAppearance.BorderSize = 0;
        btnMain.BackColor = Core.Gold;
        btnMain.ForeColor = Color.FromArgb(32, 23, 10);
        btnMain.Font = new Font("Microsoft YaHei UI", 11.5F, FontStyle.Bold);
        btnMain.Cursor = Cursors.Hand;
        btnMain.Click += OnPrimary;
        pnlInstall.Controls.Add(btnMain);

        // ── 进度视图 ──
        pnlProgress = new Panel();
        pnlProgress.SetBounds(0, 0, W - LeftW, H);
        pnlProgress.BackColor = Core.BgDark;
        pnlProgress.Visible = false;
        right.Controls.Add(pnlProgress);

        lblProgTitle = new Label();
        lblProgTitle.Text = "正在安装";
        lblProgTitle.ForeColor = Core.TxtMain;
        lblProgTitle.Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold);
        lblProgTitle.SetBounds(28, 120, 300, 30);
        pnlProgress.Controls.Add(lblProgTitle);

        lblPct = new Label();
        lblPct.Text = "0%";
        lblPct.ForeColor = Core.Gold;
        lblPct.Font = new Font("Segoe UI", 30F, FontStyle.Bold);
        lblPct.SetBounds(26, 154, 300, 56);
        pnlProgress.Controls.Add(lblPct);

        bar = new ProgressBar();
        bar.SetBounds(28, 222, 418, 10);
        bar.Maximum = 100;
        pnlProgress.Controls.Add(bar);

        lblFile = new Label();
        lblFile.Text = "";
        lblFile.ForeColor = Core.TxtDim;
        lblFile.Font = new Font("Microsoft YaHei UI", 8F);
        lblFile.SetBounds(28, 240, 418, 18);
        lblFile.AutoEllipsis = true;
        pnlProgress.Controls.Add(lblFile);

        lblStatus = new Label();
        lblStatus.Text = "";
        lblStatus.ForeColor = Core.TxtDim;
        lblStatus.Font = new Font("Microsoft YaHei UI", 9F);
        lblStatus.SetBounds(28, 280, 418, 40);
        pnlProgress.Controls.Add(lblStatus);

        UpdatePrimary();
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
    }

    void DragWindow(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }

    void UpdatePrimary()
    {
        if (btnMain == null) return;
        if (installed)
        {
            btnMain.Text = "完成";
            btnMain.Enabled = true;
            btnMain.BackColor = Core.Gold;
            return;
        }
        bool ok = chkAgree != null && chkAgree.Checked;
        btnMain.Enabled = ok;
        btnMain.BackColor = ok ? Core.Gold : Color.FromArgb(58, 52, 40);
        btnMain.ForeColor = ok ? Color.FromArgb(32, 23, 10) : Color.FromArgb(120, 108, 88);
    }

    void Ui(Action a) { try { if (IsHandleCreated && !IsDisposed) BeginInvoke(a); } catch { } }

    void OnPrimary(object sender, EventArgs e)
    {
        if (installed)
        {
            DialogResult = DialogResult.OK;
            Close();
            return;
        }
        if (!chkAgree.Checked) return;

        pnlInstall.Visible = false;
        pnlProgress.Visible = true;
        pnlProgress.BringToFront();
        lblTitle.Text = "安装 " + Core.AppName;
        lblSub.Text = "正在把程序写入你的电脑，请稍候…";

        string dir = txtPath.Text.Trim();
        bool desktop = chkDesktop.Checked;
        bool run = chkRun.Checked;

        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                Core.SafeKill();
                using (Stream s = Core.OpenPayload(Application.ExecutablePath))
                {
                    Core.Extract(s, dir, delegate (int pct, string name)
                    {
                        if (pct != lastPct)
                        {
                            lastPct = pct;
                            Ui(() =>
                            {
                                bar.Value = Math.Min(100, pct);
                                lblPct.Text = pct + "%";
                                lblFile.Text = name;
                            });
                        }
                    });
                }
                Ui(() => { lblFile.Text = "正在创建快捷方式与卸载入口…"; });
                Core.MakeShortcuts(dir, desktop);
                Core.RegisterUninstall(dir, Core.PayloadLength(Application.ExecutablePath));
                Core.Log("安装完成 → " + dir);

                Ui(() =>
                {
                    // 完成态：标题换文案（旧版这里永远显示"正在安装"，像卡住了）
                    lblProgTitle.Text = "安装完成";
                    lblPct.Text = "✓";
                    lblPct.ForeColor = Color.FromArgb(126, 204, 148);
                    lblFile.Text = "";
                    lblStatus.Text = "安装完成 ✓  位置：" + dir + (run ? "（拾光已打开）" : "");
                    lblStatus.ForeColor = Color.FromArgb(126, 204, 148);
                    lblStatus.Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold);
                    installed = true;
                    UpdatePrimary();
                    if (run) { try { Process.Start(Path.Combine(dir, "shiguang.exe")); } catch { } }
                    // 2.5 秒后自动关窗：软件已经打开，窗口没必要留着
                    var t = new System.Windows.Forms.Timer { Interval = 2500 };
                    t.Tick += delegate { t.Dispose(); if (!IsDisposed) { DialogResult = DialogResult.OK; Close(); } };
                    t.Start();
                });
            }
            catch (Exception ex)
            {
                failText = ex.Message;
                Core.Log("安装失败: " + ex);
                Ui(() =>
                {
                    lblProgTitle.Text = "安装失败";                          // 标题也换掉，别再挂着"正在安装"
                    lblPct.Text = "×";
                    lblPct.ForeColor = Color.FromArgb(224, 108, 92);
                    lblStatus.Text = "安装失败：" + ex.Message;
                    lblStatus.ForeColor = Color.FromArgb(240, 164, 154);
                    btnMain.Text = "关闭";
                    btnMain.Enabled = true;
                    installed = true;
                });
            }
        });
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        ExitCode = (failText == null) ? 0 : 1;
        base.OnFormClosing(e);
    }
}

/* ───────────── 卸载器 ───────────── */
static class Uninstall
{
    [STAThread]
    static int Main(string[] args)
    {
        bool silent = Array.IndexOf(args, "/S") >= 0;
        string dir = Path.GetDirectoryName(Application.ExecutablePath);
        if (string.IsNullOrEmpty(dir)) dir = Environment.CurrentDirectory;
        dir = dir.TrimEnd(Path.DirectorySeparatorChar);

        if (!silent)
        {
            DialogResult r = MessageBox.Show(
                "确定要卸载 " + Core.AppName + " 吗？\n\n" +
                "· 程序目录会被删除：" + dir + "\n" +
                "· 照片库和数据目录（默认 D:\\拾光数据）不会动\n\n" +
                "索引、收藏、回收站都会保留，重新安装后还在。",
                "卸载 " + Core.AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes) return 0;
        }

        try { Registry.CurrentUser.DeleteSubKeyTree(Core.UninstKey, false); } catch { }
        // 只删"确实指向本安装目录"的快捷方式：桌面那个要是还指着别的副本（例如 D:\拾光），不能动
        Core.DeleteOwnShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Core.AppName + ".lnk"), dir);
        Core.DeleteOwnShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Core.AppName + ".lnk"), dir);

        try
        {
            Core.SafeKill();
            string cmd = Path.Combine(Path.GetTempPath(), "sg-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd");
            string body =
                "@echo off\r\n" +
                "chcp 65001 >nul\r\n" +
                "timeout /t 2 /nobreak >nul\r\n" +
                "taskkill /f /im shiguang.exe >nul 2>&1\r\n" +
                "timeout /t 1 /nobreak >nul\r\n" +
                "rd /s /q \"" + dir + "\"\r\n" +
                "del /f /q \"%~f0\"\r\n";
            File.WriteAllText(cmd, body, Encoding.Default);
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c \"" + cmd + "\"");
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            Process.Start(psi);
        }
        catch (Exception ex) { Core.Log("卸载清理失败: " + ex); }

        if (!silent) MessageBox.Show("已卸载。" + Core.AppName + " 的照片和数据仍然保留。", "卸载完成");
        return 0;
    }
}
