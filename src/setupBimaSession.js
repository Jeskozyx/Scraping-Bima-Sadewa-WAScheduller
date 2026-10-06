/**
 * setupBimaSession.js
 * Inisialisasi Sesi Login BIMA UPNYK (Two-Phase Session Re-use)
 * 
 * Menjalankan Chromium sekali dalam mode visual (headless: false) agar pengguna dapat
 * login dan mencentang Google reCAPTCHA v2 ("I'm not a robot").
 * Setelah login berhasil (mencapai dashboard), seluruh cookie & token sesi
 * otomatis disimpan ke berkas `auth_bima.json` via context.storageState().
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getUserFromSupabase } from '../services/supabaseClient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_FILE = path.resolve(__dirname, '../auth_bima.json');

export async function inisialisasiSesiBima(targetNim = null) {
  console.log('===========================================================');
  console.log('   INISIALISASI SESI LOGIN BIMA (TWO-PHASE SESSION RE-USE)');
  console.log('===========================================================');
  console.log('[BIMA INIT] 🌐 Membuka browser visual (Chromium) untuk login manual & reCAPTCHA...');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    console.log('[BIMA INIT] Mengakses https://bima.upnyk.ac.id/login ...');
    await page.goto('https://bima.upnyk.ac.id/login', { waitUntil: 'domcontentloaded' });

    // Coba ambil kredensial dari Supabase atau .env untuk mempermudah auto-fill
    let userNim = targetNim || process.env.BIMA_USERNAME || process.env.SADEWA_NIM || '';
    let userPassword = process.env.BIMA_PASSWORD || process.env.SADEWA_PASSWORD || '';

    if (userNim && !userPassword) {
      const sbUser = await getUserFromSupabase(userNim).catch(() => null);
      if (sbUser && sbUser.password) {
        userPassword = sbUser.password;
      }
    }

    if (userNim) {
      const userInput = page.locator('input[name="username"], input[type="text"]').first();
      if (await userInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await userInput.fill(userNim).catch(() => {});
        console.log(`[BIMA INIT] ✍️ Username auto-fill: ${userNim}`);
      }
    }

    if (userPassword) {
      const passInput = page.locator('input[name="password"], input[type="password"]').first();
      if (await passInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await passInput.fill(userPassword).catch(() => {});
        console.log('[BIMA INIT] ✍️ Password auto-fill.');
      }
    }

    console.log('-----------------------------------------------------------');
    console.log('👉 SILAKAN CENTANG CAPTCHA & KLIK LOGIN DI JENDELA BROWSER.');
    console.log('👉 Sistem sedang menunggu pengalihan ke dashboard...');
    console.log('-----------------------------------------------------------');

    // Menunggu URL beralih ke dashboard atau v2
    await page.waitForURL(url => {
      const s = url.toString().toLowerCase();
      return (s.includes('dashboard') || s.includes('/v2') || s.includes('jadwal')) && !s.includes('login');
    }, { timeout: 180000 });

    console.log('[BIMA INIT] 🎉 Login berhasil diverifikasi di halaman:', page.url());

    // Tunggu sesaat agar seluruh cookies tersimpan
    await page.waitForTimeout(2000);

    // Simpan session state (cookies + localStorage)
    await context.storageState({ path: AUTH_FILE });
    console.log('[BIMA INIT] 💾 Berhasil menyimpan sesi autentikasi ke:');
    console.log(`            ${AUTH_FILE}`);
    console.log('[BIMA INIT] ⚡ Selesai! Sekarang scraper dapat berjalan mode headless tanpa CAPTCHA.');

    return { success: true, authPath: AUTH_FILE };
  } catch (err) {
    console.error('[BIMA INIT] ❌ Gagal menginisialisasi sesi:', err.message);
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Eksekusi langsung jika dipanggil via node: node src/setupBimaSession.js [NIM]
if (process.argv[1] && process.argv[1].endsWith('setupBimaSession.js')) {
  const customNim = process.argv[2] || null;
  inisialisasiSesiBima(customNim).catch(console.error);
}
