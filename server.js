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
import { scrapeJadwalDosen } from './services/bimaScraper.js';
import { analyzeFullWeek } from './utils/scheduleAnalyzer.js';
import { sendScheduleToWhatsApp, getWhatsAppStatus, initWhatsApp } from './services/whatsappSender.js';

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
 * POST /api/search-schedule
 *
 * Body:
 *   - dosenName: string (wajib)
 *   - semester: string (opsional, default: "Gasal 2026/2027")
 *   - sendWhatsApp: boolean (opsional)
 *   - waNumber: string (opsional, wajib jika sendWhatsApp true)
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

    // 1. Scrape jadwal dosen dari BIMA
    const scrapeResult = await scrapeJadwalDosen(
      dosenName.trim(),
      semester || 'Gasal 2026/2027'
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
    return res.json({
      success: true,
      data: {
        dosenName: scrapeResult.dosenName,
        semester: scrapeResult.semester,
        schedule: weekAnalysis,
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

// Get complete list of lecturers for selection
app.get('/api/lecturers', (req, res) => {
  const lecturersPath = path.join(__dirname, 'data/lecturers.json');
  if (fs.existsSync(lecturersPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(lecturersPath, 'utf-8'));
      return res.json({ success: true, data });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Gagal membaca data dosen' });
    }
  }
  res.json({ success: true, data: [] });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
