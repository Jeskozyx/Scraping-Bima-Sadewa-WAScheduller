/**
 * Service Autentikasi Pengguna UPNYK (BIMA & SADEWA SSO)
 * 
 * Mengelola login multi-pengguna, ekstraksi profil mahasiswa dari SADEWA,
 * penyimpanan sesi persisten, dan 5-digit prefix NIM untuk filtering otomatis.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchStealthPersistentContext } from '../utils/browserLauncher.js';
import { trySolveCaptchaFree } from './audioCaptchaSolver.js';
import { solveRecaptcha, injectRecaptchaToken } from './captchaSolver.js';
import { upsertUserToSupabase, upsertDosenBatchToSupabase } from './supabaseClient.js';
import { extractLecturersAndSchedules } from './bimaScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL_SADEWA = 'https://sadewa.upnyk.ac.id';
const BASE_URL_BIMA = process.env.BIMA_BASE_URL || 'https://bima.upnyk.ac.id';
const PROFILE_DIR = path.resolve(__dirname, '../tmp/chrome_profile_upn');
const EXTENSION_DIR = path.resolve(__dirname, '../extensions/buster');

// Catatan Arsitektur: Backend bersifat stateless (tanpa variabel sesi global di memori)
// Sesi disimpan di client (localStorage) dan disinkronkan ke Supabase Database.

// Pemetaan 3 digit awal NIM ke Program Studi di UPN Veteran Yogyakarta
export const PRODI_MAP = {
  '111': 'Teknik Pertambangan',
  '112': 'Teknik Perminyakan',
  '113': 'Teknik Geologi',
  '114': 'Teknik Geofisika',
  '115': 'Teknik Metalurgi',
  '121': 'Teknik Kimia',
  '122': 'Teknik Industri',
  '123': 'Informatika',
  '124': 'Sistem Informasi',
  '125': 'Sains Data',
  '131': 'Agroteknologi',
  '132': 'Agribisnis',
  '133': 'Ilmu Tanah',
  '141': 'Manajemen',
  '142': 'Akuntansi',
  '143': 'Ekonomi Pembangunan',
  '151': 'Hubungan Internasional',
  '152': 'Ilmu Komunikasi',
  '153': 'Administrasi Bisnis',
  '154': 'Hubungan Masyarakat'
};

/**
 * Parsing informasi NIM menjadi Prodi, Angkatan, dan 5-digit Prefix
 * @param {string} npm 
 */
export function parseNimInfo(npm) {
  if (!npm) return { prodi: 'UPN Veteran', angkatan: '', prefixNim: '' };
  const cleanNpm = String(npm).replace(/\D/g, '');
  const prodiCode = cleanNpm.slice(0, 3);
  const angkatanCode = cleanNpm.slice(3, 5);
  const prefixNim = cleanNpm.slice(0, 5);
  const prodi = PRODI_MAP[prodiCode] || `Prodi ${prodiCode}`;
  const angkatan = angkatanCode ? `20${angkatanCode}` : '';
  return {
    prodi,
    angkatan,
    prefixNim,
    prodiCode,
    angkatanCode
  };
}

/**
 * Helper legacy - Backend stateless tidak lagi menyimpan activeUser di memori
 */
export function getCurrentUser() {
  return null;
}

/**
 * Helper legacy - Tidak lagi menyimpan ke memori server
 */
export function saveCurrentUser(user) {
  return user;
}

/**
 * Helper legacy - Logout stateless
 */
export function logoutUser() {
  return { success: true, message: 'Berhasil keluar.' };
}

/**
 * Eksekusi Login SSO UPN (SADEWA & BIMA)
 * Menggunakan CloakBrowser stealth, otomatis mengekstrak Nama dan 5 Digit NIM
 * @param {string} username NIM/NPM Mahasiswa
 * @param {string} password Password SSO UPN
 */
export async function loginUser(username, password) {
  if (!username || !password) {
    throw new Error('NIM dan Password wajib diisi.');
  }

  const cleanUsername = String(username).trim();
  const cleanPassword = String(password).trim();

  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`[AuthService] Memulai login SSO untuk NIM: ${cleanUsername}`);
  console.log(`${'='.repeat(50)}`);

  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const hasBuster = fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'));
  const extensionPaths = hasBuster ? [EXTENSION_DIR] : [];

  let context = null;

  try {
    context = await launchStealthPersistentContext(PROFILE_DIR, {
      headless: false,
      slowMo: 50,
      viewport: { width: 1280, height: 720 },
      args: launchArgs,
      extensionPaths,
      humanize: true
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    console.log('[AuthService] Membuka SADEWA untuk otentikasi & ekstraksi profil...');
    await page.goto(`${BASE_URL_SADEWA}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Cek apakah akun yang sedang login di browser sama atau berbeda
    let profile = await extractSadewaProfile(page);

    if (profile && profile.npm === cleanUsername) {
      console.log(`[AuthService] ✅ Akun ${cleanUsername} (${profile.nama}) sudah terotentikasi di SADEWA!`);
    } else {
      // Jika profil yang login berbeda, lakukan logout terlebih dahulu
      if (profile && profile.npm !== cleanUsername) {
        console.log(`[AuthService] 🔄 Mengganti akun dari ${profile.npm} ke ${cleanUsername}...`);
        const logoutLink = page.locator('a[href*="logout"]').first();
        if (await logoutLink.isVisible().catch(() => false)) {
          await logoutLink.click().catch(() => {});
          await page.waitForTimeout(2500);
        }
      }

      // Pastikan form login terlihat
      const isLoginForm = await page.locator('input[placeholder="username"], input[name="username"], input[type="text"]').isVisible().catch(() => false);

      if (isLoginForm) {
        console.log('[AuthService] Mengisi form login SADEWA...');
        const userInput = page.locator('input[placeholder="username"], input[name="username"], input[type="text"]').first();
        const passInput = page.locator('input[name="password"], input[placeholder="password"], input[type="password"]').first();

        await userInput.fill(cleanUsername);
        await passInput.fill(cleanPassword);
        console.log('[AuthService] ✅ Kredensial NIM & Password diisi.');

        // Eksekusi CAPTCHA solver otomatis
        console.log('[AuthService] 🤖 Menjalankan solver CAPTCHA otomatis...');
        const freeResult = await trySolveCaptchaFree(page);
        let solved = freeResult.success;

        const hasApiKey = !!(process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || process.env.CAPSOLVER_API_KEY);
        if (!solved && hasApiKey) {
          try {
            const sitekey = await page.evaluate(() => {
              const el = document.querySelector('.g-recaptcha, [data-sitekey]');
              return el ? el.getAttribute('data-sitekey') : '6LekiE0sAAAAABv_pEjSv8h_B6WNnz8BTlqe7AYZ';
            });
            const solveRes = await solveRecaptcha({ sitekey, pageUrl: `${BASE_URL_SADEWA}/` });
            if (solveRes.success && solveRes.token) {
              await injectRecaptchaToken(page, solveRes.token);
              solved = true;
            }
          } catch (e) {
            console.warn('[AuthService] Fallback API Captcha solver notice:', e.message);
          }
        }

        if (solved) {
          const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("LOGIN")').first();
          await submitBtn.click().catch(() => {});
        }

        // Tunggu masuk ke Dashboard (maks 90 detik)
        const startTime = Date.now();
        let loggedIn = false;

        while (Date.now() - startTime < 90_000) {
          const hasDashboard = await page.locator('.sidebar-menu, .main-sidebar, a[href*="logout"], a:has-text("Akademik")').count().catch(() => 0);
          const isStillLogin = await page.locator('input[placeholder="username"], input[name="username"]').isVisible().catch(() => false);

          if (hasDashboard > 0 || !isStillLogin) {
            loggedIn = true;
            break;
          }

          // Otomatis klik submit jika reCAPTCHA tercentang oleh user
          const captchaResp = await page.evaluate(() => {
            const el = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
            return el ? el.value : '';
          }).catch(() => '');

          if (captchaResp && captchaResp.length > 20 && isStillLogin) {
            const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("LOGIN")').first();
            if (await submitBtn.isVisible().catch(() => false)) {
              await submitBtn.click().catch(() => {});
              await page.waitForTimeout(2000);
            }
          }

          await page.waitForTimeout(1000);
        }

        if (!loggedIn) {
          throw new Error('Gagal login ke SADEWA. Silakan periksa NIM dan Password Anda.');
        }
      }

      await page.waitForTimeout(1500);
      profile = await extractSadewaProfile(page);
    }

    if (!profile || !profile.npm) {
      // Fallback jika elemen .info.text-white tidak ditemukan persis
      const parsed = parseNimInfo(cleanUsername);
      profile = {
        nama: cleanUsername,
        npm: cleanUsername,
        prefixNim: parsed.prefixNim
      };
    }

    const { prodi, angkatan } = parseNimInfo(profile.npm);
    const completeUser = {
      nama: profile.nama,
      npm: profile.npm,
      password: cleanPassword,
      prefixNim: profile.prefixNim,
      prodi,
      angkatan,
      totalDosen: 0,
      lastLogin: new Date().toISOString()
    };

    // ============================================================
    // INTEGRASI BIMA (SSO Unified: Otomatis masuk & scraping Dosen)
    // ============================================================
    let totalDosenScraped = 0;
    try {
      console.log(`\n[AuthService] 🌐 Menghubungkan ke portal BIMA untuk menyinkronkan akun ${cleanUsername}...`);
      await page.goto(`${BASE_URL_BIMA}/v2`, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);

      // Cek apakah halaman login BIMA muncul
      const isBimaLogin = page.url().includes('/login') || await page.locator('input[name="username"], input[type="text"]').isVisible().catch(() => false);

      if (isBimaLogin) {
        console.log('[AuthService] 🔐 Mengisi kredensial SSO di form login BIMA...');
        const bimaUserInput = page.locator('input[name="username"], input[type="text"]').first();
        const bimaPassInput = page.locator('input[name="password"], input[type="password"]').first();

        await bimaUserInput.fill(cleanUsername);
        await bimaPassInput.fill(cleanPassword);

        // Solver CAPTCHA BIMA
        console.log('[AuthService] 🤖 Menyelesaikan CAPTCHA BIMA...');
        const bimaCaptchaRes = await trySolveCaptchaFree(page).catch(() => ({ success: false }));
        let bimaSolved = bimaCaptchaRes && bimaCaptchaRes.success;

        const hasApiKey = !!(process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || process.env.CAPSOLVER_API_KEY);
        if (!bimaSolved && hasApiKey) {
          try {
            const sitekey = await page.evaluate(() => {
              const el = document.querySelector('.g-recaptcha, [data-sitekey]');
              return el ? el.getAttribute('data-sitekey') : '6LekiE0sAAAAABv_pEjSv8h_B6WNnz8BTlqe7AYZ';
            });
            const solveRes = await solveRecaptcha({ sitekey, pageUrl: `${BASE_URL_BIMA}/login` });
            if (solveRes && solveRes.token) {
              await injectRecaptchaToken(page, solveRes.token);
              bimaSolved = true;
            }
          } catch (e) {
            console.warn('[AuthService] BIMA Captcha solver API notice:', e.message);
          }
        }

        if (bimaSolved) {
          const submitBimaBtn = page.locator('button[type="submit"], button:has-text("Masuk"), button:has-text("Login")').first();
          await submitBimaBtn.click().catch(() => {});
        }

        // Tunggu URL berubah ke /v2 (maks 35 detik)
        console.log('[AuthService] Menunggu pengalihan ke portal BIMA /v2...');
        try {
          await page.waitForURL((url) => !url.href.includes('/login') && url.href.includes('/v2'), { timeout: 35000 });
        } catch (e) {
          console.warn('[AuthService] Waktu tunggu URL /v2 habis, memeriksa URL saat ini:', page.url());
        }
      }

      // Akses halaman Jadwal Dosen untuk mendeteksi nama-nama dosen untuk user ini
      console.log('[AuthService] 📋 Mengakses /v2/lecturer/schedule untuk mendeteksi daftar dosen...');
      await page.goto(`${BASE_URL_BIMA}/v2/lecturer/schedule`, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForSelector('table tbody tr, button', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);

      const scrapeResult = await extractLecturersAndSchedules(page, completeUser.prodi);
      if (scrapeResult && scrapeResult.success) {
        totalDosenScraped = scrapeResult.total || 0;
        if (scrapeResult.fakultas) {
          completeUser.fakultas = scrapeResult.fakultas;
        }
        console.log(`[AuthService] ✅ Terdeteksi ${totalDosenScraped} nama dosen dari BIMA untuk user ${cleanUsername}!`);
      }
    } catch (bimaErr) {
      console.warn('[AuthService] Peringatan sinkronisasi BIMA otomatis:', bimaErr.message);
    }

    completeUser.totalDosen = totalDosenScraped;

    // Sinkronkan ke tabel users di Supabase Database (Stateless Cloud Storage)
    try {
      await upsertUserToSupabase({
        username: cleanUsername,
        password: cleanPassword,
        npm: completeUser.npm,
        nama: completeUser.nama,
        prefixNim: completeUser.prefixNim,
        prodi: completeUser.prodi,
        angkatan: completeUser.angkatan
      });
    } catch (sbErr) {
      console.warn('[AuthService] Supabase sync notice:', sbErr.message);
    }

    console.log('[AuthService] 🎉 Berhasil mengautentikasi dan mengekstrak data profil:');
    console.log(`             Nama       : ${completeUser.nama}`);
    console.log(`             NPM        : ${completeUser.npm}`);
    console.log(`             Prefix NIM : ${completeUser.prefixNim} (${completeUser.prodi} ${completeUser.angkatan})`);
    console.log(`             Total Dosen: ${totalDosenScraped} terdeteksi dari BIMA`);

    return {
      success: true,
      message: `Selamat datang, ${completeUser.nama}! Terdeteksi ${totalDosenScraped} dosen BIMA.`,
      user: completeUser,
      totalDosen: totalDosenScraped
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

/**
 * Ekstraksi elemen DOM profil SADEWA:
 * <div class="info text-white">
 *   <p>NAMA MAHASISWA</p>
 *   <p>NPM: 124230127</p>
 * </div>
 */
async function extractSadewaProfile(page) {
  try {
    return await page.evaluate(() => {
      const infoEl = document.querySelector('.info.text-white, .user-panel .info, .sidebar .info');
      if (!infoEl) return null;

      const paragraphs = Array.from(infoEl.querySelectorAll('p')).map((p) => p.textContent.trim());
      const nama = paragraphs[0] || '';

      const npmLine = paragraphs.find((p) => p.toUpperCase().includes('NPM') || p.toUpperCase().includes('NIM')) || paragraphs[1] || '';
      const match = npmLine.match(/\d{7,12}/);
      const npm = match ? match[0] : '';

      if (!npm) return null;

      return {
        nama,
        npm,
        prefixNim: npm.slice(0, 5)
      };
    });
  } catch (err) {
    console.warn('[AuthService] extractSadewaProfile warning:', err.message);
    return null;
  }
}
