/**
 * BIMA Portal Scraper — Jadwal Dosen UPNYK (Versi BIMA v2)
 *
 * Otomasi navigasi dashboard BIMA v2, akses halaman jadwal dosen (/v2/lecturer/schedule),
 * pencarian nama dosen via combobox popup / input "Cari dosen...", ekstraksi tabel jadwal,
 * eliminasi mata kuliah Praktikum, serta penyimpanan otomatis ke database Supabase (tabel dosen & jadwal).
 */

import { launchStealthBrowser, launchStealthPersistentContext } from '../utils/browserLauncher.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { trySolveCaptchaFree } from './audioCaptchaSolver.js';
import { solveRecaptcha, injectRecaptchaToken } from './captchaSolver.js';
import { upsertDosenBatchToSupabase, upsertJadwalBatchToSupabase, getJadwalFromSupabase, getUserFromSupabase } from './supabaseClient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BIMA_BASE_URL || 'https://bima.upnyk.ac.id';
const PROFILE_DIR = path.resolve(__dirname, '../tmp/chrome_profile_upn');
const EXTENSION_DIR = path.resolve(__dirname, '../extensions/buster');

/**
 * Mendapatkan kredensial pengguna secara stateless dari Supabase / env
 * @param {string} preferredNpm - NIM pengguna yang melakukan request
 */
async function resolveUserCredentials(preferredNpm = null) {
  // 1. Ambil dari Supabase berdasarkan NIM pemanggil
  if (preferredNpm) {
    const sbUser = await getUserFromSupabase(preferredNpm);
    if (sbUser && sbUser.password) {
      return {
        username: sbUser.username || sbUser.nim,
        password: sbUser.password,
        prodi: sbUser.prodi || ''
      };
    }
  }

  // 2. Fallback ke .env jika dijalankan via skrip CLI / standalone
  return {
    username: process.env.BIMA_USERNAME || process.env.SADEWA_NIM || '',
    password: process.env.BIMA_PASSWORD || process.env.SADEWA_PASSWORD || '',
    prodi: ''
  };
}

/**
 * Memastikan sesi BIMA aktif. Jika belum ada atau expired, otomatis login.
 * @param {Object} contextOrPage
 * @param {Object} credentials
 */
async function loginToBimaIfRequired(page, credentials) {
  const isLoginPage = page.url().includes('/login') || await page.locator('input[name="username"], input[type="text"]').isVisible().catch(() => false);
  if (!isLoginPage) return true;

  console.log('[BimaScraper] 🔐 Mendeteksi halaman login BIMA, memulai proses autentikasi...');
  const { username, password } = credentials;

  if (!username || !password) {
    throw new Error('Kredensial login BIMA tidak ditemukan. Silakan masuk akun UPN terlebih dahulu di Web UI.');
  }

  const userInput = page.locator('input[name="username"], input[type="text"]').first();
  const passInput = page.locator('input[name="password"], input[type="password"]').first();

  await userInput.waitFor({ state: 'visible', timeout: 15000 });
  await userInput.fill(username);
  await passInput.fill(password);
  console.log(`[BimaScraper] ✅ Kredensial NIM ${username} berhasil diisi di form login BIMA.`);

  // Coba solver gratis (Buster / Audio STT)
  const freeSolve = await trySolveCaptchaFree(page).catch(() => ({ success: false }));
  let solved = freeSolve && freeSolve.success;

  const hasApiKey = !!(process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || process.env.CAPSOLVER_API_KEY);
  if (!solved && hasApiKey) {
    try {
      const sitekey = await page.evaluate(() => {
        const el = document.querySelector('.g-recaptcha, [data-sitekey]');
        return el ? el.getAttribute('data-sitekey') : '6LekiE0sAAAAABv_pEjSv8h_B6WNnz8BTlqe7AYZ';
      });
      const res = await solveRecaptcha({ sitekey, pageUrl: `${BASE_URL}/login` });
      if (res && res.token) {
        await injectRecaptchaToken(page, res.token);
        solved = true;
      }
    } catch (e) {
      console.warn('[BimaScraper] Fallback API Captcha notice:', e.message);
    }
  }

  if (solved) {
    const submitBtn = page.locator('button[type="submit"], button:has-text("Masuk"), button:has-text("Login")').first();
    await submitBtn.click().catch(() => {});
  }

  // Tunggu URL berubah ke /v2 (maks 35 detik)
  console.log('[BimaScraper] Menunggu pengalihan URL ke /v2 setelah login...');
  try {
    await page.waitForURL((url) => !url.href.includes('/login') && url.href.includes('/v2'), { timeout: 35000 });
  } catch (e) {
    console.warn('[BimaScraper] Waktu tunggu URL /v2 habis, memeriksa URL saat ini:', page.url());
  }

  if (page.url().includes('/login')) {
    throw new Error('Gagal login ke BIMA. Pastikan NIM dan Password SSO Anda benar.');
  }

  console.log('[BimaScraper] 🎉 Berhasil login ke BIMA! Sesi aktif di:', page.url());
  return true;
}

/**
 * Scrape daftar nama dosen dari portal BIMA v2
 * @param {string} preferredNpm 
 */
/**
 * Mencari tombol trigger dropdown dosen di halaman BIMA v2 (/v2/lecturer/schedule)
 * Di BIMA v2, tombol ini memiliki aria-haspopup="dialog" dan teks default "Tampilkan Semua Jadwal Dosen"
 * @param {import('playwright').Page} page
 */
export async function locateLecturerTriggerButton(page) {
  // Strategy 1: Tombol yang memuat teks "Tampilkan Semua Jadwal Dosen" atau span.truncate
  const byExactText = page.locator('button').filter({ hasText: /tampilkan semua jadwal dosen/i });
  if (await byExactText.count().catch(() => 0) > 0) {
    return byExactText.first();
  }

  // Strategy 2: Button dengan span.truncate berisi teks dosen / jadwal
  const truncateBtn = page.locator('button:has(span.truncate)').filter({ hasText: /dosen|jadwal/i });
  if (await truncateBtn.count().catch(() => 0) > 0) {
    return truncateBtn.first();
  }

  // Strategy 3: Button aria-haspopup="dialog" yang memuat kata "Dosen" atau "Jadwal"
  const dialogDosen = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: /dosen|jadwal/i });
  if (await dialogDosen.count().catch(() => 0) > 0) {
    return dialogDosen.first();
  }

  // Strategy 4: Button aria-haspopup="dialog" di halaman (exclude tombol logout/profile)
  const allDialogs = page.locator('button[aria-haspopup="dialog"]');
  const dCount = await allDialogs.count().catch(() => 0);
  for (let i = 0; i < dCount; i++) {
    const btn = allDialogs.nth(i);
    const txt = (await btn.innerText().catch(() => '')).trim();
    if (!/profil|keluar|logout|avatar/i.test(txt)) {
      return btn;
    }
  }

  // Strategy 5: Role combobox yang memuat "dosen" atau bukan semester
  const comboboxes = page.locator('button[role="combobox"]');
  const cCount = await comboboxes.count().catch(() => 0);
  for (let i = 0; i < cCount; i++) {
    const btn = comboboxes.nth(i);
    const txt = (await btn.innerText().catch(() => '')).trim();
    if (/dosen|tampilkan semua/i.test(txt)) {
      return btn;
    }
  }

  // Strategy 6: Tombol apapun yang mengandung kata "Dosen"
  const anyDosen = page.locator('button').filter({ hasText: /dosen/i });
  if (await anyDosen.count().catch(() => 0) > 0) {
    return anyDosen.first();
  }

  return null;
}

/**
 * Ekstraksi terpadu seluruh nama dosen dan jadwal dari halaman BIMA v2 (/v2/lecturer/schedule)
 * Menggabungkan opsi dari Popover/Dialog Cmdk DAN kolom dosen pada tabel halaman default.
 * @param {import('playwright').Page} page
 * @param {string} prodi
 */
export async function extractLecturersAndSchedules(page, prodi = '') {
  console.log('[BimaScraper] 📋 Memulai ekstraksi daftar dosen & jadwal dari halaman BIMA...');

  // 1. Baca informasi Semester & Fakultas dari kontrol halaman
  const headerInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="combobox"], h1, h2, span'));
    let fakultas = '';
    let semester = '';
    for (const b of buttons) {
      const text = (b.textContent || b.innerText || '').trim();
      if (/fakultas/i.test(text)) {
        const fMatch = text.match(/FAKULTAS\s+([A-Z\s]+)/i);
        if (fMatch) fakultas = fMatch[0].trim();
      }
      if (/gasal|genap/i.test(text) && /202\d/i.test(text)) {
        const sMatch = text.match(/(Gasal|Genap)\s+\d{4}\/\d{4}/i);
        if (sMatch) semester = sMatch[0].trim();
      }
    }
    return { fakultas, semester };
  });

  console.log(`[BimaScraper] Info BIMA terdeteksi: Fakultas = "${headerInfo.fakultas || '-'}", Semester = "${headerInfo.semester || '-'}"`);

  // 2. Buka dropdown Popover / Dialog Dosen
  let dropdownLecturers = [];
  const triggerBtn = await locateLecturerTriggerButton(page);

  if (triggerBtn) {
    console.log('[BimaScraper] Tombol dropdown dosen ditemukan! Membuka popover dialog...');
    await triggerBtn.click({ force: true }).catch(async () => {
      await page.evaluate((el) => el && el.click(), await triggerBtn.elementHandle());
    });
    await page.waitForTimeout(1200);

    // Ambil opsi dari dialog/popover cmdk
    dropdownLecturers = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[cmdk-item]'));
      const set = new Set();
      elements.forEach((el) => {
        const text = (el.getAttribute('data-value') || el.innerText || el.textContent || '').trim();
        if (
          text &&
          text.length > 2 &&
          !/tampilkan semua jadwal dosen/i.test(text) &&
          !/cari dosen/i.test(text) &&
          !/tidak ada/i.test(text)
        ) {
          set.add(text);
        }
      });
      return Array.from(set);
    });

    console.log(`[BimaScraper] 🔍 Terdeteksi ${dropdownLecturers.length} nama dosen resmi dari dropdown BIMA.`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  } else {
    console.warn('[BimaScraper] ⚠️ Tombol dropdown dosen tidak ditemukan secara langsung, memeriksa tabel...');
  }

  // 3. Ekstraksi Baris Jadwal dari TABEL
  const tableData = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr'));
    const rows = [];

    trs.forEach((tr) => {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || td.innerText || '').trim());
      if (tds.length >= 9) {
        const rowItem = {
          prodi: tds[0] || '',
          kode: tds[1] || '',
          matkul: tds[2] || '',
          kelas: tds[3] || '',
          sks: tds[4] || '',
          jmlMhs: tds[5] || '',
          jadwal: tds[6] || '',
          ruang: tds[7] || '',
          dosen: tds[8] || ''
        };
        rows.push(rowItem);
      }
    });

    return { rows };
  });

  console.log(`[BimaScraper] 📊 Terdeteksi ${tableData.rows.length} baris jadwal dari tabel BIMA.`);

  // 4. DAFTAR MASTER DOSEN RESMI (HANYA DARI DROPDOWN BIMA - 100% BEBAS REDUNDANSI)
  let allLecturers = [];
  if (dropdownLecturers && dropdownLecturers.length > 0) {
    allLecturers = dropdownLecturers;
  } else {
    // Fallback darurat HANYA jika popover tidak bisa dibuka sama sekali:
    // Pisahkan berdasarkan bullet '•' atau newline '\n' (JANGAN pernah memecah dengan koma)
    const fallbackSet = new Set();
    tableData.rows.forEach((r) => {
      if (r.dosen) {
        r.dosen.split(/[\n\r•]+/).forEach((d) => {
          const clean = d.trim().replace(/^[-*•]\s*/, '');
          if (clean.length > 2 && !/tampilkan semua/i.test(clean)) {
            fallbackSet.add(clean);
          }
        });
      }
    });
    allLecturers = Array.from(fallbackSet);
  }

  // Sanitasi akhir nama dosen
  allLecturers = Array.from(new Set(allLecturers))
    .map((n) => n.replace(/\s+/g, ' ').trim())
    .filter((n) => n.length > 2 && !/^(ak|dr|se|mm|msi|prof|ir|sh|sp|skom|mkom|mag|si|hum|sc|ca|akt|dra|drs)\.?$/i.test(n))
    .sort((a, b) => a.localeCompare(b));

  console.log(`[BimaScraper] ✅ TOTAL DOSEN RESMI: ${allLecturers.length} dosen.`);

  // 5. Simpan ke Supabase tabel dosen (Supabase Only)
  if (allLecturers.length > 0) {
    await upsertDosenBatchToSupabase(allLecturers, prodi, headerInfo.fakultas);
  }

  // 6. Simpan baris jadwal ke Supabase tabel jadwal jika ada
  if (tableData.rows && tableData.rows.length > 0) {
    console.log(`[BimaScraper] 💾 Menyimpan ${tableData.rows.length} baris jadwal ke Supabase...`);
    const jadwalByDosen = {};

    function resolveCanonicalName(rawName) {
      if (!rawName) return null;
      const clean = rawName.replace(/^[-•*]\s*/, '').trim();
      const exact = allLecturers.find((c) => c.toLowerCase() === clean.toLowerCase());
      if (exact) return exact;

      // Cocokkan kata kunci inti (nama tanpa gelar)
      const coreWords = clean.replace(/\b(dr|dra|drs|ir|prof|se|mm|msi|s\.e|m\.si|sh|mh|s\.kom|m\.kom|s\.pd|m\.pd|s\.s|m\.hum|ph\.d|m\.sc|m\.acc|ak|akt|ca)\b/gi, '')
        .replace(/[^a-zA-Z\s]/g, '')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3);

      if (coreWords.length > 0) {
        const matched = allLecturers.find((c) => {
          const cLower = c.toLowerCase();
          return coreWords.every((w) => cLower.includes(w));
        });
        if (matched) return matched;
      }
      return clean;
    }

    for (const r of tableData.rows) {
      if (r.dosen) {
        const rawList = r.dosen.split(/[\n\r•]+/).map((d) => d.trim()).filter((d) => d.length > 2);
        for (const rawD of rawList) {
          const dName = resolveCanonicalName(rawD);
          if (dName) {
            if (!jadwalByDosen[dName]) jadwalByDosen[dName] = [];
            jadwalByDosen[dName].push(r);
          }
        }
      }
    }
    const targetSem = headerInfo.semester || 'Gasal 2026/2027';
    for (const [dName, rows] of Object.entries(jadwalByDosen)) {
      await upsertJadwalBatchToSupabase(dName, targetSem, rows).catch(() => {});
    }
  }

  return {
    success: true,
    total: allLecturers.length,
    lecturers: allLecturers,
    fakultas: headerInfo.fakultas,
    semester: headerInfo.semester,
    rowsCount: tableData.rows.length
  };
}

/**
 * Scrape daftar nama dosen dari portal BIMA v2
 * @param {string} preferredNpm 
 */
export async function scrapeBimaLecturers(preferredNpm = null) {
  const credentials = await resolveUserCredentials(preferredNpm);
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const hasBuster = fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'));
  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const extensionPaths = hasBuster ? [EXTENSION_DIR] : [];

  let context = null;

  try {
    console.log('\n[BimaScraper] 📋 Memulai proses scraping daftar dosen dari BIMA...');
    context = await launchStealthPersistentContext(PROFILE_DIR, {
      headless: false,
      slowMo: 60,
      args: launchArgs,
      extensionPaths,
      humanize: true
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(35000);

    // 1. Buka BIMA v2
    await page.goto(`${BASE_URL}/v2`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Cek apakah perlu login
    if (page.url().includes('/login') || await page.locator('input[name="username"]').isVisible().catch(() => false)) {
      await loginToBimaIfRequired(page, credentials);
    }

    // 2. Akses halaman Jadwal Dosen
    console.log('[BimaScraper] Mengakses halaman /v2/lecturer/schedule...');
    await page.goto(`${BASE_URL}/v2/lecturer/schedule`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('table tbody tr, button', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // 3. Ekstrak data dosen & jadwal secara komprehensif
    const result = await extractLecturersAndSchedules(page, credentials.prodi);

    return {
      success: true,
      total: result.total,
      data: result.lecturers,
      fakultas: result.fakultas
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

/**
 * Scrape jadwal dosen dari BIMA v2.
 *
 * @param {string} dosenName - Nama dosen yang dicari (misal: "Hari Prapcoyo")
 * @param {string} targetSemester - Semester target (default: "Gasal 2026/2027")
 * @param {string} preferredNpm - Opsional: NIM pengguna aktif
 * @returns {Promise<Object>} Jadwal dosen per hari dan daftar baris jadwal lengkap
 */
export async function scrapeJadwalDosen(dosenName, targetSemester = 'Gasal 2026/2027', preferredNpm = null) {
  // FAST-PATH: Jika auth_bima.json tersedia, gunakan scraper teroptimasi kilat (< 5 detik)
  const authBimaPath = path.resolve(__dirname, '../auth_bima.json');
  if (fs.existsSync(authBimaPath)) {
    try {
      console.log(`\n[BimaScraper] ⚡ Ditemukan sesi BIMA tersimpan (${authBimaPath}), menggunakan scraper teroptimasi (kilat < 5 detik)...`);
      const { scrapeJadwalBimaCepat } = await import('../src/bimaScraperOptimized.js');
      const optResult = await scrapeJadwalBimaCepat(dosenName, targetSemester);
      if (optResult && optResult.success) {
        return optResult;
      }
    } catch (optErr) {
      console.warn(`[BimaScraper] ⚠️ Scraper teroptimasi gagal (${optErr.message}), beralih ke browser persisten...`);
    }
  }

  const credentials = await resolveUserCredentials(preferredNpm);
  if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const hasBuster = fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'));
  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const extensionPaths = hasBuster ? [EXTENSION_DIR] : [];

  let context = null;

  try {
    console.log(`\n[BimaScraper] 🔍 Memulai pencarian jadwal dosen: "${dosenName}" (Semester: ${targetSemester})`);

    context = await launchStealthPersistentContext(PROFILE_DIR, {
      headless: false,
      slowMo: 60,
      args: launchArgs,
      extensionPaths,
      humanize: true
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    page.setDefaultTimeout(35000);

    // 1. Masuk ke Dashboard BIMA v2
    console.log('[BimaScraper] Membuka portal BIMA v2...');
    await page.goto(`${BASE_URL}/v2`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    // Cek apakah perlu login
    if (page.url().includes('/login') || await page.locator('input[name="username"]').isVisible().catch(() => false)) {
      await loginToBimaIfRequired(page, credentials);
    }

    // 2. Akses menu Jadwal Dosen (/v2/lecturer/schedule)
    console.log('[BimaScraper] Mengakses halaman Jadwal Dosen (/v2/lecturer/schedule)...');
    await page.goto(`${BASE_URL}/v2/lecturer/schedule`, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // 3. Tunggu tabel jadwal ter-render
    console.log('[BimaScraper] Menunggu elemen halaman termuat...');
    await page.waitForSelector('table tbody tr, button', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // 4. Cari dosen menggunakan Popover / Dialog "Tampilkan Semua Jadwal Dosen"
    console.log(`[BimaScraper] Mencari tombol pemicu dropdown dosen...`);
    const triggerBtn = await locateLecturerTriggerButton(page);

    if (triggerBtn) {
      console.log(`[BimaScraper] Tombol dropdown dosen ditemukan! Membuka dialog...`);
      await triggerBtn.click({ force: true }).catch(async () => {
        await page.evaluate((el) => el && el.click(), await triggerBtn.elementHandle());
      });
      await page.waitForTimeout(800);

      // Sekalian ekstrak semua daftar dosen di combobox jika belum lengkap
      try {
        const comboboxLecturers = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[cmdk-item]'));
          return items
            .map((el) => (el.getAttribute('data-value') || el.innerText || el.textContent || '').trim())
            .filter((name) => name && !name.toLowerCase().includes('tampilkan semua') && name.length > 2);
        });
        if (comboboxLecturers && comboboxLecturers.length > 0) {
          upsertDosenBatchToSupabase(comboboxLecturers, credentials.prodi).catch(() => {});
        }
      } catch {}

      // Input teks pencarian di dialog popover
      const searchInput = page.locator('[role="dialog"] input, [data-radix-popper-content-wrapper] input, [cmdk-input], input[placeholder*="dosen" i], input[placeholder*="cari" i]');
      if (await searchInput.count() > 0) {
        console.log(`[BimaScraper] Mengetik nama dosen "${dosenName}" di pencarian...`);
        await searchInput.first().fill(dosenName);
        await page.waitForTimeout(800);

        // Pilih opsi yang cocok
        const escapedName = dosenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matchOption = page.locator('[role="option"], [cmdk-item]').filter({ hasText: new RegExp(escapedName, 'i') }).first();
        if (await matchOption.count() > 0) {
          console.log(`[BimaScraper] Opsi ditemukan, mengklik nama dosen di dropdown...`);
          await matchOption.click();
          await page.waitForTimeout(1500);
        } else {
          const words = dosenName.replace(/^(dr|dra|drs|ir|prof)\.?\s+/i, '').split(/[\s,]+/);
          const firstWord = words[0] || '';
          const matchPartial = page.locator('[role="option"], [cmdk-item]').filter({ hasText: new RegExp(firstWord, 'i') }).first();
          if (firstWord && await matchPartial.count() > 0) {
            console.log(`[BimaScraper] Opsi parsial "${firstWord}" ditemukan, mengklik...`);
            await matchPartial.click();
            await page.waitForTimeout(1500);
          } else {
            console.log(`[BimaScraper] Opsi spesifik di dropdown tidak ditemukan, menutup dialog...`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
          }
        }
      }
    }

    // 5. Ekstraksi semua data baris tabel
    const rawRows = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      return trs.map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
        return {
          prodi: tds[0] || '',
          kode: tds[1] || '',
          matkul: tds[2] || '',
          kelas: tds[3] || '',
          sks: tds[4] || '',
          jmlMhs: tds[5] || '',
          jadwal: tds[6] || '',
          ruang: tds[7] || '',
          dosen: tds[8] || ''
        };
      });
    });

    console.log(`[BimaScraper] Berhasil mengekstrak ${rawRows.length} baris dari tabel BIMA.`);

    // 6. Filter baris berdasarkan nama dosen & eliminasi Praktikum untuk jam kosong
    const cleanSearch = dosenName.toLowerCase().trim();
    const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const scheduleByDay = {
      Senin: [],
      Selasa: [],
      Rabu: [],
      Kamis: [],
      Jumat: [],
      Sabtu: []
    };

    let matchedCount = 0;
    let praktikumSkipped = 0;
    const filteredLecturerRows = [];

    for (const item of rawRows) {
      // Jika data lebih dari 1 dosen (misal tidak terfilter di combobox), filter via string
      if (rawRows.length > 20 && !item.dosen.toLowerCase().includes(cleanSearch)) {
        continue;
      }

      matchedCount++;
      filteredLecturerRows.push(item);

      // ATURAN FILTER: Eliminasi Praktikum untuk jadwal kosong
      if (/praktikum/i.test(item.matkul)) {
        console.log(`[BimaScraper] [SKIP PRAKTIKUM] ${item.matkul} (${item.jadwal})`);
        praktikumSkipped++;
        continue;
      }

      // Parsing format jadwal: "Senin 07:30-10:00" atau "Selasa 10:00-12:30"
      const match = item.jadwal.match(/([A-Za-z]+)\s+(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/);
      if (!match) {
        console.warn(`[BimaScraper] Format jadwal tidak dikenal: "${item.jadwal}"`);
        continue;
      }

      const hariStr = match[1];
      const jamMulai = match[2].replace('.', ':');
      const jamSelesai = match[3].replace('.', ':');

      // Standarisasi nama hari
      const standardDay = dayNames.find((d) => d.toLowerCase() === hariStr.toLowerCase());
      if (!standardDay) continue;

      scheduleByDay[standardDay].push({
        startTime: jamMulai,
        endTime: jamSelesai,
        subject: item.matkul,
        kelas: item.kelas,
        room: item.ruang,
        dosen: item.dosen
      });
    }

    console.log(`[BimaScraper] Selesai memproses:`);
    console.log(`  - Total jadwal dosen: ${matchedCount}`);
    console.log(`  - Praktikum di-skip: ${praktikumSkipped}`);
    console.log(`  - Jadwal mengajar non-praktikum: ${matchedCount - praktikumSkipped}`);

    // 7. Simpan baris-baris jadwal mengajar ke tabel `public.jadwal` di Supabase!
    const targetRowsToSave = filteredLecturerRows.length > 0 ? filteredLecturerRows : rawRows;
    if (targetRowsToSave.length > 0) {
      await upsertJadwalBatchToSupabase(dosenName, targetSemester, targetRowsToSave);
    }

    return {
      dosenName,
      semester: targetSemester,
      scheduleByDay,
      rawRows: targetRowsToSave
    };
  } catch (error) {
    console.error('[BimaScraper] Error:', error.message);
    // Coba fallback ke database Supabase jika data jadwal dosen sudah pernah tersimpan sebelumnya
    try {
      console.log(`[BimaScraper] 🛡️ Mencoba mengambil jadwal dosen "${dosenName}" dari database Supabase (fallback)...`);
      const cachedJadwal = await getJadwalFromSupabase(dosenName, targetSemester);
      if (Array.isArray(cachedJadwal) && cachedJadwal.length > 0) {
        console.log(`[BimaScraper] ✅ Ditemukan ${cachedJadwal.length} jadwal tersimpan di Supabase!`);
        const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const scheduleByDay = { Senin: [], Selasa: [], Rabu: [], Kamis: [], Jumat: [], Sabtu: [] };
        const rawRows = cachedJadwal.map((r) => {
          if (!r.isPraktikum && scheduleByDay[r.hari]) {
            scheduleByDay[r.hari].push({
              startTime: r.jamMulai,
              endTime: r.jamSelesai,
              subject: r.matkul,
              kelas: r.kelas,
              room: r.ruang,
              dosen: r.dosenNama
            });
          }
          return {
            prodi: '',
            kode: '',
            matkul: r.matkul,
            kelas: r.kelas,
            sks: r.sks,
            jmlMhs: r.jmlMhs,
            jadwal: `${r.hari} ${r.jamMulai}-${r.jamSelesai}`,
            ruang: r.ruang,
            dosen: r.dosenNama
          };
        });

        return {
          dosenName,
          semester: targetSemester,
          scheduleByDay,
          rawRows,
          fromCache: true
        };
      }
    } catch (fbErr) {
      console.warn('[BimaScraper] Supabase fallback error:', fbErr.message);
    }
    throw error;
  } finally {
    if (context) {
      await context.close().catch(() => {});
      console.log('[BimaScraper] Browser ditutup.');
    }
  }
}
