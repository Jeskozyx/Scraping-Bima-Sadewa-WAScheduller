import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { locateLecturerTriggerButton, extractLecturersAndSchedules } from '../services/bimaScraper.js';
import { upsertDosenBatchToSupabase } from '../services/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getLecturers() {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  console.log('Membuka BIMA v2...');
  await page.goto('https://bima.upnyk.ac.id/v2/lecturer/schedule', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const result = await extractLecturersAndSchedules(page, 'Umum');
  console.log(`✅ Berhasil mendeteksi & menyimpan ${result.total} dosen ke Supabase!`);

  await browser.close();
}

getLecturers().catch(console.error);
