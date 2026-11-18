using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class ThaiSmartCardReader
{
    [DllImport("winscard.dll")]
    public static extern int SCardEstablishContext(uint dwScope, IntPtr pvReserved1, IntPtr pvReserved2, out IntPtr phContext);

    [DllImport("winscard.dll")]
    public static extern int SCardReleaseContext(IntPtr hContext);

    [DllImport("winscard.dll", CharSet = CharSet.Unicode)]
    public static extern int SCardListReaders(IntPtr hContext, string mszGroups, byte[] mszReaders, ref uint pcchReaders);

    [DllImport("winscard.dll", CharSet = CharSet.Unicode)]
    public static extern int SCardConnect(IntPtr hContext, string szReader, uint dwShareMode, uint dwPreferredProtocols, out IntPtr phCard, out uint pdwActiveProtocol);

    [DllImport("winscard.dll")]
    public static extern int SCardDisconnect(IntPtr hCard, uint dwDisposition);

    [DllImport("winscard.dll")]
    public static extern int SCardTransmit(IntPtr hCard, IntPtr pioSendPci, byte[] pbSendBuffer, int cbSendLength, IntPtr pioRecvPci, byte[] pbRecvBuffer, ref int pcbRecvLength);

    [StructLayout(LayoutKind.Sequential)]
    public struct SCARD_IO_REQUEST
    {
        public uint dwProtocol;
        public uint cbPciLength;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

    private static IntPtr GetPciT0()
    {
        IntPtr hMod = LoadLibrary("winscard.dll");
        return GetProcAddress(hMod, "g_rgSCardT0Pci");
    }

    private static IntPtr GetPciT1()
    {
        IntPtr hMod = LoadLibrary("winscard.dll");
        return GetProcAddress(hMod, "g_rgSCardT1Pci");
    }

    public static List<string> ListReaders()
    {
        var list = new List<string>();
        IntPtr ctx;
        if (SCardEstablishContext(2, IntPtr.Zero, IntPtr.Zero, out ctx) != 0) return list;
        try
        {
            uint len = 0;
            int rc = SCardListReaders(ctx, null, null, ref len);
            if (rc != 0 || len <= 2) return list;
            byte[] buf = new byte[len * 2];
            rc = SCardListReaders(ctx, null, buf, ref len);
            if (rc != 0) return list;
            string all = Encoding.Unicode.GetString(buf, 0, (int)(len * 2));
            foreach (var r in all.Split('\0'))
            {
                if (!string.IsNullOrWhiteSpace(r)) list.Add(r);
            }
        }
        finally
        {
            SCardReleaseContext(ctx);
        }
        return list;
    }

    public static bool IsCardPresent(string readerName)
    {
        IntPtr ctx;
        if (SCardEstablishContext(2, IntPtr.Zero, IntPtr.Zero, out ctx) != 0) return false;
        try
        {
            IntPtr hCard;
            uint proto;
            int rc = SCardConnect(ctx, readerName, 2, 3, out hCard, out proto);
            if (rc == 0)
            {
                SCardDisconnect(hCard, 0);
                return true;
            }
            return false;
        }
        finally
        {
            SCardReleaseContext(ctx);
        }
    }

    private static byte[] SendApdu(IntPtr hCard, IntPtr pci, byte[] apdu)
    {
        byte[] recv = new byte[512];
        int recvLen = recv.Length;
        int rc = SCardTransmit(hCard, pci, apdu, apdu.Length, IntPtr.Zero, recv, ref recvLen);
        if (rc != 0 || recvLen < 2) return null;

        byte sw1 = recv[recvLen - 2];
        byte sw2 = recv[recvLen - 1];
        if (sw1 == 0x61)
        {
            byte[] getResp = new byte[] { 0x00, 0xC0, 0x00, 0x00, sw2 };
            byte[] recv2 = new byte[512];
            int recvLen2 = recv2.Length;
            rc = SCardTransmit(hCard, pci, getResp, getResp.Length, IntPtr.Zero, recv2, ref recvLen2);
            if (rc != 0 || recvLen2 < 2) return null;
            byte[] data = new byte[recvLen2 - 2];
            Array.Copy(recv2, 0, data, 0, data.Length);
            return data;
        }

        if (sw1 == 0x90 && sw2 == 0x00)
        {
            byte[] data = new byte[recvLen - 2];
            Array.Copy(recv, 0, data, 0, data.Length);
            return data;
        }
        return null;
    }

    private static string DecodeThai(byte[] data)
    {
        if (data == null) return "";
        Encoding tis620 = Encoding.GetEncoding(874);
        return tis620.GetString(data).Trim('\0', ' ');
    }

    public static Dictionary<string, string> ReadThaiIdCard(string readerName)
    {
        var result = new Dictionary<string, string>();
        IntPtr ctx;
        if (SCardEstablishContext(2, IntPtr.Zero, IntPtr.Zero, out ctx) != 0)
        {
            result["error"] = "Cannot establish smart card context";
            return result;
        }
        try
        {
            IntPtr hCard;
            uint proto;
            int rc = SCardConnect(ctx, readerName, 2, 3, out hCard, out proto);
            if (rc != 0)
            {
                result["error"] = "No card inserted or cannot connect (rc=" + rc + ")";
                return result;
            }

            IntPtr pci = (proto == 2) ? GetPciT1() : GetPciT0();

            // Select Thai ID Card Applet
            byte[] aid = new byte[] { 0x00, 0xA4, 0x04, 0x00, 0x08, 0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01 };
            byte[] selRes = SendApdu(hCard, pci, aid);
            if (selRes == null)
            {
                // Try second MOI applet
                byte[] aid2 = new byte[] { 0x00, 0xA4, 0x04, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x01, 0x77, 0x10, 0x02 };
                SendApdu(hCard, pci, aid2);
            }

            // Read CID (13 digits)
            byte[] reqCid = new byte[] { 0x80, 0xb0, 0x00, 0x04, 0x02, 0x00, 0x0d };
            byte[] respCid = SendApdu(hCard, pci, reqCid);
            if (respCid != null)
            {
                result["cid"] = DecodeThai(respCid);
            }

            // Read Thai Fullname
            byte[] reqName = new byte[] { 0x80, 0xb0, 0x00, 0x11, 0x02, 0x00, 0x64 };
            byte[] respName = SendApdu(hCard, pci, reqName);
            if (respName != null)
            {
                string rawName = DecodeThai(respName);
                string[] parts = rawName.Split('#');
                result["title"] = parts.Length > 0 ? parts[0].Trim() : "";
                result["firstName"] = parts.Length > 1 ? parts[1].Trim() : "";
                result["middleName"] = parts.Length > 2 ? parts[2].Trim() : "";
                result["lastName"] = parts.Length > 3 ? parts[3].Trim() : "";
                result["fullname"] = (result["title"] + " " + result["firstName"] + " " + result["lastName"]).Trim();
            }

            // Read English Name
            byte[] reqNameEn = new byte[] { 0x80, 0xb0, 0x00, 0x75, 0x02, 0x00, 0x64 };
            byte[] respNameEn = SendApdu(hCard, pci, reqNameEn);
            if (respNameEn != null)
            {
                string rawNameEn = DecodeThai(respNameEn);
                string[] partsEn = rawNameEn.Split('#');
                result["nameEn"] = string.Join(" ", partsEn).Trim();
            }

            // Read Date of Birth (YYYYMMDD)
            byte[] reqDob = new byte[] { 0x80, 0xb0, 0x00, 0xD9, 0x02, 0x00, 0x08 };
            byte[] respDob = SendApdu(hCard, pci, reqDob);
            if (respDob != null)
            {
                result["dob"] = DecodeThai(respDob);
            }

            // Read Gender (1=ชาย, 2=หญิง)
            byte[] reqGender = new byte[] { 0x80, 0xb0, 0x00, 0xE1, 0x02, 0x00, 0x01 };
            byte[] respGender = SendApdu(hCard, pci, reqGender);
            if (respGender != null)
            {
                string g = DecodeThai(respGender);
                result["gender"] = (g == "1") ? "ชาย" : ((g == "2") ? "หญิง" : g);
            }

            // Read Address
            byte[] reqAddr = new byte[] { 0x80, 0xb0, 0x15, 0x79, 0x02, 0x00, 0x64 };
            byte[] respAddr = SendApdu(hCard, pci, reqAddr);
            if (respAddr != null)
            {
                string rawAddr = DecodeThai(respAddr).Replace("#", " ").Trim();
                result["address"] = rawAddr;
            }

            // Read Photo (approx 20 parts of 254 bytes)
            try
            {
                List<byte> photoBytes = new List<byte>();
                for (int part = 0; part < 20; part++)
                {
                    int offset = 0x017B + (part * 254);
                    byte p1 = (byte)((offset >> 8) & 0xFF);
                    byte p2 = (byte)(offset & 0xFF);
                    byte[] reqPhoto = new byte[] { 0x80, 0xb0, p1, p2, 0x02, 0x00, 0xFE };
                    byte[] chunk = SendApdu(hCard, pci, reqPhoto);
                    if (chunk != null && chunk.Length > 0)
                    {
                        photoBytes.AddRange(chunk);
                    }
                    else
                    {
                        break;
                    }
                }
                if (photoBytes.Count > 100)
                {
                    result["photoBase64"] = "data:image/jpeg;base64," + Convert.ToBase64String(photoBytes.ToArray());
                }
            }
            catch { }

            SCardDisconnect(hCard, 0);
            result["status"] = "success";
            return result;
        }
        catch (Exception ex)
        {
            result["error"] = ex.Message;
            return result;
        }
        finally
        {
            SCardReleaseContext(ctx);
        }
    }
}

public class Program
{
    private static HttpListener serverListener;
    private static HttpListener bridgeListener;
    private static string baseDir;
    private static int currentServerPort = 8080;
    private static List<WebSocket> wsClients = new List<WebSocket>();
    private static NotifyIcon notifyIcon;

    private static readonly Dictionary<string, string> mimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".js", "application/javascript; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".jpg", "image/jpeg" },
        { ".jpeg", "image/jpeg" },
        { ".png", "image/png" },
        { ".svg", "image/svg+xml" },
        { ".ico", "image/x-icon" }
    };

    private static string EscapeJson(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    private static string BuildStatusJson()
    {
        var readers = ThaiSmartCardReader.ListReaders();
        string rName = readers.Count > 0 ? readers[0] : "";
        bool inserted = false;
        if (!string.IsNullOrEmpty(rName))
        {
            inserted = ThaiSmartCardReader.IsCardPresent(rName);
        }
        StringBuilder sb = new StringBuilder();
        sb.Append("{");
        sb.Append("\"agentOnline\":true,");
        sb.Append("\"readerDetected\":" + (readers.Count > 0 ? "true" : "false") + ",");
        sb.Append("\"readerName\":\"" + EscapeJson(rName) + "\",");
        sb.Append("\"readers\":[");
        for (int i = 0; i < readers.Count; i++)
        {
            sb.Append("\"" + EscapeJson(readers[i]) + "\"");
            if (i < readers.Count - 1) sb.Append(",");
        }
        sb.Append("],");
        sb.Append("\"cardInserted\":" + (inserted ? "true" : "false"));
        sb.Append("}");
        return sb.ToString();
    }

    private static string BuildCardJson()
    {
        var readers = ThaiSmartCardReader.ListReaders();
        if (readers.Count == 0)
        {
            return "{\"status\":\"error\",\"message\":\"ไม่พบเครื่องอ่านบัตร USB\",\"readerDetected\":false}";
        }
        var card = ThaiSmartCardReader.ReadThaiIdCard(readers[0]);
        StringBuilder sb = new StringBuilder();
        sb.Append("{");
        int count = 0;
        foreach (var kvp in card)
        {
            if (count > 0) sb.Append(",");
            sb.Append("\"" + EscapeJson(kvp.Key) + "\":\"" + EscapeJson(kvp.Value) + "\"");
            count++;
        }
        sb.Append(",\"readerDetected\":true");
        sb.Append("}");
        return sb.ToString();
    }

    private static void StartBuiltinBridgeServer(int port)
    {
        try
        {
            bridgeListener = new HttpListener();
            bridgeListener.Prefixes.Add("http://localhost:" + port + "/");
            bridgeListener.Start();

            // Background thread to serve Bridge HTTP / WebSocket requests
            ThreadPool.QueueUserWorkItem((o) =>
            {
                while (bridgeListener != null && bridgeListener.IsListening)
                {
                    try
                    {
                        var context = bridgeListener.GetContext();
                        ThreadPool.QueueUserWorkItem((c) => HandleBridgeRequest((HttpListenerContext)c), context);
                    }
                    catch { }
                }
            });

            // Background card auto-detect thread
            ThreadPool.QueueUserWorkItem((o) =>
            {
                bool wasPresent = false;
                while (bridgeListener != null && bridgeListener.IsListening)
                {
                    try
                    {
                        var readers = ThaiSmartCardReader.ListReaders();
                        if (readers.Count > 0)
                        {
                            bool isNowPresent = ThaiSmartCardReader.IsCardPresent(readers[0]);
                            if (isNowPresent && !wasPresent)
                            {
                                // Card just inserted! Read and broadcast to WebSockets
                                Thread.Sleep(300);
                                var cardData = ThaiSmartCardReader.ReadThaiIdCard(readers[0]);
                                if (cardData != null && cardData.ContainsKey("cid"))
                                {
                                    StringBuilder sb = new StringBuilder();
                                    sb.Append("{\"type\":\"card_inserted\",\"data\":{");
                                    int c = 0;
                                    foreach (var kvp in cardData)
                                    {
                                        if (c > 0) sb.Append(",");
                                        sb.Append("\"" + EscapeJson(kvp.Key) + "\":\"" + EscapeJson(kvp.Value) + "\"");
                                        c++;
                                    }
                                    sb.Append("}}");
                                    BroadcastWebSocket(sb.ToString());
                                }
                            }
                            wasPresent = isNowPresent;
                        }
                        else
                        {
                            wasPresent = false;
                        }
                    }
                    catch { }
                    Thread.Sleep(800);
                }
            });
        }
        catch { }
    }

    private static void BroadcastWebSocket(string message)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(message);
        lock (wsClients)
        {
            for (int i = wsClients.Count - 1; i >= 0; i--)
            {
                var ws = wsClients[i];
                if (ws != null && ws.State == WebSocketState.Open)
                {
                    try
                    {
                        ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                    catch { }
                }
                else
                {
                    wsClients.RemoveAt(i);
                }
            }
        }
    }

    private static void HandleBridgeRequest(HttpListenerContext context)
    {
        try
        {
            var req = context.Request;
            var res = context.Response;

            string origin = req.Headers["Origin"];
            if (string.IsNullOrEmpty(origin)) origin = "*";

            res.AddHeader("Access-Control-Allow-Origin", origin);
            res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
            res.AddHeader("Access-Control-Allow-Private-Network", "true");
            res.AddHeader("Access-Control-Max-Age", "86400");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            if (req.IsWebSocketRequest)
            {
                var wsContext = context.AcceptWebSocketAsync(null).GetAwaiter().GetResult();
                var ws = wsContext.WebSocket;
                lock (wsClients) wsClients.Add(ws);

                string initStatus = "{\"type\":\"status\",\"data\":" + BuildStatusJson() + "}";
                byte[] initBytes = Encoding.UTF8.GetBytes(initStatus);
                ws.SendAsync(new ArraySegment<byte>(initBytes), WebSocketMessageType.Text, true, CancellationToken.None);

                ThreadPool.QueueUserWorkItem(async (o) =>
                {
                    byte[] buffer = new byte[1024];
                    while (ws.State == WebSocketState.Open)
                    {
                        try
                        {
                            var r = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                            if (r.MessageType == WebSocketMessageType.Close)
                            {
                                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                                break;
                            }
                            else if (r.MessageType == WebSocketMessageType.Text)
                            {
                                string msg = Encoding.UTF8.GetString(buffer, 0, r.Count);
                                if (msg.Contains("read_card") || msg.Contains("\"read\""))
                                {
                                    string cardJson = BuildCardJson();
                                    string outMsg = "{\"type\":\"card_read\",\"data\":" + cardJson + "}";
                                    byte[] outBytes = Encoding.UTF8.GetBytes(outMsg);
                                    await ws.SendAsync(new ArraySegment<byte>(outBytes), WebSocketMessageType.Text, true, CancellationToken.None);
                                }
                            }
                        }
                        catch { break; }
                    }
                    lock (wsClients) wsClients.Remove(ws);
                });
                return;
            }

            string rawPath = req.Url.LocalPath.ToLowerInvariant();
            res.ContentType = "application/json; charset=utf-8";

            if (rawPath == "/api/status" || rawPath == "/status")
            {
                string json = BuildStatusJson();
                byte[] b = Encoding.UTF8.GetBytes(json);
                res.ContentLength64 = b.Length;
                res.OutputStream.Write(b, 0, b.Length);
            }
            else if (rawPath == "/api/card" || rawPath == "/card")
            {
                string json = BuildCardJson();
                byte[] b = Encoding.UTF8.GetBytes(json);
                res.ContentLength64 = b.Length;
                res.OutputStream.Write(b, 0, b.Length);
            }
            else
            {
                string json = "{\"status\":\"ok\",\"service\":\"TempleRegister Bridge\",\"port\":8084}";
                byte[] b = Encoding.UTF8.GetBytes(json);
                res.ContentLength64 = b.Length;
                res.OutputStream.Write(b, 0, b.Length);
            }
            res.Close();
        }
        catch { }
    }

    private static int StartBuiltinHttpServer()
    {
        int[] candidatePorts = new int[] { 8080, 8081, 8082, 8088, 8888, 9090 };
        foreach (int p in candidatePorts)
        {
            try
            {
                var l = new HttpListener();
                l.Prefixes.Add("http://localhost:" + p + "/");
                l.Start();
                serverListener = l;
                currentServerPort = p;

                ThreadPool.QueueUserWorkItem((o) =>
                {
                    while (serverListener != null && serverListener.IsListening)
                    {
                        try
                        {
                            var ctx = serverListener.GetContext();
                            ThreadPool.QueueUserWorkItem((c) => HandleHttpRequest((HttpListenerContext)c), ctx);
                        }
                        catch { }
                    }
                });

                return p;
            }
            catch { }
        }
        return -1;
    }

    private static void HandleHttpRequest(HttpListenerContext context)
    {
        try
        {
            var req = context.Request;
            var res = context.Response;

            string origin = req.Headers["Origin"];
            if (string.IsNullOrEmpty(origin)) origin = "*";

            res.AddHeader("Access-Control-Allow-Origin", origin);
            res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.AddHeader("Access-Control-Allow-Private-Network", "true");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            string urlPath = req.Url.LocalPath.TrimStart('/');
            if (string.IsNullOrEmpty(urlPath)) urlPath = "index.html";

            string decoded = Uri.UnescapeDataString(urlPath);
            string filePath = Path.Combine(baseDir, decoded.Replace('/', Path.DirectorySeparatorChar));

            if (File.Exists(filePath))
            {
                string ext = Path.GetExtension(filePath);
                string mime;
                if (!mimeTypes.TryGetValue(ext, out mime))
                {
                    mime = "application/octet-stream";
                }
                res.ContentType = mime;

                byte[] bytes = File.ReadAllBytes(filePath);
                res.ContentLength64 = bytes.Length;
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            else
            {
                res.StatusCode = 404;
                byte[] err = Encoding.UTF8.GetBytes("404 Not Found: " + decoded);
                res.ContentLength64 = err.Length;
                res.OutputStream.Write(err, 0, err.Length);
            }
            res.Close();
        }
        catch { }
    }

    public static void LaunchBrowser(string url)
    {
        string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
        if (!File.Exists(edgePath)) edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
        string chromePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
        if (!File.Exists(chromePath)) chromePath = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";

        string browserPath = File.Exists(edgePath) ? edgePath : (File.Exists(chromePath) ? chromePath : null);

        if (browserPath != null)
        {
            try
            {
                string profileDir = Path.Combine(Path.GetTempPath(), "TempleRegisterProfile");
                var psi = new ProcessStartInfo
                {
                    FileName = browserPath,
                    Arguments = "--app=" + url + " --disable-features=Translate --no-first-run --no-default-browser-check --user-data-dir=\"" + profileDir + "\" --window-size=1366,768",
                    UseShellExecute = true
                };
                Process.Start(psi);
                return;
            }
            catch { }
        }

        try { Process.Start(url); } catch { }
    }

    [STAThread]
    public static void Main()
    {
        baseDir = AppDomain.CurrentDomain.BaseDirectory;

        // 1. ตรวจสอบว่าแตกไฟล์ ZIP หรือยัง ถ้าดับเบิลคลิกจากใน zip ตรงๆ จะไม่มี index.html
        if (!File.Exists(Path.Combine(baseDir, "index.html")))
        {
            MessageBox.Show(
                "ตรวจพบว่าเปิดโปรแกรมจากในไฟล์ ZIP โดยตรง\n\nกรุณาคลิกขวาที่ไฟล์ ZIP แล้วเลือก 'Extract All...' (แตกไฟล์ทั้งหมด) ลงบนเครื่องคอมพิวเตอร์ก่อน แล้วจึงเปิดใช้งานใหม่อีกครั้งครับ",
                "ระบบลงทะเบียนเข้างานวัดหนองป่าพง",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning
            );
            return;
        }

        // 2. ตรวจสอบ Single Instance Mutex เพื่อป้องกันการรันซ้อนทับกัน
        bool isNewInstance;
        using (Mutex mutex = new Mutex(true, "TempleRegister_SingleInstance_Mutex_9981", out isNewInstance))
        {
            if (!isNewInstance)
            {
                // โปรแกรมทำงานอยู่แล้ว ให้เปิดหน้าต่างเว็บแล้วปิดตัวอินสแตนซ์ที่สอง
                LaunchBrowser("http://localhost:8080/");
                return;
            }

            // 3. เริ่มต้น Built-in Smart Card Bridge ทันที (Port 8084 แบบ Pure C#)
            StartBuiltinBridgeServer(8084);

            // 4. เริ่มต้น Built-in Web Server ทันทีในระดับ C#
            int activePort = StartBuiltinHttpServer();
            if (activePort == -1)
            {
                MessageBox.Show(
                    "ไม่สามารถเปิดบริการ Web Server ได้\nกรุณาตรวจสอบว่ามีโปรแกรมอื่นเปิดค้างอยู่หรือไม่",
                    "ระบบลงทะเบียนเข้างานวัดหนองป่าพง",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            string targetUrl = "http://localhost:" + activePort + "/";

            // 5. ติดตั้ง System Tray Icon เพื่อให้โปรแกรมรันเบื้องหลังได้อย่างมั่นคงตลอดเวลา
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Icon trayIco = null;
            string icoPath = Path.Combine(baseDir, "app.ico");
            if (File.Exists(icoPath))
            {
                try { trayIco = new Icon(icoPath); } catch { }
            }
            if (trayIco == null)
            {
                trayIco = SystemIcons.Application;
            }

            notifyIcon = new NotifyIcon();
            notifyIcon.Icon = trayIco;
            notifyIcon.Text = "ระบบลงทะเบียนเข้างานวัด (ออนไลน์ Port " + activePort + " & 8084)";
            notifyIcon.Visible = true;

            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("🌐 เปิดหน้าระบบลงทะเบียน (Open)", (s, e) => LaunchBrowser(targetUrl));
            menu.MenuItems.Add("🪪 ตรวจสอบเครื่องอ่านบัตร (Smart Card)", (s, e) =>
            {
                var readers = ThaiSmartCardReader.ListReaders();
                string msg = readers.Count > 0
                    ? "✓ พบเครื่องอ่านบัตร: " + string.Join(", ", readers.ToArray())
                    : "⚠️ ไม่พบเครื่องอ่านบัตร USB กรุณาตรวจสอบสายเสียบ";
                notifyIcon.ShowBalloonTip(4000, "สถานะเครื่องอ่านบัตรประชาชน", msg, ToolTipIcon.Info);
            });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("❌ ปิดโปรแกรมและออกจากระบบ (Exit)", (s, e) =>
            {
                notifyIcon.Visible = false;
                Cleanup();
                Application.Exit();
            });

            notifyIcon.ContextMenu = menu;
            notifyIcon.DoubleClick += (s, e) => LaunchBrowser(targetUrl);

            // แสดงแจ้งเตือนมุมขวาล่าง 1 ครั้ง
            try
            {
                notifyIcon.ShowBalloonTip(3000, "ระบบลงทะเบียนเข้างานวัด", "✓ ระบบพร้อมทำงานแล้ว (พอร์ต " + activePort + " และเครื่องอ่านบัตร 8084)", ToolTipIcon.Info);
            }
            catch { }

            // 6. เปิดเบราว์เซอร์ครั้งแรก
            LaunchBrowser(targetUrl);

            // 7. รัน Message Loop ต่อเนื่องเพื่อไม่ให้โปรแกรมปิดตัวลงทันที
            Application.Run();

            // 8. ล้างทรัพยากรเมื่อผู้ใช้ออกจากโปรแกรม
            if (notifyIcon != null)
            {
                notifyIcon.Visible = false;
                notifyIcon.Dispose();
            }
            Cleanup();
        }
    }

    private static void Cleanup()
    {
        try
        {
            if (serverListener != null)
            {
                serverListener.Stop();
                serverListener.Close();
                serverListener = null;
            }
        }
        catch { }

        try
        {
            if (bridgeListener != null)
            {
                bridgeListener.Stop();
                bridgeListener.Close();
                bridgeListener = null;
            }
        }
        catch { }
    }
}
