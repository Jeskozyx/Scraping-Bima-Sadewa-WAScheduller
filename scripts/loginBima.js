/**
 * Skrip Login BIMA & Penyimpan Sesi (storageState)
 * 
 * Menggabungkan 3 Solusi Gratis:
 * 1. Session Storage Persistence (auth/bima_session.json) - login sekali, pakai selamanya
 * 2. Audio Challenge Solver (Otomatis & Gratis via Speech-to-Text)
 * 3. Ekstensi Browser "Buster: Captcha Solver for Humans" terintegrasi langsung
 * 
 * Tambahan: Fallback API Solver (2Captcha / CapSolver) jika API key tersedia di .env
 */

import { launchStealthPersistentContext } from '../utils/browserLauncher.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { solveRecaptcha, injectRecaptchaToken } from '../services/captchaSolver.js';
import { trySolveCaptchaFree } from '../services/audioCaptchaSolver.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BIMA_BASE_URL || 'https://bima.upnyk.ac.id';
const AUTH_DIR = path.join(__dirname, '../auth');
const SESSION_FILE = path.join(AUTH_DIR, 'bima_session.json');
const EXTENSION_DIR = path.resolve(__dirname, '../extensions/buster');
const PROFILE_DIR = path.resolve(__dirname, '../tmp/chrome_profile');

async function main() {
  const username = process.env.BIMA_USERNAME;
  const password = process.env.BIMA_PASSWORD;
  const hasSolverApiKey = !!(process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || process.env.CAPSOLVER_API_KEY);

  if (!username || !password) {
    console.error('[Error] BIMA_USERNAME atau BIMA_PASSWORD belum diset di file .env');
    process.exit(1);
  }

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  console.log('====================================================');
  console.log('   BIMA ONE-TIME LOGIN & SESSION SAVER');
  console.log('   (Solusi CloakBrowser Stealth + Buster + Audio STT)');
  console.log('====================================================');
  console.log(`Membuka peramban untuk: ${BASE_URL}/login...`);

  // Menyiapkan argumen Playwright dengan Ekstensi Buster (Solusi 3)
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ];

  const hasBusterExtension = fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'));
  const extensionPaths = [];
  if (hasBusterExtension) {
    console.log('🧩 Memuat ekstensi Buster (Captcha Solver for Humans)...');
    extensionPaths.push(EXTENSION_DIR);
    launchArgs.push(`--disable-extensions-except=${EXTENSION_DIR}`);
    launchArgs.push(`--load-extension=${EXTENSION_DIR}`);
  }

  // Meluncurkan Persistent Context dengan CloakBrowser Stealth
  const context = await launchStealthPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 60,
    viewport: { width: 1280, height: 720 },
    args: launchArgs,
    extensionPaths,
    humanize: true
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    // 0. Cek apakah sudah dalam status login (dari profil persisten)
    const hasDashboardInitial = await page.locator('a[href*="logout"], .user-panel, a:has-text("Jadwal"), nav.navbar').count().catch(() => 0);
    const isLoginFormInitial = await page.locator('input[name="username"], input[type="text"]').isVisible().catch(() => false);

    if (hasDashboardInitial > 0 && !isLoginFormInitial) {
      console.log('🎉 Browser persisten sudah dalam kondisi LOGIN di Dashboard BIMA!');
      await page.waitForTimeout(1000);
      await context.storageState({ path: SESSION_FILE });
      console.log('====================================================');
      console.log('✅ SUKSES! Sesi login BIMA berhasil disimpan di:');
      console.log(`   ${SESSION_FILE}`);
      console.log('Sekarang sistem scraper dapat berjalan tanpa login ulang!');
      console.log('====================================================');
      return;
    }

    // 1. Isi Kredensial NIM & Password otomatis jika belum login
    const userInput = page.locator('input[name="username"], input[type="text"]').first();
    const passInput = page.locator('input[name="password"], input[type="password"]').first();

    await userInput.waitFor({ state: 'visible', timeout: 15000 });
    await userInput.fill(username);
    await passInput.fill(password);
    console.log('✅ Kredensial NIM & Password berhasil diisi.');

    // 2. Coba Solver Otomatis Gratis (Solusi 2 & 3: Audio Solver / Buster)
    console.log('\n🤖 Menjalankan solver otomatis gratis (Buster & Audio Solver)...');
    const freeSolveResult = await trySolveCaptchaFree(page);

    let isCaptchaSolved = freeSolveResult.success;

    // 3. Fallback: Jika gratis belum berhasil & ada API Key di .env, gunakan API Solver
    if (!isCaptchaSolved && hasSolverApiKey) {
      console.log('\n🌐 [Fallback] Menggunakan API Solver berbayar dari .env...');
      const sitekey = await page.evaluate(() => {
        const el = document.querySelector('.g-recaptcha, [data-sitekey]');
        if (el && el.getAttribute('data-sitekey')) return el.getAttribute('data-sitekey');
        return '6LekiE0sAAAAABv_pEjSv8h_B6WNnz8BTlqe7AYZ';
      });

      const solveResult = await solveRecaptcha({
        sitekey,
        pageUrl: `${BASE_URL}/login`
      });

      if (solveResult.success && solveResult.token) {
        await injectRecaptchaToken(page, solveResult.token);
        isCaptchaSolved = true;
      }
    }

    // 4. Jika solver berhasil otomatis, klik tombol login
    if (isCaptchaSolved) {
      console.log('🎉 CAPTCHA terverifikasi! Menekan tombol Login otomatis...');
      await page.waitForTimeout(1000);
      const submitBtn = page.locator('button[type="submit"], button:has-text("Masuk"), button:has-text("Login")').first();
      await submitBtn.click();
    } else {
      console.log('\n----------------------------------------------------');
      console.log('👉 SILAKAN CENTANG CAPTCHA DAN KLIK LOGIN DI BROWSER');
      console.log('   (Anda juga bisa menekan tombol Buster berkepala robot di captcha)');
      console.log('Menunggu Anda berhasil login ke Dashboard (maks 2 menit)...');
      console.log('----------------------------------------------------\n');
    }

    // 5. Tunggu sampai masuk ke Dashboard
    await Promise.race([
      page.waitForURL(/.*dashboard.*/i, { timeout: 120000 }),
      page.getByText('Dashboard', { exact: false }).waitFor({ timeout: 120000 }),
      page.locator('text=Jadwal Dosen').waitFor({ timeout: 120000 })
    ]);

    await page.waitForTimeout(2000);

    // 6. Solusi 1: Simpan Sesi (Cookies & Token JWT)
    await context.storageState({ path: SESSION_FILE });

    console.log('====================================================');
    console.log('✅ SUKSES! Sesi login BIMA berhasil disimpan di:');
    console.log(`   ${SESSION_FILE}`);
    console.log('Sekarang sistem scraper dapat berjalan tanpa perlu login & CAPTCHA lagi!');
    console.log('====================================================');
  } catch (err) {
    console.error('\n❌ Login gagal atau waktu habis:', err.message);
    await page.screenshot({ path: 'debug_login_failed.png', fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

main();
