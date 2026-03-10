@echo off
chcp 65001 >nul
title Cursor Proxy
echo.
echo   ========================================
echo     Cursor Proxy
echo   ========================================
echo.
cd /d "%~dp0"
node server.js
pause
