/**
 * BIMA Portal Scraper — Jadwal Dosen UPNYK (Versi BIMA v2)
 *
 * Otomasi navigasi dashboard BIMA v2, akses halaman jadwal dosen (/v2/lecturer/schedule),
 * pencarian nama dosen via combobox popup / input "Cari dosen...", ekstraksi tabel jadwal,
 * dan eliminasi mata kuliah Praktikum.
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
const SESSION_FILE = path.join(__dirname, '../auth/bima_session.json');

/**
 * Scrape jadwal dosen dari BIMA v2.
 *
 * @param {string} dosenName - Nama dosen yang dicari (misal: "Hari Prapcoyo")
 * @param {string} targetSemester - Semester target (default: "Gasal 2026/2027")
 * @returns {Promise<Object>} Jadwal dosen per hari
 */
export async function scrapeJadwalDosen(dosenName, targetSemester = 'Gasal 2026/2027') {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error(
      'Sesi login BIMA belum ditemukan! Silakan jalankan "npm run login-bima" di terminal terlebih dahulu.'
    );
  }

  let browser = null;

  try {
    console.log(`[Scraper] Memulai pencarian jadwal dosen: "${dosenName}"`);

    browser = await chromium.launch({
      headless: false,
      slowMo: 60,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      storageState: SESSION_FILE,
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    // 1. Masuk ke Dashboard BIMA v2
    console.log('[Scraper] Membuka dashboard BIMA v2...');
    await page.goto(`${BASE_URL}/v2`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    if (page.url().includes('/login')) {
      throw new Error(
        'Sesi login BIMA telah kadaluarsa (expired). Silakan jalankan kembali "npm run login-bima" di terminal.'
      );
    }

    // 2. Klik menu Jadwal Dosen di Sidebar (/v2/lecturer/schedule)
    console.log('[Scraper] Mengakses menu Jadwal Dosen (/v2/lecturer/schedule)...');
    const jadwalLink = page.locator('a[href*="/v2/lecturer/schedule"]').first();

    if (await jadwalLink.count() > 0) {
      await jadwalLink.click();
    } else {
      const textBtn = page.getByText('Jadwal Dosen', { exact: false }).first();
      if (await textBtn.count() > 0) {
        await textBtn.click();
      } else {
        await page.goto(`${BASE_URL}/v2/lecturer/schedule`, { waitUntil: 'domcontentloaded' });
      }
    }

    // 3. Tunggu tabel jadwal ter-render
    console.log('[Scraper] Menunggu tabel jadwal termuat...');
    await page.waitForSelector('table tbody tr', { timeout: 20000 });
    await page.waitForTimeout(1000);

    // 4. Cari dosen menggunakan Combobox Popup "Tampilkan Semua Jadwal Dosen"
    console.log(`[Scraper] Membuka combobox pencarian dosen...`);
    const comboboxBtn = page.locator('button[role="combobox"]').filter({ hasText: /dosen/i }).first();

    if (await comboboxBtn.count() > 0) {
      await comboboxBtn.click();
      await page.waitForTimeout(800);

      // Input teks pencarian di dialog popover
      const searchInput = page.locator('[role="dialog"] input, [data-radix-popper-content-wrapper] input, [cmdk-input]');
      if (await searchInput.count() > 0) {
        console.log(`[Scraper] Mengetik nama dosen "${dosenName}" di combobox...`);
        await searchInput.first().fill(dosenName);
        await page.waitForTimeout(800);

        // Pilih opsi yang cocok
        const matchOption = page.locator('[role="option"], [cmdk-item]').filter({ hasText: new RegExp(dosenName, 'i') }).first();
        if (await matchOption.count() > 0) {
          console.log(`[Scraper] Opsi ditemukan, mengklik nama dosen di dropdown...`);
          await matchOption.click();
          await page.waitForTimeout(1500);
        } else {
          console.log(`[Scraper] Opsi spesifik di dropdown tidak ditemukan, menutup combobox...`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
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

    console.log(`[Scraper] Berhasil mengekstrak ${rawRows.length} baris dari tabel.`);

    // 6. Filter baris berdasarkan nama dosen & eliminasi Praktikum
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

    for (const item of rawRows) {
      // Jika data lebih dari 1 dosen (misal tidak terfilter di combobox), filter via string
      if (rawRows.length > 20 && !item.dosen.toLowerCase().includes(cleanSearch)) {
        continue;
      }

      matchedCount++;

      // ATURAN FILTER: Eliminasi Praktikum
      if (/praktikum/i.test(item.matkul)) {
        console.log(`[Scraper] [SKIP PRAKTIKUM] ${item.matkul} (${item.jadwal})`);
        praktikumSkipped++;
        continue;
      }

      // Parsing format jadwal: "Senin 07:30-10:00" atau "Selasa 10:00-12:30"
      const match = item.jadwal.match(/([A-Za-z]+)\s+(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/);
      if (!match) {
        console.warn(`[Scraper] Format jadwal tidak dikenal: "${item.jadwal}"`);
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

    console.log(`[Scraper] Selesai:`);
    console.log(`  - Total jadwal dosen: ${matchedCount}`);
    console.log(`  - Praktikum di-skip: ${praktikumSkipped}`);
    console.log(`  - Jadwal mengajar non-praktikum: ${matchedCount - praktikumSkipped}`);

    return {
      dosenName,
      semester: targetSemester,
      scheduleByDay
    };
  } catch (error) {
    console.error('[Scraper] Error:', error.message);
    try {
      if (browser) {
        const pages = browser.contexts()?.[0]?.pages();
        if (pages && pages.length > 0) {
          await pages[0].screenshot({ path: 'debug_error.png', fullPage: true });
        }
      }
    } catch (_) {}
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('[Scraper] Browser ditutup.');
    }
  }
}
