using System;
using System.Collections.Generic;
using System.Diagnostics;
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
            try
            {
                IntPtr pci = (proto == 2) ? GetPciT1() : GetPciT0();
                // Select Thai National ID Applet
                byte[] selectCmd = new byte[] { 0x00, 0xA4, 0x04, 0x00, 0x08, 0xA0, 0x00, 0x00, 0x00, 0x54, 0x48, 0x00, 0x01 };
                SendApdu(hCard, pci, selectCmd);

                // 1. CID (13 digits)
                byte[] cidBytes = SendApdu(hCard, pci, new byte[] { 0x80, 0xB0, 0x00, 0x04, 0x02, 0x00, 0x0D });
                string cid = DecodeThai(cidBytes);

                // 2. Thai Fullname (100 bytes)
                byte[] thNameBytes = SendApdu(hCard, pci, new byte[] { 0x80, 0xB0, 0x00, 0x11, 0x02, 0x00, 0x64 });
                string thNameRaw = DecodeThai(thNameBytes);

                // 3. DOB (8 bytes YYYYMMDD BE)
                byte[] dobBytes = SendApdu(hCard, pci, new byte[] { 0x80, 0xB0, 0x00, 0xD9, 0x02, 0x00, 0x08 });
                string dobRaw = DecodeThai(dobBytes);

                // 4. Gender (1 byte: 1=Male, 2=Female)
                byte[] genderBytes = SendApdu(hCard, pci, new byte[] { 0x80, 0xB0, 0x00, 0xE1, 0x02, 0x00, 0x01 });
                string genderRaw = DecodeThai(genderBytes);

                // 5. Address (100 bytes)
                byte[] addrBytes = SendApdu(hCard, pci, new byte[] { 0x80, 0xB0, 0x15, 0x79, 0x02, 0x00, 0x64 });
                string addrRaw = DecodeThai(addrBytes);

                // 6. Photo
                var photoMs = new System.IO.MemoryStream();
                for (int i = 0; i < 20; i++)
                {
                    int offset = 0x017B + (i * 0xFF);
                    byte p1 = (byte)((offset >> 8) & 0xFF);
                    byte p2 = (byte)(offset & 0xFF);
                    byte le = (byte)((i == 19) ? 0x16 : 0xFF);
                    byte[] chunk = SendApdu(hCard, pci, new byte[] { 0x80, 0xB0, p1, p2, 0x02, 0x00, le });
                    if (chunk == null && i == 19)
                    {
                        chunk = SendApdu(hCard, pci, new byte[] { 0x80, 0xB0, p1, p2, 0x02, 0x00, 0xFF });
                    }
                    if (chunk != null && chunk.Length > 0)
                    {
                        photoMs.Write(chunk, 0, chunk.Length);
                    }
                }
                byte[] rawPhoto = photoMs.ToArray();
                string photoBase64 = "";
                if (rawPhoto.Length > 4)
                {
                    int soi = -1;
                    int eoi = -1;
                    for (int idx = 0; idx < rawPhoto.Length - 1; idx++)
                    {
                        if (soi == -1 && rawPhoto[idx] == 0xFF && rawPhoto[idx + 1] == 0xD8) soi = idx;
                        if (soi != -1 && rawPhoto[idx] == 0xFF && rawPhoto[idx + 1] == 0xD9) eoi = idx + 2;
                    }
                    if (soi != -1 && eoi > soi)
                    {
                        byte[] jpg = new byte[eoi - soi];
                        Array.Copy(rawPhoto, soi, jpg, 0, jpg.Length);
                        photoBase64 = "data:image/jpeg;base64," + Convert.ToBase64String(jpg);
                    }
                    else if (rawPhoto[0] == 0xFF && rawPhoto[1] == 0xD8)
                    {
                        photoBase64 = "data:image/jpeg;base64," + Convert.ToBase64String(rawPhoto);
                    }
                }

                string[] nameParts = thNameRaw.Split('#');
                string title = nameParts.Length > 0 ? nameParts[0].Trim() : "";
                string firstName = nameParts.Length > 1 ? nameParts[1].Trim() : "";
                string middleName = nameParts.Length > 2 ? nameParts[2].Trim() : "";
                string lastName = nameParts.Length > 3 ? nameParts[3].Trim() : "";
                string fullname = string.Join(" ", new[] { title, firstName, middleName, lastName }).Trim();
                while (fullname.Contains("  ")) fullname = fullname.Replace("  ", " ");

                result["status"] = "success";
                result["cid"] = cid;
                result["title"] = title;
                result["firstName"] = firstName;
                result["lastName"] = lastName;
                result["fullname"] = fullname;
                result["dob"] = dobRaw;
                result["gender"] = genderRaw;
                result["address"] = addrRaw.Replace("#", " ").Trim();
                result["photoBase64"] = photoBase64;
                result["readerName"] = readerName;
                return result;
            }
            finally
            {
                SCardDisconnect(hCard, 0);
            }
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
    private static Process pEdge;
    private static string baseDir;
    private static int currentServerPort = 8080;
    private static List<WebSocket> wsClients = new List<WebSocket>();

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
                            bool present = ThaiSmartCardReader.IsCardPresent(readers[0]);
                            if (present && !wasPresent)
                            {
                                Thread.Sleep(250);
                                string cardJson = BuildCardJson();
                                BroadcastWs(cardJson);
                            }
                            wasPresent = present;
                        }
                        else
                        {
                            wasPresent = false;
                        }
                    }
                    catch { wasPresent = false; }
                    Thread.Sleep(500);
                }
            });
        }
        catch { }
    }

    private static void BroadcastWs(string text)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        var seg = new ArraySegment<byte>(bytes);
        lock (wsClients)
        {
            for (int i = wsClients.Count - 1; i >= 0; i--)
            {
                try
                {
                    var ws = wsClients[i];
                    if (ws.State == WebSocketState.Open)
                    {
                        ws.SendAsync(seg, WebSocketMessageType.Text, true, CancellationToken.None).Wait();
                    }
                    else
                    {
                        wsClients.RemoveAt(i);
                    }
                }
                catch { wsClients.RemoveAt(i); }
            }
        }
    }

    private static void HandleBridgeRequest(HttpListenerContext context)
    {
        try
        {
            var req = context.Request;
            var res = context.Response;

            res.AddHeader("Access-Control-Allow-Origin", "*");
            res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.AddHeader("Access-Control-Allow-Headers", "*");
            res.AddHeader("Access-Control-Allow-Private-Network", "true");

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
                ws.SendAsync(new ArraySegment<byte>(initBytes), WebSocketMessageType.Text, true, CancellationToken.None).Wait();

                ThreadPool.QueueUserWorkItem((o) =>
                {
                    byte[] buf = new byte[4096];
                    while (ws.State == WebSocketState.Open)
                    {
                        try
                        {
                            var r = ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None).GetAwaiter().GetResult();
                            if (r.MessageType == WebSocketMessageType.Close) break;
                            string reply = BuildCardJson();
                            byte[] repBytes = Encoding.UTF8.GetBytes(reply);
                            ws.SendAsync(new ArraySegment<byte>(repBytes), WebSocketMessageType.Text, true, CancellationToken.None).Wait();
                        }
                        catch { break; }
                    }
                    lock (wsClients) wsClients.Remove(ws);
                });
                return;
            }

            string path = req.Url.LocalPath.TrimEnd('/');
            string json = "";

            if (path == "/api/status" || string.IsNullOrEmpty(path))
            {
                json = BuildStatusJson();
            }
            else if (path == "/api/card")
            {
                json = BuildCardJson();
            }
            else
            {
                res.StatusCode = 404;
                json = "{\"error\":\"Not Found\"}";
            }

            res.ContentType = "application/json; charset=utf-8";
            byte[] b = Encoding.UTF8.GetBytes(json);
            res.ContentLength64 = b.Length;
            res.OutputStream.Write(b, 0, b.Length);
            res.Close();
        }
        catch { }
    }

    private static int StartBuiltinHttpServer()
    {
        int[] candidatePorts = new int[] { 8080, 8081, 8082, 8088, 8888, 9090 };

        foreach (int port in candidatePorts)
        {
            try
            {
                var listener = new HttpListener();
                listener.Prefixes.Add("http://localhost:" + port + "/");
                listener.Start();

                serverListener = listener;
                currentServerPort = port;

                ThreadPool.QueueUserWorkItem((o) =>
                {
                    while (serverListener != null && serverListener.IsListening)
                    {
                        try
                        {
                            var context = serverListener.GetContext();
                            ThreadPool.QueueUserWorkItem((c) => HandleRequest((HttpListenerContext)c), context);
                        }
                        catch { }
                    }
                });

                return port;
            }
            catch { }
        }

        return -1;
    }

    private static void HandleRequest(HttpListenerContext context)
    {
        try
        {
            var req = context.Request;
            var res = context.Response;

            res.AddHeader("Access-Control-Allow-Origin", "*");
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

            string decoded = Uri.UnescapeDataString(urlPath).Replace('/', Path.DirectorySeparatorChar);
            string filePath = Path.Combine(baseDir, decoded);

            if (File.Exists(filePath))
            {
                string ext = Path.GetExtension(filePath);
                string mime;
                if (!mimeTypes.TryGetValue(ext, out mime)) mime = "application/octet-stream";
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

        // 2. เริ่มต้น Built-in Smart Card Bridge ทันที (Port 8084 แบบ Pure C# ไร้ PowerShell)
        StartBuiltinBridgeServer(8084);

        // 3. เริ่มต้น Built-in Web Server ทันทีในระดับ C#
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

        // 4. ตรวจหา Microsoft Edge หรือ Google Chrome เพื่อเปิดในโหมด App
        string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
        if (!File.Exists(edgePath))
        {
            edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
        }
        string chromePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
        if (!File.Exists(chromePath))
        {
            chromePath = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";
        }

        string browserPath = File.Exists(edgePath) ? edgePath : (File.Exists(chromePath) ? chromePath : null);

        if (browserPath != null)
        {
            try
            {
                string profileDir = Path.Combine(Path.GetTempPath(), "TempleRegisterProfile");
                var psiEdge = new ProcessStartInfo
                {
                    FileName = browserPath,
                    Arguments = "--app=" + targetUrl + " --disable-features=Translate --no-first-run --no-default-browser-check --user-data-dir=\"" + profileDir + "\" --window-size=1366,768",
                    UseShellExecute = true
                };
                pEdge = Process.Start(psiEdge);

                if (pEdge != null)
                {
                    pEdge.WaitForExit();
                }
            }
            catch
            {
                Process.Start(targetUrl);
            }
        }
        else
        {
            Process.Start(targetUrl);
        }

        // 5. ปิดบริการเบื้องหลังเมื่อปิดหน้าต่างโปรแกรม
        Cleanup();
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
