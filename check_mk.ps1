$json = [System.IO.File]::ReadAllText("$PSScriptRoot\monks_seed.json", [System.Text.Encoding]::UTF8)
$data = $json | ConvertFrom-Json
$m = $data[28]
$m | Format-List
