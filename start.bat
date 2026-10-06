@echo off
title Menjalankan Scraping Bima Sadewa & WAScheduller
echo ================================================================
echo    Menjalankan Scraping Bima Sadewa & WAScheduller
echo ================================================================
echo.

:: Tunggu 2 detik lalu buka browser secara otomatis
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Jalankan server
node --watch server.js

pause
