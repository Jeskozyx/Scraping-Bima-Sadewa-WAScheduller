/**
 * Skrip Login SADEWA & Penyimpan Sesi (storageState)
 * 
 * Menggabungkan Solusi Otomatis seperti pada BIMA:
 * 1. Session Storage Persistence (auth/sadewa_session.json) - login sekali, pakai berulang kali
 * 2. Audio Challenge Solver & Ekstensi Buster (Captcha Solver for Humans)
 * 3. Fallback API Solver (2Captcha / CapSolver) jika API key tersedia di .env
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { solveRecaptcha, injectRecaptchaToken } from '../services/captchaSolver.js';
import { trySolveCaptchaFree } from '../services/audioCaptchaSolver.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://sadewa.upnyk.ac.id';
const AUTH_DIR = path.join(__dirname, '../auth');
const SESSION_FILE = path.join(AUTH_DIR, 'sadewa_session.json');
const EXTENSION_DIR = path.resolve(__dirname, '../extensions/buster');
const PROFILE_DIR = path.resolve(__dirname, '../tmp/chrome_profile_sadewa');

async function main() {
  const username = process.env.SADEWA_NIM || process.env.BIMA_USERNAME;
  const password = process.env.SADEWA_PASSWORD || process.env.BIMA_PASSWORD;
  const hasSolverApiKey = !!(process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || process.env.CAPSOLVER_API_KEY);

  if (!username || !password) {
    console.error('[Error] Kredensial belum diset di file .env (SADEWA_NIM / BIMA_USERNAME)');
    process.exit(1);
  }

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  console.log('====================================================');
  console.log('   SADEWA ONE-TIME LOGIN & SESSION SAVER');
  console.log('   (Solusi Otomatis: Buster + Audio STT + Session Reuse)');
  console.log('====================================================');
  console.log(`Membuka peramban untuk: ${BASE_URL}/ ...`);

  // Menyiapkan argumen Playwright dengan Ekstensi Buster
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ];

  const hasBusterExtension = fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'));
  if (hasBusterExtension) {
    console.log('🧩 Memuat ekstensi Buster (Captcha Solver for Humans)...');
    launchArgs.push(`--disable-extensions-except=${EXTENSION_DIR}`);
    launchArgs.push(`--load-extension=${EXTENSION_DIR}`);
  }

  // Meluncurkan Persistent Context agar ekstensi Chrome aktif
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    slowMo: 60,
    viewport: { width: 1280, height: 720 },
    args: launchArgs
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);

    // 1. Isi Kredensial NIM & Password otomatis
    const userInput = page.locator('input[placeholder="username"], input[name="username"], input[type="text"]').first();
    const passInput = page.locator('input[name="password"], input[placeholder="password"], input[type="password"]').first();

    await userInput.waitFor({ state: 'visible', timeout: 10000 });
    await userInput.fill(username);
    await passInput.fill(password);
    console.log('✅ Kredensial NIM & Password berhasil diisi.');

    // 2. Coba Solver Otomatis Gratis (Audio Solver / Buster)
    console.log('\n🤖 Menjalankan solver otomatis (Buster & Audio Solver)...');
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
        pageUrl: `${BASE_URL}/`
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
      const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("LOGIN")').first();
      await submitBtn.click().catch(() => {});
    } else {
      console.log('\n----------------------------------------------------');
      console.log('👉 SISTEM SEDANG MEMANTAU CAPTCHA (Buster / Audio Solver)');
      console.log('   Jika perlu, Anda juga dapat mencentang langsung di browser.');
      console.log('   Begitu tercentang, tombol LOGIN akan ditekan otomatis.');
      console.log('Menunggu Anda berhasil login ke Dashboard (maks 2 menit)...');
      console.log('----------------------------------------------------\n');
    }

    // 5. Tunggu sampai masuk ke Dashboard (sidebar muncul atau form login hilang)
    const startTime = Date.now();
    const maxWaitMs = 120_000;
    let loggedIn = false;

    while (Date.now() - startTime < maxWaitMs) {
      const hasDashboard = await page.locator('.sidebar-menu, .main-sidebar, a[href*="logout"], a:has-text("Akademik"), nav.navbar').count().catch(() => 0);
      const isLockscreen = await page.locator('body.lockscreen').count().catch(() => 0);
      const isLoginForm = await page.locator('input[placeholder="username"], input[name="username"]').isVisible().catch(() => false);

      if (hasDashboard > 0 || (!isLoginForm && isLockscreen === 0)) {
        loggedIn = true;
        break;
      }

      // Jika reCAPTCHA tercentang tapi belum disubmit, klik LOGIN otomatis
      const captchaResponse = await page.evaluate(() => {
        const el = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
        return el ? el.value : '';
      }).catch(() => '');

      if (captchaResponse && captchaResponse.length > 20 && isLoginForm) {
        console.log('🤖 reCAPTCHA terverifikasi! Mengklik tombol LOGIN otomatis...');
        const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("LOGIN")').first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click().catch(() => {});
          await page.waitForTimeout(2500);
        }
      }

      await page.waitForTimeout(1000);
    }

    if (!loggedIn) {
      throw new Error('Waktu tunggu login ke Dashboard habis (2 menit).');
    }

    await page.waitForTimeout(2000);

    // 6. Simpan Sesi (Cookies & StorageState)
    await context.storageState({ path: SESSION_FILE });

    console.log('====================================================');
    console.log('✅ SUKSES! Sesi login SADEWA berhasil disimpan di:');
    console.log(`   ${SESSION_FILE}`);
    console.log('Sekarang scraper SADEWA dapat berjalan otomatis tanpa login ulang!');
    console.log('====================================================');
  } catch (err) {
    console.error('\n❌ Login SADEWA gagal atau waktu habis:', err.message);
    await page.screenshot({ path: 'debug_sadewa_login_failed.png', fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

main();
