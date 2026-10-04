import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getLecturers() {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const context = await browser.newContext({
    storageState: path.join(__dirname, '../auth/bima_session.json'),
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  console.log('Membuka BIMA v2...');
  await page.goto('https://bima.upnyk.ac.id/v2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.locator('a[href*="/v2/lecturer/schedule"]').first().click();
  await page.waitForSelector('table tbody tr', { timeout: 15000 });

  console.log('Membuka combobox daftar dosen...');
  const comboboxBtn = page.locator('button[role="combobox"]').filter({ hasText: /dosen/i }).first();
  await comboboxBtn.click();
  await page.waitForTimeout(1000);

  const lecturers = await page.evaluate(() => {
    const items = document.querySelectorAll('[role="option"], [cmdk-item]');
    return Array.from(items)
      .map((el) => el.innerText.trim())
      .filter((name) => name && !name.toLowerCase().includes('tampilkan semua'));
  });

  console.log(`Ditemukan ${lecturers.length} dosen.`);

  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const sorted = lecturers.sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(path.join(dataDir, 'lecturers.json'), JSON.stringify(sorted, null, 2), 'utf-8');
  console.log('✅ Berhasil disimpan ke data/lecturers.json!');

  await browser.close();
}

getLecturers().catch(console.error);
