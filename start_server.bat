@echo off
chcp 65001 >nul
title ระบบลงทะเบียนเข้างานวัด - Localhost Server
echo ========================================================
echo  ระบบลงทะเบียนเข้างานวัด (Temple Event Registration)
echo  กำลังเปิดเซิร์ฟเวอร์ Localhost...
echo ========================================================
start http://localhost:8080/
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
