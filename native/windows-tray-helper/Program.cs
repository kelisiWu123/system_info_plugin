using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace HWInfoX.WindowsTrayHelper
{
    internal sealed class MetricSettings
    {
        public bool cpuTemperature { get; set; }
        public bool cpuLoad { get; set; }
        public bool cpuFrequency { get; set; }
        public bool fanSpeed { get; set; }
        public bool memoryUsage { get; set; }
        public bool diskIo { get; set; }
        public bool networkIo { get; set; }
    }

    internal sealed class TelemetryPayload
    {
        public double? temp { get; set; }
        public double? load { get; set; }
        public double? speed { get; set; }
        public double? fanSpeed { get; set; }
        public double? memoryPercent { get; set; }
        public double? memoryUsedBytes { get; set; }
        public double? memoryTotalBytes { get; set; }
        public double? diskReadBytesPerSec { get; set; }
        public double? diskWriteBytesPerSec { get; set; }
        public double? networkDownloadBytesPerSec { get; set; }
        public double? networkUploadBytesPerSec { get; set; }
        public bool showIcon { get; set; }
        public bool showTemp { get; set; }
        public bool showLoad { get; set; }
        public MetricSettings metrics { get; set; }
        public long updatedAt { get; set; }
    }

    internal sealed class DarkColorTable : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground { get { return Color.FromArgb(18, 24, 38); } }
        public override Color ImageMarginGradientBegin { get { return Color.FromArgb(18, 24, 38); } }
        public override Color ImageMarginGradientMiddle { get { return Color.FromArgb(18, 24, 38); } }
        public override Color ImageMarginGradientEnd { get { return Color.FromArgb(18, 24, 38); } }
        public override Color MenuBorder { get { return Color.FromArgb(48, 62, 86); } }
        public override Color MenuItemBorder { get { return Color.FromArgb(56, 189, 248); } }
        public override Color MenuItemSelected { get { return Color.FromArgb(32, 44, 68); } }
        public override Color MenuItemSelectedGradientBegin { get { return Color.FromArgb(32, 44, 68); } }
        public override Color MenuItemSelectedGradientEnd { get { return Color.FromArgb(32, 44, 68); } }
        public override Color MenuItemPressedGradientBegin { get { return Color.FromArgb(24, 34, 52); } }
        public override Color MenuItemPressedGradientEnd { get { return Color.FromArgb(24, 34, 52); } }
        public override Color SeparatorDark { get { return Color.FromArgb(36, 48, 72); } }
        public override Color SeparatorLight { get { return Color.FromArgb(36, 48, 72); } }
    }

    internal sealed class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkColorTable()) { }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (e.Item.Enabled && e.Item.Selected)
            {
                e.TextColor = Color.FromArgb(56, 189, 248);
            }
            else
            {
                e.TextColor = e.Item.ForeColor;
            }
            base.OnRenderItemText(e);
        }
    }

    internal sealed class TrayApplicationContext : ApplicationContext
    {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        private static FileStream _lockStream;
        private NotifyIcon _trayIcon;
        private IntPtr _previousHIcon = IntPtr.Zero;
        private Form _dummyForm;

        private readonly System.Windows.Forms.Timer _pollTimer;
        private readonly System.Windows.Forms.Timer _parentWatchTimer;
        private readonly string _telemetryPath;
        private readonly string _commandPath;
        private readonly int _parentPid;
        private readonly JavaScriptSerializer _serializer;

        private ContextMenuStrip _menu;
        private ToolStripMenuItem _titleItem;
        private ToolStripMenuItem _cpuTempItem;
        private ToolStripMenuItem _cpuLoadItem;
        private ToolStripMenuItem _memItem;
        private ToolStripMenuItem _fanItem;
        private ToolStripMenuItem _netItem;
        private ToolStripSeparator _statsSeparator;

        private long _lastProcessedUpdatedAt = -1;

        public TrayApplicationContext()
        {
            _serializer = new JavaScriptSerializer();

            string telemetryEnv = Environment.GetEnvironmentVariable("HWINFOX_TRAY_TELEMETRY_PATH");
            if (!string.IsNullOrEmpty(telemetryEnv) && File.Exists(telemetryEnv))
            {
                _telemetryPath = telemetryEnv;
            }
            else
            {
                _telemetryPath = Path.Combine(Path.GetTempPath(), "system-info-plugin", "windows-tray", "telemetry.json");
            }

            string commandEnv = Environment.GetEnvironmentVariable("HWINFOX_TRAY_COMMAND_PATH");
            if (!string.IsNullOrEmpty(commandEnv))
            {
                _commandPath = commandEnv;
            }
            else
            {
                _commandPath = Path.Combine(Path.GetTempPath(), "system-info-plugin", "windows-tray", "command.json");
            }

            string parentPidEnv = Environment.GetEnvironmentVariable("HWINFOX_TRAY_PARENT_PID");
            int parsedPid;
            if (!string.IsNullOrEmpty(parentPidEnv) && int.TryParse(parentPidEnv, out parsedPid) && parsedPid > 0)
            {
                _parentPid = parsedPid;
            }
            else
            {
                _parentPid = -1;
            }

            // Hidden dummy window to ensure popup menu dismisses properly on outside click
            _dummyForm = new Form
            {
                Size = Size.Empty,
                ShowInTaskbar = false,
                FormBorderStyle = FormBorderStyle.None,
            };
            _dummyForm.CreateControl();

            _menu = BuildDarkContextMenu();

            _trayIcon = new NotifyIcon
            {
                Visible = true,
                Text = null, // Completely disable native tooltip on hover
            };

            // Trigger exclusively on click - no hover popups
            _trayIcon.MouseClick += OnTrayMouseClick;
            _trayIcon.DoubleClick += OnTrayMouseDoubleClick;

            UpdateTrayIcon(IconRenderer.CreateBadgeIcon("--", Color.FromArgb(78, 201, 240)));

            _pollTimer = new System.Windows.Forms.Timer { Interval = 1000 };
            _pollTimer.Tick += OnPollTimerTick;
            _pollTimer.Start();

            if (_parentPid > 0)
            {
                _parentWatchTimer = new System.Windows.Forms.Timer { Interval = 2500 };
                _parentWatchTimer.Tick += OnParentWatchTick;
                _parentWatchTimer.Start();
            }

            ProcessTelemetry();
        }

        public static bool AcquireSingleInstance()
        {
            string lockPath = Environment.GetEnvironmentVariable("HWINFOX_TRAY_LOCK_PATH");
            if (string.IsNullOrEmpty(lockPath))
            {
                lockPath = Path.Combine(Path.GetTempPath(), "system-info-plugin", "windows-tray", "helper.lock");
            }

            try
            {
                string dir = Path.GetDirectoryName(lockPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                _lockStream = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static void ReleaseSingleInstance()
        {
            if (_lockStream != null)
            {
                try
                {
                    _lockStream.Close();
                    _lockStream.Dispose();
                }
                catch
                {
                }
                _lockStream = null;
            }
        }

        private ContextMenuStrip BuildDarkContextMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Renderer = new DarkMenuRenderer();
            menu.ShowImageMargin = false;
            menu.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // 1. Header
            _titleItem = new ToolStripMenuItem("  HWInfoX 硬件监控");
            _titleItem.Font = new Font("Segoe UI", 10.0f, FontStyle.Bold);
            _titleItem.ForeColor = Color.FromArgb(241, 245, 249);
            _titleItem.Enabled = false;
            menu.Items.Add(_titleItem);

            menu.Items.Add(new ToolStripSeparator());

            // 2. Real-time Hardware Metrics Rows
            _cpuTempItem = new ToolStripMenuItem("  CPU 温度:  --");
            _cpuTempItem.ForeColor = Color.FromArgb(78, 201, 240);
            _cpuTempItem.Click += (s, e) => OpenUtoolsPreset("a_watch_cpu_cores", "CPU核心监控");
            menu.Items.Add(_cpuTempItem);

            _cpuLoadItem = new ToolStripMenuItem("  CPU 占用:  --");
            _cpuLoadItem.ForeColor = Color.FromArgb(226, 232, 240);
            _cpuLoadItem.Click += (s, e) => OpenUtoolsPreset("a_monitor", "硬件监控");
            menu.Items.Add(_cpuLoadItem);

            _memItem = new ToolStripMenuItem("  内存使用:  --");
            _memItem.ForeColor = Color.FromArgb(192, 132, 252);
            _memItem.Visible = false;
            _memItem.Click += (s, e) => OpenUtoolsPreset("a_computer", "硬件信息");
            menu.Items.Add(_memItem);

            _fanItem = new ToolStripMenuItem("  风扇转速:  --");
            _fanItem.ForeColor = Color.FromArgb(45, 212, 191);
            _fanItem.Visible = false;
            menu.Items.Add(_fanItem);

            _netItem = new ToolStripMenuItem("  网络速率:  --");
            _netItem.ForeColor = Color.FromArgb(56, 189, 248);
            _netItem.Visible = false;
            menu.Items.Add(_netItem);

            _statsSeparator = new ToolStripSeparator();
            menu.Items.Add(_statsSeparator);

            // 3. Actions
            ToolStripMenuItem openOverview = new ToolStripMenuItem("  打开硬件信息 (主界面)", null, (s, e) => OpenUtoolsPreset("a_computer", "硬件信息"));
            openOverview.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            openOverview.ForeColor = Color.FromArgb(241, 245, 249);
            menu.Items.Add(openOverview);

            ToolStripMenuItem openWatch = new ToolStripMenuItem("  打开硬件监控浮窗", null, (s, e) => OpenUtoolsPreset("a_monitor", "硬件监控"));
            openWatch.ForeColor = Color.FromArgb(226, 232, 240);
            menu.Items.Add(openWatch);

            ToolStripMenuItem openCores = new ToolStripMenuItem("  打开 CPU 核心浮窗", null, (s, e) => OpenUtoolsPreset("a_watch_cpu_cores", "CPU核心监控"));
            openCores.ForeColor = Color.FromArgb(226, 232, 240);
            menu.Items.Add(openCores);

            ToolStripMenuItem openSettings = new ToolStripMenuItem("  托盘显示设置", null, (s, e) => OpenUtoolsPreset("a_menubar_settings", "托盘设置"));
            openSettings.ForeColor = Color.FromArgb(148, 163, 184);
            menu.Items.Add(openSettings);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem exitItem = new ToolStripMenuItem("  退出托盘", null, (s, e) => ExitTray());
            exitItem.ForeColor = Color.FromArgb(248, 113, 113);
            menu.Items.Add(exitItem);

            return menu;
        }

        private void OnTrayMouseClick(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left || e.Button == MouseButtons.Right)
            {
                ShowTrayMenu();
            }
        }

        private void OnTrayMouseDoubleClick(object sender, EventArgs e)
        {
            OpenUtoolsPreset("a_computer", "硬件信息");
            if (_menu != null && _menu.Visible)
            {
                _menu.Close();
            }
        }

        private void ShowTrayMenu()
        {
            if (_menu == null) return;

            if (_dummyForm != null && !_dummyForm.IsDisposed)
            {
                SetForegroundWindow(_dummyForm.Handle);
            }

            Point cursor = Cursor.Position;
            _menu.Show(cursor);
        }

        private void DispatchCommand(string action, string preset)
        {
            try
            {
                string dir = Path.GetDirectoryName(_commandPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                var payload = new Dictionary<string, object>
                {
                    { "id", Guid.NewGuid().ToString("N") },
                    { "action", action },
                    { "preset", preset },
                    { "timestamp", DateTime.UtcNow.Ticks }
                };
                string json = _serializer.Serialize(payload);

                string tempFile = _commandPath + "." + Process.GetCurrentProcess().Id + "." + Guid.NewGuid().ToString("N") + ".tmp";
                File.WriteAllText(tempFile, json, new System.Text.UTF8Encoding(false));

                for (int retry = 0; retry < 5; retry++)
                {
                    try
                    {
                        if (File.Exists(_commandPath))
                        {
                            File.Delete(_commandPath);
                        }
                        File.Move(tempFile, _commandPath);
                        break;
                    }
                    catch
                    {
                        System.Threading.Thread.Sleep(20);
                    }
                }
            }
            catch
            {
            }
        }

        private void OpenUtoolsPreset(string preset, string fallbackCmd)
        {
            DispatchCommand("openPreset", preset);
        }

        private void ExitTray()
        {
            try
            {
                DispatchCommand("exitTray", null);
                System.Threading.Thread.Sleep(60);
            }
            catch
            {
            }
            ExitThread();
        }

        private void OnParentWatchTick(object sender, EventArgs e)
        {
            if (_parentPid <= 0) return;
            try
            {
                Process parent = Process.GetProcessById(_parentPid);
                if (parent.HasExited)
                {
                    ExitThread();
                }
            }
            catch
            {
                ExitThread();
            }
        }

        private void OnPollTimerTick(object sender, EventArgs e)
        {
            ProcessTelemetry();
        }

        private void ProcessTelemetry()
        {
            if (!File.Exists(_telemetryPath))
            {
                return;
            }

            try
            {
                string json;
                using (FileStream fs = new FileStream(_telemetryPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (StreamReader sr = new StreamReader(fs))
                {
                    json = sr.ReadToEnd();
                }

                if (string.IsNullOrEmpty(json)) return;

                TelemetryPayload data = _serializer.Deserialize<TelemetryPayload>(json);
                if (data == null) return;

                if (data.updatedAt == _lastProcessedUpdatedAt)
                {
                    return;
                }
                _lastProcessedUpdatedAt = data.updatedAt;

                UpdateDashboard(data);
            }
            catch
            {
            }
        }

        private void UpdateDashboard(TelemetryPayload data)
        {
            MetricSettings metrics = data.metrics ?? new MetricSettings
            {
                cpuTemperature = data.showTemp,
                cpuLoad = data.showLoad,
            };

            // 1. Calculate Badge text and color
            string badgeText = "--";
            Color badgeColor = Color.FromArgb(78, 201, 240);

            if (metrics.cpuTemperature && data.temp.HasValue && data.temp.Value > 0)
            {
                int t = (int)Math.Round(data.temp.Value);
                badgeText = t >= 100 ? t.ToString() : (t.ToString() + "°");
                badgeColor = t >= 80 ? Color.FromArgb(255, 95, 87)
                    : t >= 65 ? Color.FromArgb(255, 189, 46)
                    : Color.FromArgb(78, 201, 240);
            }
            else if (metrics.cpuLoad && data.load.HasValue && data.load.Value >= 0)
            {
                int l = (int)Math.Round(data.load.Value);
                badgeText = l.ToString() + "%";
                badgeColor = l >= 85 ? Color.FromArgb(255, 95, 87)
                    : l >= 60 ? Color.FromArgb(255, 189, 46)
                    : Color.FromArgb(46, 204, 113);
            }
            else if (data.temp.HasValue && data.temp.Value > 0)
            {
                int t = (int)Math.Round(data.temp.Value);
                badgeText = t >= 100 ? t.ToString() : (t.ToString() + "°");
                badgeColor = t >= 80 ? Color.FromArgb(255, 95, 87)
                    : t >= 65 ? Color.FromArgb(255, 189, 46)
                    : Color.FromArgb(78, 201, 240);
            }

            Icon icon = IconRenderer.CreateBadgeIcon(badgeText, badgeColor);
            UpdateTrayIcon(icon);

            // 2. Update Context Menu rows
            if (data.temp.HasValue && data.temp.Value > 0)
            {
                double tempVal = data.temp.Value;
                _cpuTempItem.Text = string.Format("  CPU 温度:  {0:0}°C", tempVal);
                _cpuTempItem.ForeColor = tempVal >= 80 ? Color.FromArgb(255, 107, 107)
                    : tempVal >= 65 ? Color.FromArgb(255, 169, 77)
                    : Color.FromArgb(78, 201, 240);
                _cpuTempItem.Visible = true;
            }
            else
            {
                _cpuTempItem.Visible = false;
            }

            if (data.load.HasValue && data.load.Value >= 0)
            {
                string speedStr = (data.speed.HasValue && data.speed.Value > 0)
                    ? string.Format("  ({0:0.0} GHz)", data.speed.Value)
                    : "";
                _cpuLoadItem.Text = string.Format("  CPU 占用:  {0:0}%{1}", data.load.Value, speedStr);
                _cpuLoadItem.Visible = true;
            }
            else
            {
                _cpuLoadItem.Visible = false;
            }

            if (metrics.memoryUsage && data.memoryPercent.HasValue && data.memoryPercent.Value > 0)
            {
                double usedGb = (data.memoryUsedBytes ?? 0) / (1024.0 * 1024.0 * 1024.0);
                double totalGb = (data.memoryTotalBytes ?? 0) / (1024.0 * 1024.0 * 1024.0);
                if (usedGb > 0 && totalGb > 0)
                {
                    _memItem.Text = string.Format("  内存使用:  {0:0}%  ({1:0.0} / {2:0.0} GB)", data.memoryPercent.Value, usedGb, totalGb);
                }
                else
                {
                    _memItem.Text = string.Format("  内存使用:  {0:0}%", data.memoryPercent.Value);
                }
                _memItem.Visible = true;
            }
            else
            {
                _memItem.Visible = false;
            }

            if (metrics.fanSpeed && data.fanSpeed.HasValue && data.fanSpeed.Value > 0)
            {
                _fanItem.Text = string.Format("  风扇转速:  {0:0} RPM", data.fanSpeed.Value);
                _fanItem.Visible = true;
            }
            else
            {
                _fanItem.Visible = false;
            }

            if (metrics.networkIo && ((data.networkDownloadBytesPerSec ?? 0) > 0 || (data.networkUploadBytesPerSec ?? 0) > 0))
            {
                double downSpeed = data.networkDownloadBytesPerSec ?? 0;
                double upSpeed = data.networkUploadBytesPerSec ?? 0;
                _netItem.Text = string.Format("  实时网速:  ↓{0}  ↑{1}", FormatSpeed(downSpeed), FormatSpeed(upSpeed));
                _netItem.Visible = true;
            }
            else
            {
                _netItem.Visible = false;
            }
        }

        private void UpdateTrayIcon(Icon newIcon)
        {
            if (newIcon == null || _trayIcon == null) return;
            IntPtr newHIcon = newIcon.Handle;
            _trayIcon.Icon = newIcon;

            if (_previousHIcon != IntPtr.Zero)
            {
                DestroyIcon(_previousHIcon);
            }
            _previousHIcon = newHIcon;
        }

        private static string FormatSpeed(double bytes)
        {
            if (bytes <= 0) return "0K";
            if (bytes >= 1024 * 1024 * 10) return (bytes / (1024 * 1024)).ToString("0") + "M";
            if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).ToString("0.0") + "M";
            if (bytes >= 1024 * 10) return (bytes / 1024).ToString("0") + "K";
            if (bytes >= 1024) return (bytes / 1024).ToString("0.0") + "K";
            return "1K";
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (_pollTimer != null)
                {
                    _pollTimer.Stop();
                    _pollTimer.Dispose();
                }
                if (_parentWatchTimer != null)
                {
                    _parentWatchTimer.Stop();
                    _parentWatchTimer.Dispose();
                }

                if (_trayIcon != null)
                {
                    _trayIcon.Visible = false;
                    _trayIcon.Dispose();
                    _trayIcon = null;
                }

                if (_previousHIcon != IntPtr.Zero)
                {
                    DestroyIcon(_previousHIcon);
                    _previousHIcon = IntPtr.Zero;
                }

                if (_menu != null)
                {
                    _menu.Dispose();
                }

                if (_dummyForm != null)
                {
                    _dummyForm.Dispose();
                }
            }
            base.Dispose(disposing);
        }
    }

    internal static class IconRenderer
    {
        public static Icon CreateBadgeIcon(string text, Color toneColor)
        {
            const int size = 32;

            using (Bitmap bmp = new Bitmap(size, size))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.Clear(Color.Transparent);

                // Background badge filling the 32x32 canvas
                int pad = 1;
                Rectangle rect = new Rectangle(pad, pad, size - pad * 2, size - pad * 2);
                using (GraphicsPath path = CreateRoundedRectangle(rect, 6))
                {
                    // Dark slate background: RGBA(14, 20, 28, 235)
                    using (SolidBrush bgBrush = new SolidBrush(Color.FromArgb(235, 14, 20, 28)))
                    {
                        g.FillPath(bgBrush, path);
                    }
                    using (Pen borderPen = new Pen(Color.FromArgb(175, toneColor.R, toneColor.G, toneColor.B), 1.8f))
                    {
                        g.DrawPath(borderPen, path);
                    }
                }

                // Auto-fit font size according to string length
                float fontSize;
                if (text.Length <= 2)
                {
                    fontSize = 19.0f;
                }
                else if (text.Length == 3)
                {
                    fontSize = 16.5f;
                }
                else
                {
                    fontSize = 14.0f;
                }

                using (Font font = CreateOptimizedFont(fontSize))
                using (SolidBrush textBrush = new SolidBrush(toneColor))
                using (StringFormat sf = new StringFormat())
                {
                    sf.Alignment = StringAlignment.Center;
                    sf.LineAlignment = StringAlignment.Center;
                    // Slightly shift down 1.2px for optical vertical centering
                    RectangleF textRect = new RectangleF(0, 1.2f, size, size);
                    g.DrawString(text, font, textBrush, textRect, sf);
                }

                IntPtr hIcon = bmp.GetHicon();
                return Icon.FromHandle(hIcon);
            }
        }

        private static Font CreateOptimizedFont(float fontSize)
        {
            try
            {
                return new Font("Bahnschrift", fontSize, FontStyle.Bold, GraphicsUnit.Pixel);
            }
            catch
            {
                return new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel);
            }
        }

        private static GraphicsPath CreateRoundedRectangle(Rectangle bounds, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            Rectangle arc = new Rectangle(bounds.Location, new Size(diameter, diameter));

            // Top-left
            path.AddArc(arc, 180, 90);

            // Top-right
            arc.X = bounds.Right - diameter;
            path.AddArc(arc, 270, 90);

            // Bottom-right
            arc.Y = bounds.Bottom - diameter;
            path.AddArc(arc, 0, 90);

            // Bottom-left
            arc.X = bounds.Left;
            path.AddArc(arc, 90, 90);

            path.CloseFigure();
            return path;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            if (!TrayApplicationContext.AcquireSingleInstance())
            {
                return;
            }

            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (TrayApplicationContext context = new TrayApplicationContext())
                {
                    Application.Run(context);
                }
            }
            finally
            {
                TrayApplicationContext.ReleaseSingleInstance();
            }
        }
    }
}
