# WAScheduller - BIMA & SADEWA Portal Automation

Sistem otomasi scraping jadwal dosen (BIMA v2) dan pemantau judul skripsi mahasiswa (SADEWA) UPN "Veteran" Yogyakarta, dilengkapi dengan integrasi bot notifikasi WhatsApp (Baileys) dan antarmuka Web Dashboard interaktif.

---

## 📋 Persyaratan Sistem (Requirements)

Sebelum menjalankan aplikasi, pastikan komputer Anda memenuhi persyaratan berikut:

| Komponen | Persyaratan Minimum | Keterangan |
| :--- | :--- | :--- |
| **Sistem Operasi** | Windows 10/11, macOS, atau Linux | Didukung penuh |
| **Node.js** | Versi 18.0.0 atau lebih baru (LTS disarankan) | [Unduh Node.js](https://nodejs.org/) |
| **npm** | Versi 9.0.0 atau lebih baru | Otomatis terpasang bersama Node.js |
| **Browser** | Chromium (Playwright) | Diunduh otomatis via skrip instalasi |
| **Koneksi Internet** | Aktif | Diperlukan untuk mengakses BIMA & SADEWA |
| **Akun Kampus** | NIM & Password SSO UPNYK | Digunakan untuk autentikasi portal |

---

## ⚡ Instalasi Cepat (Sekali Klik)

### Untuk Pengguna Windows:
1. Klik dua kali berkas **`setup.bat`**.
2. Skrip akan secara otomatis:
   - Memeriksa instalasi Node.js.
   - Mengunduh dan memasang dependensi (`npm install`).
   - Memasang peramban Chromium Playwright (`npx playwright install chromium`).
   - Menyiapkan folder penyimpanan sesi (`auth`, `tmp`, `data`).
   - Menyalin berkas `.env.example` menjadi `.env`.
3. Setelah selesai, buka file **`.env`** dan masukkan NIM serta Password Anda.

### Untuk Pengguna Linux / macOS:
Jalankan perintah berikut di terminal:
```bash
chmod +x setup.sh
./setup.sh
```

---

## 🛠️ Instalasi Manual (Via Command Line)

Jika Anda ingin menjalankan instalasi secara manual langkah demi langkah:

```bash
# 1. Pasang dependensi proyek
npm install

# 2. Pasang browser Chromium untuk Playwright
npx playwright install chromium

# 3. Salin template konfigurasi environment
cp .env.example .env

# 4. Buat folder penyimpanan sesi & cache jika belum ada
mkdir auth tmp data
```

---

## ⚙️ Konfigurasi Berkas `.env`

Buka berkas `.env` dan sesuaikan nilainya:

```env
# Portal BIMA
BIMA_BASE_URL="https://bima.upnyk.ac.id"
BIMA_USERNAME="124230xxx"           # Ganti dengan NIM Anda
BIMA_PASSWORD="password_anda"       # Ganti dengan Password Anda

# Jam Kerja Notifikasi Jadwal Dosen
WORK_START_TIME="07:00"
WORK_END_TIME="17:00"
PORT=3000

# Portal SADEWA (Otomatis menggunakan akun BIMA jika tidak diisi)
SADEWA_NIM="124230xxx"
SADEWA_PASSWORD="password_anda"

# Layanan API CAPTCHA (Opsional - biarkan kosong untuk solver gratis)
# TWO_CAPTCHA_API_KEY=""
# CAPSOLVER_API_KEY=""
```

---

## 🚀 Cara Menjalankan Aplikasi

### 1. Login Satu Kali (One-Time Login & Session Saver)
Sebelum menggunakan fitur scraping otomatis tanpa CAPTCHA, simpan sesi login terlebih dahulu:

- **Login BIMA:**
  ```bash
  npm run login-bima
  ```
- **Login SADEWA:**
  ```bash
  npm run login-sadewa
  ```
*(Browser akan terbuka, CAPTCHA diselesaikan via solver Buster/Audio otomatis atau verifikasi manual 1x, lalu sesi disimpan permanen di folder `auth/`).*

### 2. Menjalankan Web Dashboard
- **Di Windows:** Cukup klik dua kali berkas **`start.bat`**.
- **Di Terminal:**
  ```bash
  npm start
  ```
- Buka peramban dan akses: **[http://localhost:3000](http://localhost:3000)**

---

## 📜 Daftar Perintah (NPM Scripts)

| Perintah | Fungsi |
| :--- | :--- |
| `npm run setup` | Menjalankan instalasi paket dan browser Playwright |
| `npm start` | Menjalankan server backend dan dashboard web secara live (`node --watch`) |
| `npm run login-bima` | Melakukan login BIMA dan menyimpan sesi ke `auth/bima_session.json` |
| `npm run login-sadewa` | Melakukan login SADEWA dan menyimpan sesi ke `auth/sadewa_session.json` |
| `npm run scrape-sadewa` | Menjalankan scraping judul skripsi SADEWA via CLI langsung |

---

## 📁 Struktur Berkas Proyek

```
WAScheduller/
├── data/
│   └── lecturers.json           # Database daftar nama dosen
├── public/
│   └── index.html               # Frontend dashboard interaktif (BIMA & SADEWA)
├── purpose_text/                # Dokumentasi & panduan teknis
├── scripts/
│   ├── getLecturers.js          # Pengambil data master dosen
│   ├── loginBima.js             # Skrip login & penyimpan sesi BIMA
│   └── loginSadewa.js           # Skrip login & penyimpan sesi SADEWA
├── services/
│   ├── audioCaptchaSolver.js    # Solver CAPTCHA audio gratis
│   ├── bimaScraper.js           # Modul scraper portal BIMA v2
│   ├── captchaSolver.js         # Layanan fallback API solver (2Captcha/CapSolver)
│   └── whatsappSender.js        # Modul pengirim pesan & bot WhatsApp Baileys
├── src/
│   └── sadewaScraper.js         # Modul scraper judul skripsi SADEWA
├── utils/
│   └── scheduleAnalyzer.js      # Analisis tabrakan waktu jadwal dosen
├── .env.example                 # Template berkas environment
├── .gitignore                   # Konfigurasi proteksi berkas rahasia / cache
├── package.json                 # Konfigurasi dependensi Node.js
├── README.md                    # Dokumentasi utama proyek
├── server.js                    # Backend API Express
├── setup.bat                    # Skrip instalasi sekali klik (Windows)
├── setup.sh                     # Skrip instalasi (Linux / macOS)
├── skripsi_si_2023.json         # Data cache hasil scraping judul skripsi
└── start.bat                    # Peluncur aplikasi sekali klik (Windows)
```
