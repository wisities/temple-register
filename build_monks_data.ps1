$json = [System.IO.File]::ReadAllText("$PSScriptRoot\live_monks.json", [System.Text.Encoding]::UTF8)
$data = $json | ConvertFrom-Json

$formatted = @()
$idx = 0

foreach ($m in $data.monks) {
    $idx++
    $props = @($m.psobject.Properties | ForEach-Object { $_.Value })

    # Indices:
    # 0: id
    # 1: idCard
    # 2: name
    # 3: branch
    # 4: temple
    # 5: district
    # 6: province
    # 7: vassa
    # 8: phone
    # 9: hotel
    # 10: slipRight
    # 11: amount
    # 12: status
    # 13: registeredAt

    $monkId = if ($props.Count -gt 0 -and $props[0]) { [string]$props[0] } else { "MK" + $idx.ToString("D4") }
    $monkNum = [int]($monkId -replace '\D', '')
    if ($monkNum -eq 0) { $monkNum = $idx }
    $photoPath = "assets/monks/monk_row_" + ($monkNum + 1) + ".jpg"

    $idCard = if ($props.Count -gt 1 -and $props[1]) { [string]$props[1] } else { "" }
    $name = if ($props.Count -gt 2 -and $props[2]) { [string]$props[2] } else { "" }
    $branch = if ($props.Count -gt 3 -and $props[3]) { [string]$props[3] } else { "" }
    $temple = if ($props.Count -gt 4 -and $props[4]) { [string]$props[4] } else { "" }
    $district = if ($props.Count -gt 5 -and $props[5]) { [string]$props[5] } else { "" }
    $province = if ($props.Count -gt 6 -and $props[6]) { [string]$props[6] } else { "" }
    
    $vassaRaw = if ($props.Count -gt 7 -and $props[7]) { [string]$props[7] } else { "0" }
    $vassaNum = [int]($vassaRaw -replace '\D', '')

    $phone = if ($props.Count -gt 8 -and $props[8]) { [string]$props[8] } else { "" }
    if ($phone -eq "-") { $phone = "" }

    # Column J (index 9)
    $hotel = if ($props.Count -gt 9 -and $props[9]) { [string]$props[9] } else { "" }
    if ($hotel -eq "#N/A") { $hotel = "" }

    # Column K (index 10)
    $slipRight = if ($props.Count -gt 10 -and $props[10]) { [string]$props[10] } else { "" }
    if ($slipRight -eq "#N/A") { $slipRight = "" }
    
    $allowSlip = ($slipRight.Trim() -ne "")

    $status = if ($props.Count -gt 12 -and $props[12]) { [string]$props[12] } else { "" }
    $regAt = if ($props.Count -gt 13 -and $props[13]) { [string]$props[13] } else { $null }

    $obj = [ordered]@{
        id = $monkId
        idCard = $idCard
        photo = $photoPath
        name = $name
        branch = $branch
        temple = $temple
        district = $district
        province = $province
        vassa = $vassaNum
        phone = $phone
        hotel = $hotel
        slipRight = $slipRight
        allowSlip = $allowSlip
        amount = 0
        status = $status
        slipStatus = ""
        registeredAt = $regAt
    }
    $formatted += $obj
}

$jsContent = "window.INITIAL_MONKS_DATA = " + ($formatted | ConvertTo-Json -Depth 5) + ";"
[System.IO.File]::WriteAllText("$PSScriptRoot\monks_data.js", $jsContent, [System.Text.Encoding]::UTF8)

$jsonContent = $formatted | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText("$PSScriptRoot\monks_seed.json", $jsonContent, [System.Text.Encoding]::UTF8)

Write-Host "SUCCESS: Generated monks_data.js and monks_seed.json with $($formatted.Count) monks."
