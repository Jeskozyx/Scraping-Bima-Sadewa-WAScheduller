/**
 * BIMA Jadwal Dosen — Express Server
 *
 * REST API + Static UI untuk mencari jadwal dosen UPNYK,
 * menganalisis jam kosong, dan mengirim hasil via WhatsApp.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { scrapeJadwalDosen, scrapeBimaLecturers } from './services/bimaScraper.js';
import { analyzeFullWeek } from './utils/scheduleAnalyzer.js';
import { sendScheduleToWhatsApp, getWhatsAppStatus, initWhatsApp, formatScheduleMessage } from './services/whatsappSender.js';
import { scrapeSkripsiSADEWA } from './src/sadewaScraper.js';
import { loginUser, parseNimInfo } from './services/authService.js';
import { getSkripsiFromSupabase, isSupabaseConfigured, getDosenFromSupabase, getJadwalFromSupabase, getUserFromSupabase } from './services/supabaseClient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Ekstraksi identitas pengguna secara stateless dari request HTTP
 * Memeriksa:
 * 1. Header: X-User-Nim atau Authorization Bearer
 * 2. Query parameter: ?nim=... atau ?npm=...
 * 3. Body: req.body.nim atau req.body.npm
 */
async function getUserFromRequest(req) {
  const nimQuery = req.query?.nim || req.query?.npm;
  const nimBody = req.body && (req.body.nim || req.body.npm);
  const authHeader = req.headers['authorization'];
  const bearerNim = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const headerNim = req.headers['x-user-nim'] || bearerNim;

  const targetNim = String(headerNim || nimQuery || nimBody || '').trim();
  if (!targetNim) return null;

  // Cek user di Supabase users table
  const sbUser = await getUserFromSupabase(targetNim);
  if (sbUser) {
    return {
      id: sbUser.id,
      username: sbUser.username || sbUser.nim,
      npm: sbUser.nim || sbUser.username,
      nim: sbUser.nim || sbUser.username,
      nama: sbUser.nama,
      prefixNim: sbUser.prefix_nim || String(sbUser.nim || '').slice(0, 5),
      prodi: sbUser.prodi,
      angkatan: sbUser.angkatan,
      password: sbUser.password
    };
  }

  // Jika belum tersimpan di database, parsing informasi dari NIM
  const nimMeta = parseNimInfo(targetNim);
  return {
    username: targetNim,
    npm: targetNim,
    nim: targetNim,
    nama: req.headers['x-user-nama'] || `Mahasiswa (${targetNim})`,
    prefixNim: nimMeta.prefixNim,
    prodi: nimMeta.prodi,
    angkatan: nimMeta.angkatan
  };
}

// ============================================================
// AUTHENTICATION ENDPOINTS (SSO UPN: BIMA & SADEWA - STATELESS)
// ============================================================

// POST /api/auth/login: Login dengan NIM & Password SSO UPN
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'NIM dan Password wajib diisi.'
    });
  }

  try {
    const result = await loginUser(username, password);
    return res.json(result);
  } catch (err) {
    console.error('[API Auth] Error:', err.message);
    return res.status(500).json({
      success: false,
      message: `Gagal masuk: ${err.message}`
    });
  }
});

// GET /api/auth/user: Ambil data profil mahasiswa secara stateless (via ?nim= atau header)
app.get('/api/auth/user', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (user) {
    const safeUser = { ...user };
    delete safeUser.password;
    return res.json({
      success: true,
      user: safeUser
    });
  }
  return res.json({
    success: false,
    user: null,
    message: 'Tidak ada sesi pengguna aktif pada perangkat ini.'
  });
});

// POST /api/auth/logout: Logout stateless (klien menghapus localStorage masing-masing)
app.post('/api/auth/logout', (req, res) => {
  return res.json({
    success: true,
    message: 'Logout berhasil pada perangkat ini.'
  });
});

/**
 * POST /api/search-schedule
 *
 * Body:
 *   - dosenName: string (wajib)
 *   - semester: string (opsional, default: "Gasal 2026/2027")
 *   - sendWhatsApp: boolean (opsional)
 *   - waNumber: string (opsional, wajib jika sendWhatsApp true)
 *   - nim: string (opsional / via header X-User-Nim)
 */
app.post('/api/search-schedule', async (req, res) => {
  const { dosenName, semester, sendWhatsApp, waNumber } = req.body;

  if (!dosenName || !dosenName.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Nama dosen tidak boleh kosong.'
    });
  }

  try {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`[API] Request pencarian jadwal: "${dosenName}"`);
    console.log(`${'='.repeat(50)}`);

    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Silakan masuk akun SSO UPN Anda terlebih dahulu pada perangkat ini sebelum mencari jadwal dosen.'
      });
    }
    const preferredNpm = user.npm || null;

    // 1. Scrape jadwal dosen dari BIMA (atau ambil cache Supabase jika error)
    const scrapeResult = await scrapeJadwalDosen(
      dosenName.trim(),
      semester || 'Gasal 2026/2027',
      preferredNpm
    );

    // 2. Analisis jam kosong
    const workStart = process.env.WORK_START_TIME || '07:00';
    const workEnd = process.env.WORK_END_TIME || '17:00';
    const weekAnalysis = analyzeFullWeek(scrapeResult.scheduleByDay, workStart, workEnd);

    // 3. Kirim ke WhatsApp jika diminta
    let waStatus = null;
    if (sendWhatsApp && waNumber) {
      try {
        await sendScheduleToWhatsApp(
          waNumber,
          scrapeResult.dosenName,
          scrapeResult.semester,
          weekAnalysis
        );
        waStatus = { sent: true, number: waNumber };
      } catch (waErr) {
        waStatus = { sent: false, error: waErr.message };
      }
    }

    // 4. Kirim response
    const formattedMsg = formatScheduleMessage(
      scrapeResult.dosenName,
      scrapeResult.semester,
      weekAnalysis
    );

    return res.json({
      success: true,
      data: {
        dosenName: scrapeResult.dosenName,
        semester: scrapeResult.semester,
        schedule: weekAnalysis,
        rawRows: scrapeResult.rawRows || [],
        fromCache: !!scrapeResult.fromCache,
        formattedMessage: formattedMsg,
        whatsapp: waStatus
      }
    });
  } catch (error) {
    console.error('[API] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: `Gagal mengambil jadwal: ${error.message}`
    });
  }
});

// WhatsApp status endpoint (checks connection and gets QR data URL)
app.get('/api/wa-status', (req, res) => {
  const status = getWhatsAppStatus();
  res.json({ success: true, data: status });
});

// Trigger WhatsApp initialization to start generating QR
app.post('/api/wa-init', (req, res) => {
  initWhatsApp().catch((err) => console.log('[WhatsApp] Init notice:', err.message));
  const status = getWhatsAppStatus();
  res.json({ success: true, data: status });
});

// Get complete list of lecturers for selection (SUPABASE ONLY - KOSONG JIKA BELUM LOGIN)
app.get('/api/lecturers', async (req, res) => {
  const currentUser = await getUserFromRequest(req);

  // Jika belum login SSO, defaultnya adalah KOSONG!
  if (!currentUser) {
    return res.json({
      success: true,
      source: 'supabase',
      total: 0,
      data: [],
      dosenList: [],
      message: 'Belum login SSO. Silakan masuk terlebih dahulu untuk memuat daftar dosen.'
    });
  }

  const search = req.query.search || '';
  const prodi = req.query.prodi || currentUser.prodi || '';

  try {
    const sbDosen = await getDosenFromSupabase(search, prodi);
    const list = Array.isArray(sbDosen) ? sbDosen : [];
    return res.json({
      success: true,
      source: 'supabase',
      total: list.length,
      data: list.map((d) => d.nama),
      dosenList: list
    });
  } catch (sbErr) {
    console.error('[API] Supabase dosen query error:', sbErr.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data dosen dari Supabase: ' + sbErr.message,
      data: [],
      dosenList: []
    });
  }
});

// POST /api/scrape-lecturers: On-demand scraping nama dosen dari BIMA
app.post('/api/scrape-lecturers', async (req, res) => {
  try {
    const currentUser = await getUserFromRequest(req);
    const preferredNpm = (req.body && req.body.npm) || (currentUser && currentUser.npm) || null;
    if (!currentUser && !preferredNpm) {
      return res.status(401).json({
        success: false,
        message: 'Silakan masuk akun SSO UPN terlebih dahulu untuk menyinkronkan daftar dosen BIMA.'
      });
    }
    console.log(`\n[API] 🚀 Memulai scraping daftar dosen BIMA untuk user: ${preferredNpm} (${currentUser?.prodi || ''})...`);
    const result = await scrapeBimaLecturers(preferredNpm);
    return res.json(result);
  } catch (err) {
    console.error('[API] Error scraping dosen BIMA:', err.message);
    return res.status(500).json({
      success: false,
      message: `Gagal men-scrape dosen BIMA: ${err.message}`
    });
  }
});

// GET /api/jadwal-dosen: Ambil riwayat jadwal dosen dari Supabase
app.get('/api/jadwal-dosen', async (req, res) => {
  const { dosenName, semester } = req.query;
  if (!dosenName) {
    return res.status(400).json({ success: false, message: 'Parameter dosenName diperlukan.' });
  }

  try {
    const rows = await getJadwalFromSupabase(dosenName, semester || 'Gasal 2026/2027');
    return res.json({
      success: true,
      total: rows ? rows.length : 0,
      data: rows || []
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// SADEWA Skripsi Endpoints
// ============================================================
let isScrapingSadewa = false;
let lastSadewaStatus = {
  status: 'idle', // 'idle' | 'running' | 'success' | 'error'
  message: '',
  timestamp: null,
  total: 0,
  filterNim: ''
};

// GET /api/skripsi-data: Ambil data skripsi (Supabase Cloud + fallback file lokal)
app.get('/api/skripsi-data', async (req, res) => {
  const currentUser = await getUserFromRequest(req);
  const filterNim = req.query.filterNim || (currentUser && currentUser.prefixNim) || '';
  
  if (!filterNim) {
    return res.json({
      success: true,
      source: 'empty',
      data: [],
      total: 0,
      filterNim: '',
      prodi: '',
      angkatan: '',
      lastUpdated: null,
      isScraping: isScrapingSadewa,
      status: lastSadewaStatus
    });
  }

  const nimMeta = parseNimInfo(filterNim);

  // AMBIL DATA DARI SUPABASE (SUPABASE ONLY - TANPA FILE LOKAL)
  try {
    const sbData = await getSkripsiFromSupabase(filterNim);
    const list = Array.isArray(sbData) ? sbData : [];
    return res.json({
      success: true,
      source: 'supabase',
      data: list,
      total: list.length,
      filterNim,
      prodi: nimMeta.prodi,
      angkatan: nimMeta.angkatan,
      lastUpdated: new Date().toISOString(),
      isScraping: isScrapingSadewa,
      status: lastSadewaStatus
    });
  } catch (err) {
    console.error('[API] Supabase skripsi query error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal membaca data skripsi dari Supabase: ' + err.message,
      data: [],
      total: 0
    });
  }
});

// GET /api/supabase/status: Cek status koneksi Supabase
app.get('/api/supabase/status', (req, res) => {
  const isConfigured = isSupabaseConfigured();
  return res.json({
    success: true,
    configured: isConfigured,
    url: process.env.SUPABASE_URL || null,
    hasKey: !!process.env.SUPABASE_KEY
  });
});

// POST /api/scrape-sadewa: Mulai scraping judul skripsi SADEWA (dinamis per NIM prefix)
app.post('/api/scrape-sadewa', async (req, res) => {
  if (isScrapingSadewa) {
    return res.status(429).json({
      success: false,
      message: 'Scraping SADEWA sedang berjalan di browser. Harap tunggu hingga proses selesai.'
    });
  }

  const currentUser = await getUserFromRequest(req);
  const filterNim = req.body.filterNim || (currentUser && currentUser.prefixNim);
  if (!filterNim) {
    return res.status(400).json({
      success: false,
      message: 'NIM prefix belum ditentukan. Silakan masuk akun UPN atau masukkan filter prefix NIM.'
    });
  }
  const nimMeta = parseNimInfo(filterNim);

  isScrapingSadewa = true;
  lastSadewaStatus = {
    status: 'running',
    message: `Scraping sedang berjalan untuk NIM prefix ${filterNim} (${nimMeta.prodi})...`,
    timestamp: new Date().toISOString(),
    total: 0,
    filterNim
  };

  try {
    console.log(`\n[API SADEWA] Memulai proses scraping otomatis untuk NIM "${filterNim}"...`);
    let result = null;
    try {
      const { scrapeSkripsiSADEWACepat } = await import('./src/sadewaScraperOptimized.js');
      console.log(`[API SADEWA] ⚡ Menjalankan SADEWA Scraper Optimized (Batch $$eval + Resource Blocking)...`);
      result = await scrapeSkripsiSADEWACepat(filterNim, currentUser);
    } catch (optErr) {
      console.warn(`[API SADEWA] ⚠️ Scraper teroptimasi gagal (${optErr.message}), beralih ke scraper standar...`);
      result = await scrapeSkripsiSADEWA(filterNim, currentUser);
    }

    const dataArray = Array.isArray(result) ? result : (result.data || []);

    isScrapingSadewa = false;
    lastSadewaStatus = {
      status: 'success',
      message: `Scraping selesai! ${dataArray.length} data skripsi berhasil diambil untuk prefix ${filterNim}.`,
      timestamp: new Date().toISOString(),
      total: dataArray.length,
      filterNim
    };

    return res.json({
      success: true,
      message: `Scraping SADEWA berhasil! Total ${dataArray.length} data terkumpul untuk NIM prefix ${filterNim}.`,
      data: dataArray,
      total: dataArray.length,
      filterNim,
      prodi: nimMeta.prodi,
      angkatan: nimMeta.angkatan
    });
  } catch (error) {
    isScrapingSadewa = false;
    lastSadewaStatus = {
      status: 'error',
      message: `Gagal scraping: ${error.message}`,
      timestamp: new Date().toISOString(),
      total: 0,
      filterNim
    };
    console.error('[API SADEWA] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: `Scraping gagal: ${error.message}`
    });
  }
});

// GET /api/scrape-sadewa/status: Cek status scraping saat ini
app.get('/api/scrape-sadewa/status', (req, res) => {
  res.json({
    success: true,
    isScraping: isScrapingSadewa,
    status: lastSadewaStatus
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   BIMA Jadwal Dosen Scraper — UPNYK         ║
║   Server berjalan di http://localhost:${PORT}   ║
╚══════════════════════════════════════════════╝
  `);
});
