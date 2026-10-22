$json = [System.IO.File]::ReadAllText("$PSScriptRoot\monks_seed.json", [System.Text.Encoding]::UTF8)
$data = $json | ConvertFrom-Json
$m = $data | Where-Object { $_.id -eq "MK0093" }
$m | Format-List
