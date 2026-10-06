# Panduan Optimasi Performa Scraping Playwright: BIMA & SADEWA (scraper_performance_optimization.md)

Dokumen ini memuat arsitektur dan implementasi optimasi kecepatan tinggi untuk portal akademik UPN "Veteran" Yogyakarta (**SADEWA** dan **BIMA**), mengatasi kelambatan ekstrem (*stealth overhead latency*), serta mengeliminasi bottleneck CDP round-trip dan penanganan CAPTCHA.

---

## 1. Perbandingan Karakteristik & Solusi Tiap Portal

| Aspek | Portal SADEWA (Skripsi Data) | Portal BIMA (Jadwal Dosen) |
| :--- | :--- | :--- |
| **Proteksi Login** | Form login standar (tanpa CAPTCHA). | Google reCAPTCHA v2 ("I'm not a robot"). |
| **Penyebab Lambat** | Loop per sel (`innerText`) & pagination DataTables. | Modul stealth berat & reload solver CAPTCHA. |
| **Solusi Optimasi** | Batch extraction via `$$eval` + Jump page entry 100. | **Two-Phase Session Re-use** via `storageState` (CAPTCHA 0 detik). |
| **Eksekusi Harian** | Headless Chromium + Resource blocking. | Headless Chromium + Direct URL + Resource blocking. |

---

## 2. Prinsip Optimasi Kinerja Tinggi

### A. Two-Phase Session Re-use (Kunci Kecepatan BIMA)
Menjalankan browser dengan modul stealth atau menyelesaikan CAPTCHA setiap kali scraper dijalankan akan membuang waktu 15–40 detik per siklus.
* **Fase 1 (Satu Kali Saja):** Buka browser secara visual (`headless: false`), login manual, selesaikan reCAPTCHA, lalu simpan seluruh cookie/token sesi ke berkas `auth_bima.json` via `context.storageState()`.
* **Fase 2 (Eksekusi Otomatis / Scheduler):** Browser berjalan dalam mode `headless: true`, memuat `auth_bima.json`, dan langsung menuju endpoint jadwal tanpa menyentuh halaman login dan tanpa melewati CAPTCHA sama sekali (latensi terpangkas menjadi < 2 detik).

### B. Aggressive Resource Blocking (Hemat 70% Bandwidth & CPU)
Blokir resource gambar, font, media, dan pelacak eksternal yang tidak dibutuhkan untuk mengekstrak data teks jadwal maupun skripsi:
```javascript
await page.route('**/*', (route) => {
  const resourceType = route.request().resourceType();
  if (['image', 'media', 'font'].includes(resourceType)) {
    return route.abort();
  }
  return route.continue();
});
```

### C. Batch DOM Evaluation (`page.$$eval`)
Mengganti pembacaan baris demi baris menggunakan Playwright locator loop dengan eksekusi satu kali di browser context engine. Mengurangi ratusan komunikasi IPC (*Chrome DevTools Protocol round-trip*) menjadi 1 request instan (10–30 ms per tabel).

---

## 3. Implementasi Skrip BIMA Teroptimasi

### Langkah 1: Simpan Sesi Login BIMA (`src/setupBimaSession.js`)
Jalankan file ini **hanya satu kali** di awal atau ketika sesi login kampus telah habis masa berlakunya:

```javascript
import { chromium } from 'playwright';

export async function inisialisasiSesiBima() {
  console.log('[BIMA INIT] Membuka browser untuk login manual & verifikasi CAPTCHA...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://bima.upnyk.ac.id/login');
  console.log('[BIMA INIT] Silakan masukkan username, password, centang CAPTCHA, dan klik login di jendela browser.');

  // Menunggu browser berhasil dialihkan ke dashboard utama
  await page.waitForURL('**/dashboard**', { timeout: 120000 });
  console.log('[BIMA INIT] Login berhasil diverifikasi!');

  // Simpan state autentikasi ke file lokal
  await context.storageState({ path: 'auth_bima.json' });
  console.log('[BIMA INIT] Sesi tersimpan ke auth_bima.json. Selesai.');

  await browser.close();
}

// Eksekusi langsung jika dipanggil via terminal: node src/setupBimaSession.js
if (process.argv[1].endsWith('setupBimaSession.js')) {
  inisialisasiSesiBima().catch(console.error);
}
```

---

### Langkah 2: Scraper Jadwal Dosen Berkecepatan Tinggi (`src/bimaScraperOptimized.js`)
Menggunakan sesi tersimpan tanpa beban stealth, langsung menuju data target:

```javascript
import { chromium } from 'playwright';
import fs from 'fs';

export async function scrapeJadwalBimaCepat(namaDosen = '') {
  const startTime = Date.now();

  // Validasi keberadaan file auth
  if (!fs.existsSync('auth_bima.json')) {
    throw new Error('Sesi auth_bima.json tidak ditemukan! Jalankan setupBimaSession.js terlebih dahulu.');
  }

  const browser = await chromium.launch({
    headless: true, // Headless penuh untuk kecepatan maksimal
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  // Muat context dengan sesi tersimpan
  const context = await browser.newContext({
    storageState: 'auth_bima.json',
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  try {
    // 1. Blokir aset non-esensial
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // 2. Langsung ke halaman Jadwal Dosen (Bypass Login & CAPTCHA)
    console.log('[BIMA] Mengakses halaman jadwal dosen...');
    await page.goto('https://bima.upnyk.ac.id/jadwal-dosen', { waitUntil: 'domcontentloaded' });

    // Cek apakah sesi expired
    if (page.url().includes('login')) {
      throw new Error('Sesi login telah berakhir. Jalankan ulang setupBimaSession.js!');
    }

    // 3. Filter Dosen (jika parameter diisi)
    if (namaDosen) {
      console.log(`[BIMA] Mencari jadwal untuk: ${namaDosen}...`);
      const searchBox = page.locator('input[type="search"], input[name*="search"]').first();
      if (await searchBox.isVisible()) {
        await searchBox.fill(namaDosen);
        await page.waitForTimeout(500);
      }
    }

    // 4. Batch DOM Evaluation untuk mengekstrak baris tabel secara instan
    console.log('[BIMA] Mengekstrak baris tabel...');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const jadwalData = await page.$$eval('table tbody tr', (rows) => {
      return rows.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
        if (cells.length < 5) return null;
        return {
          hari: cells[1] || '',
          jam: cells[2] || '',
          mataKuliah: cells[3] || '',
          kelas: cells[4] || '',
          ruang: cells[5] || '',
          dosen: cells[6] || cells[5] || ''
        };
      }).filter((item) => item !== null);
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[BIMA] Ekstraksi ${jadwalData.length} baris jadwal selesai dalam ${duration} detik!`);

    return jadwalData;
  } catch (err) {
    console.error('[BIMA Error]:', err.message);
    throw err;
  } finally {
    await browser.close();
  }
}
```

---

## 4. Implementasi Skrip SADEWA Teroptimasi (`src/sadewaScraperOptimized.js`)

Skrip ini menangani pagination DataTables dan menyinkronkan data langsung ke Supabase:

```javascript
import { chromium } from 'playwright';
import fs from 'fs';
import dotenv from 'dotenv';
import { upsertDataSkripsi } from './services/dbService.js';

dotenv.config();

export async function scrapeSkripsiSADEWACepat() {
  const startTime = Date.now();

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-background-timer-throttling'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // 1. Blokir Request Aset Berat
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    console.log('[SADEWA] Membuka halaman login...');
    await page.goto('https://sadewa.upnyk.ac.id/', { waitUntil: 'domcontentloaded' });

    // 2. Login Cepat SADEWA
    await page.locator('input[name="username"], input[type="text"]').first().fill(process.env.SADEWA_NIM || '124230127');
    await page.locator('input[name="password"], input[type="password"]').first().fill(process.env.SADEWA_PASSWORD || '');
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('button[type="submit"], input[type="submit"]').first().click()
    ]);

    // 3. Langsung Masuk ke List Judul
    console.log('[SADEWA] Melompat ke halaman List Judul Skripsi...');
    await page.goto('https://sadewa.upnyk.ac.id/tugas_akhir/list_judul/', { waitUntil: 'domcontentloaded' });

    // 4. Masukkan Filter NIM 12423 (Sistem Informasi 2023)
    await page.waitForSelector('#table_mahasiswa_filter input, input[type="search"]', { timeout: 15000 });
    const searchInput = page.locator('#table_mahasiswa_filter input, input[type="search"]').first();
    await searchInput.fill('12423');
    await page.waitForTimeout(600);

    // 5. Ubah Entries ke 100 Jika Dropdown Tersedia (Mengurangi Siklus Pagination)
    const lengthSelect = page.locator('select[name*="length"]');
    if (await lengthSelect.count() > 0) {
      await lengthSelect.selectOption('100').catch(() => {});
      await page.waitForTimeout(400);
    }

    // 6. Ekstraksi Cepat Seluruh Halaman dengan Batch $$eval
    const hasilScrape = [];
    let halaman = 1;
    let hasNext = true;

    while (hasNext) {
      console.log(`[SADEWA] Ekstraksi halaman ${halaman}...`);
      await page.waitForSelector('#table_mahasiswa tbody tr', { timeout: 10000 });

      const rowsData = await page.$$eval('#table_mahasiswa tbody tr', (rows) => {
        return rows.map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
          if (cells.length < 6) return null;
          return {
            no: cells[0] || '',
            nim: cells[1] || '',
            nama: cells[2] || '',
            judulAwal: cells[3] || '',
            judulTerbaru: cells[4] || '',
            dosenPembimbing: cells[5] || '',
            status: cells[6] || ''
          };
        }).filter((item) => item !== null && item.nim !== '');
      });

      hasilScrape.push(...rowsData);

      // Cek tombol Next DataTables
      const nextBtn = page.locator('.paginate_button.next');
      const isDisabled = await nextBtn.evaluate((el) => el.classList.contains('disabled')).catch(() => true);

      if (!isDisabled && (await nextBtn.isVisible())) {
        await nextBtn.click();
        await page.waitForTimeout(350);
        halaman++;
      } else {
        hasNext = false;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[SADEWA] Berhasil mengekstrak ${hasilScrape.length} data dalam ${duration} detik!`);

    // 7. Simpan ke JSON Lokal & Sinkronisasi ke Supabase
    fs.writeFileSync('skripsi_si_2023.json', JSON.stringify(hasilScrape, null, 2), 'utf-8');

    if (hasilScrape.length > 0) {
      await upsertDataSkripsi(hasilScrape);
    }

    return hasilScrape;
  } catch (err) {
    console.error('[SADEWA Error]:', err.message);
    throw err;
  } finally {
    await browser.close();
  }
}
```

---

## 5. Prompt Siap Pakai untuk Antigravity

Salin instruksi berikut langsung ke Antigravity untuk menerapkan modul optimasi pada kedua scraper:

```text
Tolong implementasikan optimasi performa Playwright untuk scraper BIMA dan SADEWA merujuk ke berkas scraper_performance_optimization.md:

1. Optimasi BIMA (Bypass CAPTCHA & Akselerasi Ekstraksi):
   - Buat src/setupBimaSession.js: Menjalankan Chromium mode visual (headless: false) sekali saja agar user dapat login dan mencentang reCAPTCHA manual, lalu simpan sesi ke 'auth_bima.json' via context.storageState().
   - Buat src/bimaScraperOptimized.js: Menjalankan Chromium headless: true menggunakan storageState('auth_bima.json'), memblokir resource gambar/font/media menggunakan page.route, melompat langsung ke URL jadwal dosen, dan mengekstrak tabel jadwal secara instan menggunakan page.$$eval().

2. Optimasi SADEWA (Batch DataTables & Supabase):
   - Perbarui src/sadewaScraperOptimized.js dengan flag Chromium performa tinggi, blokir aset gambar/media, ganti loop locator per-sel dengan batch evaluation page.$$eval('#table_mahasiswa tbody tr', ...), serta pertahankan filter pencarian NIM '12423' dan sinkronisasi upsertDataSkripsi() ke Supabase.

3. Pastikan kedua scraper berjalan dalam hitungan detik tanpa hambatan modul stealth yang berat.
```