@echo off
setlocal enabledelayedexpansion
title Setup & Instalasi Scraping Bima Sadewa & WAScheduller

echo ================================================================
echo    Scraping Bima Sadewa & WAScheduller
echo    Portal BIMA v2 & SADEWA UPN "Veteran" Yogyakarta
echo ================================================================
echo.

:: 1. Periksa apakah Node.js terpasang
echo [1/5] Memeriksa instalasi Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Node.js tidak ditemukan di komputer ini!
    echo Silakan unduh dan pasang Node.js (versi 18 ke atas) dari:
    echo https://nodejs.org/
    echo.
    echo Setelah selesai memasang Node.js, silakan jalankan kembali setup.bat ini.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo    Node.js terdeteksi: !NODE_VERSION!
echo.

:: 2. Install dependensi package.json
echo [2/5] Mengunduh & memasang dependensi project (npm install)...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Gagal memasang dependensi npm. Periksa koneksi internet Anda.
    pause
    exit /b 1
)
echo    Dependensi npm berhasil terpasang.
echo.

:: 3. Pasang browser Chromium untuk Playwright
echo [3/5] Mengunduh peramban Chromium untuk automasi Playwright...
call npx playwright install chromium
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARNING] Unduhan Playwright Chromium mengalami kendala.
    echo Anda dapat mencoba menjalankannya manual nanti dengan: npx playwright install chromium
) else (
    echo    Playwright Chromium siap digunakan.
)
echo.

:: 4. Buat folder yang diperlukan jika belum ada
echo [4/5] Menyiapkan struktur folder kerja...
if not exist "auth" mkdir auth
if not exist "tmp" mkdir tmp
if not exist "data" mkdir data
echo    Folder 'auth', 'tmp', dan 'data' siap.
echo.

:: 5. Buat file .env dari .env.example jika belum ada
echo [5/5] Memeriksa konfigurasi berkas .env...
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo    [INFO] Berkas .env berhasil dibuat dari .env.example.
        echo    PENTING: Silakan buka file .env dan masukkan NIM serta Password Anda!
    ) else (
        echo    [WARNING] .env.example tidak ditemukan.
    )
) else (
    echo    Berkas .env sudah ada.
)
echo.

echo ================================================================
echo    SETUP SELESAI DENGAN SUKSES!
echo ================================================================
echo.
echo Langkah selanjutnya:
echo 1. Pastikan NIM dan Password akun Anda sudah terisi di file '.env'.
echo 2. Login satu kali untuk menyimpan sesi:
echo    - BIMA   : npm run login-bima
echo    - SADEWA : npm run login-sadewa
echo 3. Jalankan aplikasi web:
echo    - Klik dua kali file 'start.bat' atau ketik 'npm start'
echo.
pause
