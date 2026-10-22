$json = [System.IO.File]::ReadAllText("$PSScriptRoot\live_monks.json", [System.Text.Encoding]::UTF8)
$data = $json | ConvertFrom-Json
$props = $data.monks[0].psobject.Properties | ForEach-Object { $_.Name }
for ($i = 0; $i -lt $props.Count; $i++) {
    Write-Host "$i : $($props[$i])"
}
