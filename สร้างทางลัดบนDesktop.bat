@echo off
chcp 65001 >nul
title สร้างไอคอนทางลัด ระบบลงทะเบียนเข้างานวัด
echo ========================================================
echo  กำลังสร้างทางลัด "ระบบลงทะเบียนเข้างานวัด" บนหน้าจอ Desktop...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $scPath = Join-Path $desktop 'ระบบลงทะเบียนเข้างานวัด.lnk'; $sc = $ws.CreateShortcut($scPath); $sc.TargetPath = Join-Path '%~dp0' 'start_server.bat'; $sc.WorkingDirectory = '%~dp0'; $sc.IconLocation = Join-Path '%~dp0' 'app.ico'; $sc.WindowStyle = 7; $sc.Description = 'ระบบลงทะเบียนเข้างานวัดหนองป่าพง'; $sc.Save(); Write-Host '✓ สร้างทางลัดบนหน้าจอ Desktop เรียบร้อยแล้ว (ไม่ติดบล็อก Antivirus)' -ForegroundColor Green"
echo ========================================================
echo  เสร็จเรียบร้อย! สามารถเปิดโปรแกรมจากไอคอนบนหน้าจอ Desktop ได้เลยครับ
echo ========================================================
pause
