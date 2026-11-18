@echo off
chcp 65001 >nul
title ระบบลงทะเบียนเข้างานวัด - Localhost Server & Smart Card Bridge
echo ========================================================
echo  ระบบลงทะเบียนเข้างานวัด (Temple Event Registration)
echo  กำลังเปิดบริการ Smart Card Bridge (Port 8084)...
echo  กำลังเปิดเซิร์ฟเวอร์ Localhost (Port 8080)...
echo ========================================================
start "SmartCardBridge" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0smartcard_bridge.ps1"

rem ตรวจหา Microsoft Edge เพื่อเปิดในโหมด App (ไม่มีแถบ URL ดูเป็นโปรแกรมเต็มตัว)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:8080/ --disable-features=Translate --no-first-run --no-default-browser-check --user-data-dir="%TEMP%\TempleRegisterProfile"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:8080/ --disable-features=Translate --no-first-run --no-default-browser-check --user-data-dir="%TEMP%\TempleRegisterProfile"
) else (
    start http://localhost:8080/
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

