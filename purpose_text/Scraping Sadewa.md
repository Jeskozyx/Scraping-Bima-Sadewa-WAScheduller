# Panduan & Arsitektur Scraper Judul Skripsi SADEWA (sadewa_scraper_skripsi.md)

Dokumen ini memuat spesifikasi otomasi Playwright untuk menarik data judul skripsi mahasiswa Sistem Informasi angkatan 2023 (filter NIM `12423`) dari portal SADEWA UPN "Veteran" Yogyakarta (`https://sadewa.upnyk.ac.id/`), rekomendasi penanganan pagination DataTables, serta prompt implementasi untuk Antigravity.

---

## 1. Pemetaan Locator Elemen SADEWA

Berdasarkan inspeksi elemen (DevTools), sistem SADEWA menggunakan jQuery DataTables untuk menampilkan tabel data.

* **Menu Akademik (Sidebar):**
  * Locator: `page.locator('a:has-text("Akademik"), a:has(span:has-text("Akademik"))')`
* **Sub-menu Tugas Akhir:**
  * Locator: `page.locator('a[href*="sadewa.upnyk.ac.id/tugas_akhir/"]')`
  * Direct URL: `https://sadewa.upnyk.ac.id/tugas_akhir/`
* **Tombol "List Judul Skripsi":**
  * Locator: `page.locator('a[href*="/tugas_akhir/list_judul/"]')`
  * Direct URL: `https://sadewa.upnyk.ac.id/tugas_akhir/list_judul/`
* **Search Bar Filter NIM (`12423`):**
  * Kontainer Filter: `#table_mahasiswa_filter`
  * Locator Input: `page.locator('#table_mahasiswa_filter input[type="search"], input[type="search"]')`
* **Struktur Tabel Mahasiswa:**
  * Tabel Utama: `table#table_mahasiswa` atau `page.locator('table')`
  * Baris Data: `page.locator('#table_mahasiswa tbody tr')`
  * Kolom:
    1. Index `#` (`td:nth-child(1)`)
    2. NIM (`td:nth-child(2)`)
    3. Nama (`td:nth-child(3)`)
    4. Judul Skripsi Awal (`td:nth-child(4)`)
    5. Judul Skripsi Terbaru (`td:nth-child(5)`)
    6. Dosen Pembimbing (`td:nth-child(6)`)
    7. Status (`td:nth-child(7)`)
* **Kontrol Pagination DataTables:**
  * Dropdown jumlah baris: `select[name="table_mahasiswa_length"]`
  * Tombol Next: `page.locator('#table_mahasiswa_paginate .paginate_button.next, .paginate_button.next')`
  * Status Disabled Tombol Next: kelas `.disabled` pada tombol next

---

## 2. Rekomendasi Penanganan Pagination DataTables

Struktur `table_mahasiswa_filter` menunjukkan tabel berbasis DataTables. Terdapat dua pendekatan terbaik untuk mengambil seluruh halaman:

### Opsi A: Ubah "Show Entries" ke Jumlah Maksimal / 100 (Paling Cepat & Efisien)
DataTables secara bawaan memiliki dropdown `select[name$="_length"]` dengan opsi 10, 25, 50, 100, atau -1 (All).
1. Pilih opsi `100` atau `-1` pada dropdown entri tabel.
2. Tunggu proses render ulang tabel.
3. Scrape seluruh baris sekaligus tanpa perlu berpindah halaman berulang kali.

### Opsi B: Loop Tombol Next DataTables (Paling Stabil)
Jika opsi "All" tidak tersedia, lakukan iterasi traversing halaman:
1. Ambil data baris pada halaman aktif.
2. Cek apakah tombol `.paginate_button.next` memiliki kelas `disabled`.
3. Jika tidak berstatus `disabled`, klik tombol Next, tunggu request AJAX / render baris baru selesai (`page.waitForResponse` atau penundaan DOM state), lalu ulangi scraping baris.
4. Hentikan loop saat tombol Next berstatus `disabled`.

---

## 3. Implementasi Skrip Scraper Playwright (`sadewaScraper.js`)

```javascript
import { chromium } from 'playwright';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

export async function scrapeSkripsiSADEWA() {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100 
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('[SADEWA] Membuka halaman login...');
        await page.goto('[https://sadewa.upnyk.ac.id/](https://sadewa.upnyk.ac.id/)', { waitUntil: 'domcontentloaded' });

        // 1. Proses Autentikasi
        await page.locator('input[name="username"], input[type="text"]').first().fill(process.env.SADEWA_NIM || '124230127');
        await page.locator('input[name="password"], input[type="password"]').first().fill(process.env.SADEWA_PASSWORD || '');
        await page.locator('button[type="submit"], input[type="submit"]').first().click();

        // Tunggu navigasi dashboard
        await page.waitForLoadState('networkidle');

        // 2. Navigasi Langsung ke List Judul Skripsi (Mempercepat alur)
        console.log('[SADEWA] Menuju halaman List Judul Skripsi...');
        await page.goto('[https://sadewa.upnyk.ac.id/tugas_akhir/list_judul/](https://sadewa.upnyk.ac.id/tugas_akhir/list_judul/)', { waitUntil: 'networkidle' });

        // Fallback jika direct URL terproteksi navigasi bertingkat:
        if (!page.url().includes('list_judul')) {
            await page.locator('a:has-text("Akademik")').click();
            await page.locator('a[href*="/tugas_akhir/"]').first().click();
            await page.locator('a[href*="/tugas_akhir/list_judul/"]').click();
            await page.waitForLoadState('networkidle');
        }

        // 3. Masukkan Filter NIM 12423 (Sistem Informasi Angkatan 2023)
        console.log('[SADEWA] Memfilter NIM: 12423...');
        const searchInput = page.locator('#table_mahasiswa_filter input, input[type="search"]').first();
        await searchInput.fill('12423');
        await page.waitForTimeout(1500); // Tunggu debounce filter DataTables selesai

        // 4. Ubah Tampilan Entri ke Maksimal (jika tersedia opsi 100)
        const lengthSelect = page.locator('select[name*="length"]');
        if (await lengthSelect.count() > 0) {
            await lengthSelect.selectOption('100').catch(() => {});
            await page.waitForTimeout(1000);
        }

        // 5. Scrape Data Melalui Pagination
        const hasilScrape = [];
        let halaman = 1;
        lethasNext = true;

        while (hasNext) {
            console.log(`[SADEWA] Mengambil data halaman ${halaman}...`);
            await page.waitForSelector('table tbody tr', { timeout: 15000 });

            const rows = page.locator('table tbody tr');
            const rowCount = await rows.count();

            for (let i = 0; i < rowCount; i++) {
                const cells = rows.nth(i).locator('td');
                const colCount = await cells.count();
                
                // Pastikan bukan baris "No data available in table"
                if (colCount >= 6) {
                    const rowData = {
                        no: (await cells.nth(0).innerText()).trim(),
                        nim: (await cells.nth(1).innerText()).trim(),
                        nama: (await cells.nth(2).innerText()).trim(),
                        judulAwal: (await cells.nth(3).innerText()).trim(),
                        judulTerbaru: (await cells.nth(4).innerText()).trim(),
                        dosenPembimbing: (await cells.nth(5).innerText()).trim(),
                        status: colCount >= 7 ? (await cells.nth(6).innerText()).trim() : ''
                    };
                    hasilScrape.push(rowData);
                }
            }

            // Cek kondisi tombol Next
            const nextButton = page.locator('.paginate_button.next');
            const isNextDisabled = await nextButton.evaluate(el => el.classList.contains('disabled')).catch(() => true);

            if (!isNextDisabled && (await nextButton.isVisible())) {
                await nextButton.click();
                await page.waitForTimeout(1200); // Tunggu animasi dan DOM berganti
                halaman++;
            } else {
                hasNext = false;
            }
        }

        console.log(`[SADEWA] Berhasil mengumpulkan total ${hasilScrape.length} data skripsi.`);
        
        // Simpan hasil ke file JSON
        fs.writeFileSync('skripsi_si_2023.json', JSON.stringify(hasilScrape, null, 2), 'utf-8');
        console.log('[SADEWA] Data tersimpan di skripsi_si_2023.json');

        return hasilScrape;

    } catch (error) {
        console.error('[Error Scraping]:', error.message);
        await page.screenshot({ path: 'error_sadewa.png', fullPage: true });
        throw error;
    } finally {
        await browser.close();
    }
}