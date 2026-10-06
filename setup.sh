#!/usr/bin/env bash

# Setup Script untuk Linux / macOS
set -e

echo "================================================================"
echo "   Scraping Bima Sadewa & WAScheduller (Linux / macOS)"
echo "================================================================"
echo ""

# 1. Periksa Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js tidak ditemukan! Silakan install Node.js >= 18."
    exit 1
fi

echo "Node.js terdeteksi: $(node -v)"
echo ""

# 2. Install dependencies
echo "Memasang dependensi npm..."
npm install
echo ""

# 3. Install Playwright Chromium
echo "Memasang browser Chromium Playwright..."
npx playwright install chromium
echo ""

# 4. Buat direktori kerja
mkdir -p auth tmp data

# 5. Buat .env dari .env.example
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "[INFO] Berkas .env berhasil dibuat dari .env.example."
        echo "Silakan edit file .env dan masukkan NIM serta Password Anda."
    fi
fi

echo ""
echo "================================================================"
echo "   SETUP SELESAI DENGAN SUKSES!"
echo "================================================================"
echo "Jalankan aplikasi dengan: npm start"
echo ""
