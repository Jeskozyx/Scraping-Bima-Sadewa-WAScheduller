/**
 * WAScheduller — Portal Web Otomasi UPNYK
 *
 * File entry point yang menjalankan server Express dan menyajikan Web UI:
 * 1. 📅 Jadwal Dosen BIMA: Pencarian jadwal & analisis slot jam kosong dosen
 * 2. 🎓 Skripsi SADEWA (SI 2023): Tombol scraping interaktif & katalog judul skripsi
 *
 * Akses Web UI: http://localhost:3000
 */

export { scrapeSkripsiSADEWA } from './src/sadewaScraper.js';
import './server.js';
