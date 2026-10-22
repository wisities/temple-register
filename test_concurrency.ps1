Add-Type -ReferencedAssemblies "System.Net.Http" -TypeDefinition @"
using System;
using System.Net.Http;
using System.Text;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Collections.Concurrent;

public class LoadTester {
    private static readonly HttpClient client = new HttpClient();

    public static string RunGetTest(string url, int concurrentUsers) {
        var results = new ConcurrentBag<long>();
        var errors = new ConcurrentBag<string>();
        var swTotal = Stopwatch.StartNew();

        Task[] tasks = new Task[concurrentUsers];
        for (int i = 0; i < concurrentUsers; i++) {
            tasks[i] = Task.Run(async () => {
                var sw = Stopwatch.StartNew();
                try {
                    var response = await client.GetAsync(url);
                    sw.Stop();
                    if (response.IsSuccessStatusCode) {
                        results.Add(sw.ElapsedMilliseconds);
                    } else {
                        errors.Add("HTTP " + (int)response.StatusCode);
                    }
                } catch (Exception ex) {
                    sw.Stop();
                    errors.Add(ex.Message);
                }
            });
        }

        Task.WaitAll(tasks);
        swTotal.Stop();

        long sum = 0;
        long min = long.MaxValue;
        long max = 0;
        foreach (var t in results) {
            sum += t;
            if (t < min) min = t;
            if (t > max) max = t;
        }

        double avg = results.Count > 0 ? (double)sum / results.Count : 0;
        string errSummary = errors.Count > 0 ? string.Join(", ", errors) : "None";

        return string.Format("Total:{0}|Success:{1}|Failed:{2}|TotalTimeMs:{3}|AvgMs:{4:F1}|MinMs:{5}|MaxMs:{6}|Errors:{7}",
            concurrentUsers, results.Count, errors.Count, swTotal.ElapsedMilliseconds, avg, (results.Count > 0 ? min : 0), max, errSummary);
    }

    public static string RunPostTest(string url, string payloadJson, int concurrentUsers) {
        var results = new ConcurrentBag<long>();
        var errors = new ConcurrentBag<string>();
        var swTotal = Stopwatch.StartNew();

        Task[] tasks = new Task[concurrentUsers];
        for (int i = 0; i < concurrentUsers; i++) {
            int uid = i + 1;
            tasks[i] = Task.Run(async () => {
                var sw = Stopwatch.StartNew();
                try {
                    var content = new StringContent(payloadJson, Encoding.UTF8, "text/plain");
                    var response = await client.PostAsync(url, content);
                    sw.Stop();
                    if (response.IsSuccessStatusCode) {
                        results.Add(sw.ElapsedMilliseconds);
                    } else {
                        errors.Add("HTTP " + (int)response.StatusCode);
                    }
                } catch (Exception ex) {
                    sw.Stop();
                    errors.Add(ex.Message);
                }
            });
        }

        Task.WaitAll(tasks);
        swTotal.Stop();

        long sum = 0;
        long min = long.MaxValue;
        long max = 0;
        foreach (var t in results) {
            sum += t;
            if (t < min) min = t;
            if (t > max) max = t;
        }

        double avg = results.Count > 0 ? (double)sum / results.Count : 0;
        string errSummary = errors.Count > 0 ? string.Join(", ", errors) : "None";

        return string.Format("Total:{0}|Success:{1}|Failed:{2}|TotalTimeMs:{3}|AvgMs:{4:F1}|MinMs:{5}|MaxMs:{6}|Errors:{7}",
            concurrentUsers, results.Count, errors.Count, swTotal.ElapsedMilliseconds, avg, (results.Count > 0 ? min : 0), max, errSummary);
    }
}
"@

Write-Host "=========================================================="
Write-Host "  TEST 1: Local Web Server Concurrency (20 Concurrent Users)"
Write-Host "=========================================================="
$res1 = [LoadTester]::RunGetTest("http://localhost:8080/index.html", 20)
$res1 -split '\|' | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "=========================================================="
Write-Host "  TEST 2: Google Apps Script Concurrent Reads (10 Users)"
Write-Host "=========================================================="
$gasUrl = "https://script.google.com/macros/s/AKfycbzulX29bL9Eb6heQeduhilfjEZWw_n6Q93LzJIJDM19qwMDpXn8-HJ5gfZvEEK-h9gdsA/exec?action=get_monks"
$res2 = [LoadTester]::RunGetTest($gasUrl, 10)
$res2 -split '\|' | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "=========================================================="
Write-Host "  TEST 3: Google Apps Script Concurrent POST Requests (10 Users)"
Write-Host "=========================================================="
$postPayload = '{"action":"ping","timestamp":"' + (Get-Date).ToString("o") + '"}'
$gasPostUrl = "https://script.google.com/macros/s/AKfycbzulX29bL9Eb6heQeduhilfjEZWw_n6Q93LzJIJDM19qwMDpXn8-HJ5gfZvEEK-h9gdsA/exec"
$res3 = [LoadTester]::RunPostTest($gasPostUrl, $postPayload, 10)
$res3 -split '\|' | ForEach-Object { Write-Host "  $_" }
