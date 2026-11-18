[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

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

                // 6. Photo (20 chunks x 255 bytes starting at 0x017B)
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
"@

$port = 8084
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Output "Smart Card Bridge started at http://localhost:$port/ (and ws://localhost:$port/)"

$wsClients = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))

function Get-ReaderStatus {
    $readers = [ThaiSmartCardReader]::ListReaders()
    $readerName = if ($readers.Count -gt 0) { $readers[0] } else { "" }
    $cardInserted = $false
    if ($readerName) {
        $cardInserted = [ThaiSmartCardReader]::IsCardPresent($readerName)
    }
    return @{
        agentOnline = $true
        readerDetected = ($readers.Count -gt 0)
        readers = @($readers)
        readerName = $readerName
        cardInserted = $cardInserted
    }
}

function Send-JsonResponse($response, $obj, $statusCode = 200) {
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $response.AddHeader("Access-Control-Allow-Origin", "*")
    $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $response.AddHeader("Access-Control-Allow-Headers", "*")
    $response.AddHeader("Access-Control-Allow-Private-Network", "true")
    $json = $obj | ConvertTo-Json -Depth 5 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
}

function Broadcast-WsMessage($jsonText) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonText)
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
    $snapshot = @($wsClients.ToArray())
    foreach ($client in $snapshot) {
        try {
            if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                $client.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
            } else {
                $wsClients.Remove($client)
            }
        } catch {
            $wsClients.Remove($client)
        }
    }
}

# Background Card Insertion Watcher (polls every 500ms & auto-pushes card data on insert)
[System.Threading.Tasks.Task]::Run([Action]{
    $wasPresent = $false
    while ($true) {
        try {
            $readers = [ThaiSmartCardReader]::ListReaders()
            if ($readers.Count -gt 0) {
                $present = [ThaiSmartCardReader]::IsCardPresent($readers[0])
                if ($present -and -not $wasPresent) {
                    Start-Sleep -Milliseconds 250
                    $card = [ThaiSmartCardReader]::ReadThaiIdCard($readers[0])
                    if ($card["status"] -eq "success") {
                        $json = $card | ConvertTo-Json -Compress
                        Broadcast-WsMessage $json
                    }
                }
                $wasPresent = $present
            } else {
                $wasPresent = $false
            }
        } catch {
            $wasPresent = $false
        }
        Start-Sleep -Milliseconds 500
    }
}) | Out-Null

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        if ($request.IsWebSocketRequest) {
            $wsContext = $context.AcceptWebSocketAsync($null).GetAwaiter().GetResult()
            $ws = $wsContext.WebSocket
            $null = $wsClients.Add($ws)
            $initStatus = Get-ReaderStatus
            $initMsg = @{ type = "status"; data = $initStatus } | ConvertTo-Json -Depth 4 -Compress
            $initBytes = [System.Text.Encoding]::UTF8.GetBytes($initMsg)
            $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$initBytes)
            $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()

            [System.Threading.Tasks.Task]::Run([Action]{
                $buf = New-Object byte[] 4096
                while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
                    try {
                        $segRecv = New-Object System.ArraySegment[byte] -ArgumentList @(,$buf)
                        $res = $ws.ReceiveAsync($segRecv, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
                        if ($res.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { break }
                        $msgText = [System.Text.Encoding]::UTF8.GetString($buf, 0, $res.Count)
                        $readers = [ThaiSmartCardReader]::ListReaders()
                        if ($readers.Count -gt 0) {
                            $card = [ThaiSmartCardReader]::ReadThaiIdCard($readers[0])
                            $reply = ($card | ConvertTo-Json -Compress)
                            $rBytes = [System.Text.Encoding]::UTF8.GetBytes($reply)
                            $rSeg = New-Object System.ArraySegment[byte] -ArgumentList @(,$rBytes)
                            $ws.SendAsync($rSeg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
                        }
                    } catch { break }
                }
                $wsClients.Remove($ws)
            }) | Out-Null
            continue
        }

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.AddHeader("Access-Control-Allow-Origin", "*")
            $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            $response.AddHeader("Access-Control-Allow-Headers", "*")
            $response.AddHeader("Access-Control-Allow-Private-Network", "true")
            $response.StatusCode = 204
            $response.OutputStream.Close()
            continue
        }

        $path = $request.Url.LocalPath.TrimEnd('/')
        if ($path -eq "/api/status" -or $path -eq "") {
            $st = Get-ReaderStatus
            Send-JsonResponse $response $st 200
        } elseif ($path -eq "/api/card") {
            $readers = [ThaiSmartCardReader]::ListReaders()
            if ($readers.Count -eq 0) {
                Send-JsonResponse $response @{ status = "error"; message = "ไม่พบเครื่องอ่านบัตร USB (PC/SC Reader)"; readerDetected = $false } 200
            } else {
                $card = [ThaiSmartCardReader]::ReadThaiIdCard($readers[0])
                $card["readerDetected"] = $true
                Send-JsonResponse $response $card 200
            }
        } else {
            Send-JsonResponse $response @{ status = "error"; message = "Not found" } 404
        }
    } catch {
        # continue on error
    }
}
