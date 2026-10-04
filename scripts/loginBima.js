/**
 * Skrip Login Interaktif BIMA & Penyimpan Sesi (storageState)
 *
 * Jalankan perintah: npm run login-bima
 * 1. Peramban Chromium akan terbuka secara visual (headless: false).
 * 2. NIM dan Password akan diisi otomatis dari file .env.
 * 3. Anda tinggal mencentang CAPTCHA dan menekan tombol Login.
 * 4. Setelah masuk ke dashboard, session/cookie akan otomatis disimpan ke auth/bima_session.json.
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BIMA_BASE_URL || 'https://bima.upnyk.ac.id';
const AUTH_DIR = path.join(__dirname, '../auth');
const SESSION_FILE = path.join(AUTH_DIR, 'bima_session.json');

async function main() {
  const username = process.env.BIMA_USERNAME;
  const password = process.env.BIMA_PASSWORD;

  if (!username || !password) {
    console.error('[Error] BIMA_USERNAME atau BIMA_PASSWORD belum diset di file .env');
    process.exit(1);
  }

  // Buat folder auth jika belum ada
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  console.log('====================================================');
  console.log('   BIMA ONE-TIME LOGIN & SESSION SAVER');
  console.log('====================================================');
  console.log(`Membuka peramban untuk: ${BASE_URL}/login...`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Isi NIM & Password otomatis
    const userInput = page.locator('input[name="username"], input[type="text"]').first();
    const passInput = page.locator('input[name="password"], input[type="password"]').first();

    await userInput.fill(username);
    await passInput.fill(password);

    console.log('\n----------------------------------------------------');
    console.log('👉 SILAKAN CENTANG CAPTCHA DAN KLIK LOGIN DI BROWSER');
    console.log('Menunggu Anda berhasil login ke Dashboard (maks 2 menit)...');
    console.log('----------------------------------------------------\n');

    // Tunggu sampai halaman berpindah ke dashboard
    await Promise.race([
      page.waitForURL(/.*dashboard.*/i, { timeout: 120000 }),
      page.getByText('Dashboard', { exact: false }).waitFor({ timeout: 120000 }),
      page.locator('text=Jadwal Dosen').waitFor({ timeout: 120000 })
    ]);

    // Beri jeda 2 detik agar seluruh cookie tersimpan rapi
    await page.waitForTimeout(2000);

    // Simpan storage state (cookies, local storage, session)
    await context.storageState({ path: SESSION_FILE });

    console.log('====================================================');
    console.log('✅ SUKSES! Sesi login BIMA berhasil disimpan di:');
    console.log(`   ${SESSION_FILE}`);
    console.log('Sekarang sistem scraper dapat berjalan tanpa perlu login & CAPTCHA lagi!');
    console.log('====================================================');
  } catch (err) {
    console.error('\n❌ Login gagal atau waktu habis:', err.message);
    await page.screenshot({ path: 'debug_manual_login_failed.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
