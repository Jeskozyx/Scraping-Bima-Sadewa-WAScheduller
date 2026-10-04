# Bypass reCAPTCHA v2 — Catatan Lengkap

> ⚠️ **Disclaimer**
> Metode di bawah ini umumnya melanggar Terms of Service situs target dan bisa berisiko hukum / akun diblokir. Google terus update deteksi, jadi **tidak ada solusi yang 100% reliable**. Gunakan hanya untuk riset pribadi, automation legal, atau testing milik sendiri.

---

## 📑 Daftar Isi

1. [Ringkasan Bahasa & Pendekatan](#-ringkasan-bahasa--pendekatan)
2. [Python — Solusi Paling Umum](#-python--solusi-paling-umum)
   - [API Pihak Ketiga](#1-api-pihak-ketiga-paling-praktis)
   - [Audio Solving](#2-audio-solving-gratis-terbatas)
   - [Image Recognition (YOLO)](#3-image-recognition-yolo-based)
3. [JavaScript / Node.js](#-javascript--nodejs)
4. [Go](#-go)
5. [PHP](#-php)
6. [Perbandingan Solusi](#-perbandingan-solusi)
7. [Catatan Penting](#-catatan-penting)
8. [Rekomendasi Alur](#-rekomendasi-alur)
9. [Referensi Library](#-referensi-library)
10. [TL;DR](#-tldr)

---

## 📌 Ringkasan Bahasa & Pendekatan

| Bahasa | Pendekatan Umum | Ekosistem | Rekomendasi |
| :--- | :--- | :--- | :--- |
| **Python** | API pihak ketiga, audio solving, image recognition | Paling matang | ✅ Pilihan utama |
| **JavaScript / Node.js** | Puppeteer / Playwright + API solver | Baik | ✅ Untuk automation browser |
| **Go** | SDK API solver (2Captcha, dll) | Terbatas | ⚠️ Kalau butuh performa |
| **PHP** | SDK 2Captcha / Anti-Captcha | Cukup | ⚠️ Untuk web backend |

**Kesimpulan cepat**:
- Baru mulai → **Python**
- Automation di browser → **Node.js**
- Backend performa tinggi → **Go**
- Web backend klasik → **PHP**

---

## 🐍 Python — Solusi Paling Umum

Python adalah pilihan mainstream dengan pustaka siap pakai paling banyak.

### 1. API Pihak Ketiga (Paling Praktis)

**Prinsip**: Kirim `sitekey` + `URL` ke server solver (manusia/AI), terima token `g-recaptcha-response`, inject ke form.

**Provider populer**:
- NopeCHA
- 2Captcha
- Anti-Captcha
- CapSolver
- KimiCap

| Kelebihan | Kekurangan |
| :--- | :--- |
| Integrasi simpel | **Berbayar** (~$1–3 / 1000 solve) |
| Tingkat sukses relatif stabil | Delay 60–120+ detik |
| Support banyak jenis captcha | Tidak bisa handle sitekey dinamis tanpa scraping |

#### Contoh pakai `auto-captcha` (NopeCHA)

```bash
pip install auto-captcha
python -m playwright install chromium
```

```python
from auto_captcha import smart_page

with smart_page(api_key="KUNCI_NOPECHA_KAMU") as page:
    page.goto("https://target-site.com")
    page.fill("#email", "user@example.com")
    page.click("#submit")   # captcha auto-solve + inject
    print(page.captcha_log)
```

#### Contoh pakai 2Captcha manual

```python
import requests, time

API_KEY = "xxx"
SITEKEY = "6Lc..."
URL     = "https://target-site.com"

# 1. Kirim task
r = requests.post("http://2captcha.com/in.php", data={
    "key": API_KEY, "method": "userrecaptcha",
    "googlekey": SITEKEY, "pageurl": URL, "json": 1
}).json()
task_id = r["request"]

# 2. Polling hasil
while True:
    time.sleep(5)
    res = requests.get(
        f"http://2captcha.com/res.php?key={API_KEY}"
        f"&action=get&id={task_id}&json=1"
    ).json()
    if res["status"] == 1:
        token = res["request"]
        break

print("Token:", token)
```

---

### 2. Audio Solving (Gratis, Terbatas)

**Prinsip**: Klik tombol audio → download challenge → convert ke teks → isi.

- Library: `captcha-ai-solver`, `pydub` + Whisper
- **Hanya Windows**, butuh hak admin
- Akurasi terbatas (reCAPTCHA kadang pakai noise)

---

### 3. Image Recognition (YOLO-based)

**Prinsip**: Ambil grid gambar → deteksi objek pakai YOLO → simulasi klik.

- Library: `rcap`, `selenium-recaptcha-solver`
- Butuh GPU/CPU kuat
- Lebih lambat dari API
- Rentan ke deteksi anti-bot

---

## 🟨 JavaScript / Node.js

Cocok kalau automation-nya di browser (Puppeteer / Playwright).

```javascript
// npm install puppeteer 2captcha
const puppeteer = require('puppeteer');
const { Solver } = require('2captcha');

const solver = new Solver('API_KEY_KAMU');

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://target-site.com');

  // Ambil sitekey dari halaman
  const sitekey = await page.$eval('.g-recaptcha', el => el.dataset.sitekey);

  // Solve
  const { data } = await solver.recaptcha(sitekey, page.url());

  // Inject token
  await page.evaluate(token => {
    document.getElementById('g-recaptcha-response').innerHTML = token;
    document.getElementById('g-recaptcha-response').style.display = 'block';
  }, data);

  await page.click('#submit');
})();
```

**Plugin alternatif**: `puppeteer-extra-plugin-recaptcha` — auto-detect & solve langsung di flow Puppeteer.

---

## 🟦 Go

Ekosistem lebih kecil, tapi cocok kalau butuh performa tinggi di backend.

```go
// go get github.com/2captcha/2captcha-go
package main

import (
    "fmt"
    "github.com/2captcha/2captcha-go"
)

func main() {
    client := api2captcha.NewClient("API_KEY")
    c := api2captcha.ReCaptcha{
        SiteKey: "6Lc...",
        Url:     "https://target-site.com",
    }
    code, _, err := client.Solve(&c)
    if err != nil { panic(err) }
    fmt.Println("Token:", code)
}
```

---

## 🐘 PHP

Untuk web backend klasik (Laravel, native, dsb).

```php
<?php
// composer require 2captcha/2captcha
require __DIR__ . '/vendor/autoload.php';

use TwoCaptcha\TwoCaptcha;

$solver = new TwoCaptcha('API_KEY_KAMU');

try {
    $result = $solver->recaptcha([
        'sitekey' => '6Lc...',
        'url'     => 'https://target-site.com',
    ]);
    echo "Token: " . $result->code;
} catch (\Exception $e) {
    echo "Error: " . $e->getMessage();
}
```

---

## 📊 Perbandingan Solusi

| Metode | Biaya | Kecepatan | Akurasi | Kesulitan |
| :--- | :--- | :--- | :--- | :--- |
| API pihak ketiga | 💰 Berbayar | Sedang (60–120s) | Tinggi | Rendah |
| Audio solving | 🆓 Gratis | Lambat | Rendah | Sedang |
| Image (YOLO) | 🆓 Gratis | Lambat | Sedang | Tinggi |
| Manual (manusia) | 💰 Mahal | Lambat | Tinggi | Rendah |

---

## ⚠️ Catatan Penting

1. **Biaya**: Hampir semua API solver berbayar. Daftar dulu di provider.
2. **Delay**: reCAPTCHA v2 butuh **60–120 detik** per solve. Kalau situs punya timeout ketat → gagal.
3. **Deteksi**:
   - Headless browser lebih mudah diblokir
   - Google analisis perilaku mouse, sidik jari browser, IP
   - Datacenter IP lebih cepat kena challenge
4. **Rate limit**: Jangan spam. Kalau terlalu cepat → IP banned.
5. **Legal**: Bypass captcha di situs orang lain = pelanggaran ToS. Untuk situs sendiri → aman.

---

## 🎯 Rekomendasi Alur

```
Butuh cepat & stabil?
  → Python + NopeCHA / 2Captcha

Butuh gratis?
  → Audio solver (Windows only, akurasi rendah)

Automation di browser?
  → Node.js + Puppeteer + 2Captcha

Web backend klasik?
  → PHP + 2Captcha SDK

Skala besar?
  → Proxy residensial + API solver + rotasi user-agent
```

---

## 📚 Referensi Library

| Nama | Bahasa | Fungsi |
| :--- | :--- | :--- |
| `auto-captcha` | Python | Wrapper NopeCHA |
| `2captcha-python` | Python | SDK 2Captcha |
| `captcha-ai-solver` | Python | Audio solver |
| `rcap` | Python | YOLO image solver |
| `2captcha` (npm) | Node.js | SDK 2Captcha |
| `puppeteer-extra-plugin-recaptcha` | Node.js | Auto solve di Puppeteer |
| `2captcha-go` | Go | SDK 2Captcha |
| `2captcha/2captcha` | PHP | SDK 2Captcha |

---

## 🧾 TL;DR

- Bahasa paling praktis → **Python**
- Metode paling reliable → **API pihak ketiga (berbayar)**
- Gratis → **audio solver**, tapi terbatas & Windows-only
- Browser automation → **Node.js + Puppeteer**
- Tidak ada solusi 100% — Google terus update deteksi