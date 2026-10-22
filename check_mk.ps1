$json = [System.IO.File]::ReadAllText("$PSScriptRoot\monks_seed.json", [System.Text.Encoding]::UTF8)
$data = $json | ConvertFrom-Json
$eligible = $data | Where-Object { $_.slipRight -like "*มีสิทธิ์*" -or $_.allowSlip -eq $true }
Write-Host "Total monks: $($data.Count)"
Write-Host "Monks with slipRight (Column K): $($eligible.Count)"
$eligible | Select-Object -First 5 id, name, temple, slipRight | Format-Table
