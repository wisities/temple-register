@echo off
chcp 65001 >nul
title ระบบลงทะเบียนเข้างานวัด - Localhost Server & Smart Card Bridge
echo ========================================================
echo  ระบบลงทะเบียนเข้างานวัด (Temple Event Registration)
echo  กำลังเปิดบริการ Smart Card Bridge (Port 8084)...
echo  กำลังเปิดเซิร์ฟเวอร์ Localhost (Port 8080)...
echo ========================================================
start "SmartCardBridge" /min powershell -ExecutionPolicy Bypass -File "%~dp0smartcard_bridge.ps1"
start http://localhost:8080/
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
