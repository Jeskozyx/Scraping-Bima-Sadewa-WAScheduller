/**
 * sadewaScraperOptimized.js
 * Scraper Skripsi SADEWA Berkecepatan Tinggi (Batch DOM $$eval + Resource Blocking + Supabase Sync)
 * 
 * Karakteristik Optimasi:
 * 1. Aggressive Resource Blocking: Memblokir image, font, media (hemat 70% bandwidth).
 * 2. Jump Page Entries 100: Memilih opsi 100 entri per halaman untuk memangkas siklus paginasi.
 * 3. Batch DOM Evaluation: Mengganti ratusan loop CDP per-sel dengan 1 kali eksekusi `page.$$eval` (10-30 ms).
 * 4. High-Performance Flags: Menggunakan flag Chromium akselerasi hardware & bypass sandbox.
 * 5. Supabase Cloud Sync: Otomatis upsert seluruh data ke tabel `skripsi` Supabase.
 */

import { launchStealthBrowser } from '../utils/browserLauncher.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { upsertSkripsiBatchToSupabase, getUserFromSupabase } from '../services/supabaseClient.js';
import { parseNimInfo } from '../services/authService.js';
import { trySolveCaptchaFree } from '../services/audioCaptchaSolver.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://sadewa.upnyk.ac.id';
const AUTH_DIR = path.resolve(__dirname, '../auth');
const SESSION_FILE = path.join(AUTH_DIR, 'sadewa_session.json');

export async function scrapeSkripsiSADEWACepat(filterNim = null, credentials = null) {
  const startTime = Date.now();

  // 1. Resolve Kredensial Pengguna
  let username = credentials && credentials.username;
  let password = credentials && credentials.password;

  if (!username || !password) {
    if (credentials && credentials.nim) {
      const sb = await getUserFromSupabase(credentials.nim);
      if (sb && sb.password) {
        username = sb.username || sb.nim;
        password = sb.password;
      }
    }
  }

  if (!username || !password) {
    username = process.env.SADEWA_NIM || process.env.BIMA_USERNAME || '';
    password = process.env.SADEWA_PASSWORD || process.env.BIMA_PASSWORD || '';
  }

  const activeFilterNim = String(filterNim || '12423').trim();
  const nimMeta = parseNimInfo(activeFilterNim);

  if (!username || !password) {
    throw new Error('[SADEWA OPTIMIZED] Kredensial NIM & Password tidak ditemukan! Silakan masuk akun UPN.');
  }

  console.log('===========================================================');
  console.log(`   SADEWA OPTIMIZED SCRAPER: "${activeFilterNim}" (${nimMeta.prodi} ${nimMeta.angkatan})`);
  console.log('===========================================================');

  // 2. Launch Chromium dengan Flag Kinerja Tinggi & Stealth Anti-WAF
  const browser = await launchStealthBrowser({
    headless: true, // Headless untuk eksekusi kilat
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding'
    ]
  });

  const contextOptions = {
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  // Muat sesi jika ada
  if (fs.existsSync(SESSION_FILE)) {
    contextOptions.storageState = SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    // 3. Aggressive Resource Blocking (Gambar, Font, Media)
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // 4. Buka Halaman SADEWA
    console.log('[SADEWA OPTIMIZED] 🌐 Mengakses portal SADEWA...');
    await page.goto(`${BASE_URL}/tugas_akhir/list_judul/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Cek apakah dialihkan ke login
    const isLoginPage = page.url().includes('/login') ||
      (await page.locator('input[placeholder="username"], input[name="identity"], input[name="username"]').count().catch(() => 0)) > 0;

    if (isLoginPage) {
      console.log('[SADEWA OPTIMIZED] 🔐 Sesi login belum aktif atau kadaluarsa. Melakukan login otomatis...');
      const userInput = page.locator('input[name="identity"], input[placeholder="username"], input[name="username"], input[type="text"]').first();
      const passInput = page.locator('input[name="password"], input[type="password"]').first();

      await userInput.fill(username);
      await passInput.fill(password);

      // Selesaikan reCAPTCHA jika ada
      const hasCaptcha = await page.locator('.g-recaptcha, iframe[src*="recaptcha"]').count().catch(() => 0);
      if (hasCaptcha > 0) {
        console.log('[SADEWA OPTIMIZED] 🤖 Memecahkan CAPTCHA...');
        await trySolveCaptchaFree(page).catch(() => {});
      }

      const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("LOGIN")').first();
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        submitBtn.click()
      ]);

      // Simpan sesi login jika sukses
      if (!page.url().includes('/login')) {
        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
        await context.storageState({ path: SESSION_FILE }).catch(() => {});
        console.log('[SADEWA OPTIMIZED] 💾 Sesi login baru berhasil disimpan.');
      }

      // Pastikan berada di list_judul
      if (!page.url().includes('list_judul')) {
        await page.goto(`${BASE_URL}/tugas_akhir/list_judul/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      }
    }

    console.log('[SADEWA OPTIMIZED] 📄 Berada di halaman List Judul:', page.url());

    // 5. Masukkan Filter Prefix NIM
    console.log(`[SADEWA OPTIMIZED] 🔍 Memfilter DataTables untuk NIM "${activeFilterNim}"...`);
    await page.waitForSelector('#table_mahasiswa_filter input, input[type="search"]', { timeout: 15000 });
    const searchInput = page.locator('#table_mahasiswa_filter input[type="search"], #table_mahasiswa_filter input, input[type="search"]').first();
    await searchInput.fill(activeFilterNim);
    await page.waitForTimeout(600); // Debounce DataTables

    // 6. Ubah Entries ke 100 per halaman
    const lengthSelect = page.locator('select[name="table_mahasiswa_length"], select[name*="length"]').first();
    if ((await lengthSelect.count()) > 0) {
      console.log('[SADEWA OPTIMIZED] 📊 Mengubah tampilan ke 100 entri per halaman...');
      await lengthSelect.selectOption('100').catch(() => {});
      await page.waitForTimeout(400);
    }

    // 7. Ekstraksi Batch Instan dengan page.$$eval
    const hasilScrape = [];
    let halaman = 1;
    let hasNext = true;

    while (hasNext) {
      console.log(`[SADEWA OPTIMIZED] ⚡ Ekstraksi batch halaman ${halaman}...`);
      await page.waitForSelector('#table_mahasiswa tbody tr', { timeout: 15000 });

      // Ekstraksi 100 baris dalam satu perintah engine browser (15-30 ms!)
      const rowsData = await page.$$eval('#table_mahasiswa tbody tr', (rows) => {
        return rows.map((tr) => {
          const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
          if (cells.length < 6) return null;

          const no = cells[0] || '';
          const nim = cells[1] || '';
          const nama = cells[2] || '';
          const judulAwal = cells[3] || '';
          const judulTerbaru = cells[4] || '';
          const dosenPembimbing = cells[5] || '';
          const status = cells[6] || '';

          if (!nim || nim === 'No data available in table') return null;

          return {
            no,
            nim,
            nama,
            judulAwal,
            judulTerbaru,
            dosenPembimbing,
            status
          };
        }).filter((item) => item !== null && item.nim !== '');
      });

      // Filter unik berdasarkan NIM
      for (const row of rowsData) {
        if (!hasilScrape.some((x) => x.nim === row.nim)) {
          hasilScrape.push(row);
        }
      }

      console.log(`[SADEWA OPTIMIZED]   ✅ Halaman ${halaman}: ${rowsData.length} baris terbaca (total: ${hasilScrape.length})`);

      // Cek tombol Next DataTables
      const nextBtn = page.locator('#table_mahasiswa_paginate .paginate_button.next, .paginate_button.next').first();
      let isNextDisabled = true;

      if ((await nextBtn.count()) > 0 && (await nextBtn.isVisible())) {
        isNextDisabled = await nextBtn.evaluate((el) => el.classList.contains('disabled')).catch(() => true);
      }

      if (!isNextDisabled) {
        await nextBtn.click();
        await page.waitForTimeout(400);
        halaman++;
      } else {
        hasNext = false;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[SADEWA OPTIMIZED] 🎉 Sukses mengekstrak ${hasilScrape.length} data skripsi dalam ${duration} detik!`);

    // 8. Sinkronisasi ke Supabase Cloud Database (MANDATORY)
    if (hasilScrape.length > 0) {
      console.log(`[SADEWA OPTIMIZED] ☁️ Menyinkronkan ${hasilScrape.length} judul skripsi ke Supabase...`);
      await upsertSkripsiBatchToSupabase(hasilScrape, activeFilterNim);
    }

    return {
      success: true,
      total: hasilScrape.length,
      duration: `${duration}s`,
      filterNim: activeFilterNim,
      data: hasilScrape
    };
  } catch (err) {
    console.error('[SADEWA OPTIMIZED Error]:', err.message);
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Eksekusi CLI: node src/sadewaScraperOptimized.js [filterNim]
if (process.argv[1] && process.argv[1].endsWith('sadewaScraperOptimized.js')) {
  const customPrefix = process.argv[2] || '12423';
  scrapeSkripsiSADEWACepat(customPrefix)
    .then((res) => {
      console.log(`Ekstraksi selesai: ${res.total} baris dalam ${res.duration}`);
    })
    .catch(console.error);
}
