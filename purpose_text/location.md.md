# Pemetaan Locator dan Struktur Lokasi Elemen BIMA (location.md)

Dokumen ini memuat daftar acuan selector (locator) untuk otomasi web BIMA UPN "Veteran" Yogyakarta (`https://bima.upnyk.ac.id/`) menggunakan Playwright, panduan inspeksi elemen langsung, serta pemetaan struktur direktori proyek.

---

## 1. Pemetaan Locator Elemen Web BIMA

Untuk mencegah kegagalan `Timeout 30000ms exceeded`, gunakan locator berbasis peran (role), teks (text), atau atribut input spesifik, bukan nama kelas CSS generik seperti `.sidebar` atau `.navbar`.

### A. Halaman Autentikasi (Login)
* **URL Target:** `https://bima.upnyk.ac.id/login` atau `https://bima.upnyk.ac.id/`
* **Input Username / NIM:**
  * Prioritas 1: `page.locator('input[name="username"]')`
  * Prioritas 2: `page.getByPlaceholder(/nomor induk|nim|username/i)`
  * Prioritas 3: `page.locator('input[type="text"]').first()`
* **Input Password:**
  * Prioritas 1: `page.locator('input[name="password"]')`
  * Prioritas 2: `page.locator('input[type="password"]')`
* **Tombol Masuk / Login:**
  * Prioritas 1: `page.getByRole('button', { name: /masuk|login/i })`
  * Prioritas 2: `page.locator('button[type="submit"]')`

### B. Validasi Keberhasilan Login (Indikator Dashboard)
Hindari menunggu selector CSS generik. Gunakan indikator teks atau URL berikut:
* **Indikator URL:** `await page.waitForURL('**/dashboard**', { timeout: 45000 })`
* **Indikator Teks Dashboard:** `page.getByText('Dashboard', { exact: true })`
* **Indikator Header Selamat Datang:** `page.locator('h1, h2, h3, h4').filter({ hasText: /dashboard|selamat datang|informasi/i })`

### C. Menu Navigasi Samping (Sidebar BIMA v2)
* **Kontainer Navigasi Utama:** `div[data-slot="sidebar-group-content"] ul[data-slot="sidebar-menu"]`
* **Menu Jadwal Dosen (Terverifikasi):**
  * Prioritas 1: `page.locator('a[href*="/v2/lecturer/schedule"]')`
  * Prioritas 2: `page.getByText('Jadwal Dosen', { exact: false })`
  * Target URL: `https://bima.upnyk.ac.id/v2/lecturer/schedule`

### D. Elemen Filter Pencarian Dosen (BIMA v2)
* **Tombol Dropdown / Popover Dosen:**
  * Selector: `button[aria-haspopup="dialog"]`, `button:has(span.truncate:has-text("Tampilkan Semua Jadwal Dosen"))`, atau `button:has-text("Tampilkan Semua Jadwal Dosen")`
  * Atribut: `aria-haspopup="dialog"`, `aria-expanded="false"`, `data-state="closed"`
* **Input Dialog Pencarian:**
  * Selector: `[role="dialog"] input, [cmdk-input], [data-radix-popper-content-wrapper] input`
  * Placeholder: `"Cari dosen..."`
* **Item Opsi Dosen:**
  * Selector: `[role="option"], [cmdk-item], [data-radix-collection-item]`

### E. Struktur Tabel Jadwal Dosen (BIMA v2)
* **Tabel:** `table tbody tr`
* **Kolom:**
  * `td[0]`: Prodi
  * `td[1]`: Kode Mata Kuliah
  * `td[2]`: Nama Mata Kuliah
  * `td[3]`: Kelas
  * `td[4]`: SKS
  * `td[5]`: Jumlah Mahasiswa
  * `td[6]`: Jadwal (Format: `[Hari] [HH:mm]-[HH:mm]`)
  * `td[7]`: Ruang
  * `td[8]`: Dosen

### E. Tabel Jadwal dan Ekstraksi Data
* **Kontainer Tabel:** `page.locator('table')`
* **Baris Data:** `page.locator('table tbody tr')`
* **Kolom Ekstraksi (Pola Umum):**
  * Hari / Jam: `row.locator('td').nth(1)` atau `nth(2)`
  * Mata Kuliah: `row.locator('td').nth(3)`
  * Ruang / Kelas: `row.locator('td').nth(4)`
* **Pengecualian Praktikum:**
  * Evaluasi teks baris menggunakan regex: `!/praktikum/i.test(mataKuliahText)`

---

## 2. Strategi Implementasi Robust Locators di Playwright

Gunakan pola berikut pada file scraper (`bimaScraper.js`):

```javascript
// Contoh navigasi dan login adaptif
async function loginBIMA(page, username, password) {
    await page.goto('[https://bima.upnyk.ac.id/](https://bima.upnyk.ac.id/)', { waitUntil: 'domcontentloaded' });

    // Isi kredensial
    const userInput = page.locator('input[name="username"], input[type="text"]').first();
    const passInput = page.locator('input[name="password"], input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"], button:has-text("Masuk"), button:has-text("Login")').first();

    await userInput.fill(username);
    await passInput.fill(password);
    await submitBtn.click();

    // Tunggu navigasi dashboard dengan fallback
    try {
        await Promise.race([
            page.waitForURL(/.*dashboard.*/i, { timeout: 30000 }),
            page.waitForSelector('text=Dashboard', { timeout: 30000 }),
            page.waitForSelector('text=Jadwal Dosen', { timeout: 30000 })
        ]);
        console.log('[Auth] Berhasil masuk ke dashboard BIMA.');
    } catch (err) {
        await page.screenshot({ path: 'debug_login_failed.png', fullPage: true });
        throw new Error('Gagal mendeteksi halaman dashboard setelah login. Screenshot disimpan ke debug_login_failed.png');
    }
}