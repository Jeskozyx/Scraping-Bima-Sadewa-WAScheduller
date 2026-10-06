import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { trySolveCaptchaFree } from '../services/audioCaptchaSolver.js';
import { solveRecaptcha, injectRecaptchaToken } from '../services/captchaSolver.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://sadewa.upnyk.ac.id';
const AUTH_DIR = path.resolve(__dirname, '../auth');
const SESSION_FILE = path.join(AUTH_DIR, 'sadewa_session.json');
const EXTENSION_DIR = path.resolve(__dirname, '../extensions/buster');
const PROFILE_DIR = path.resolve(__dirname, '../tmp/chrome_profile_sadewa');
const OUTPUT_FILE = path.resolve(__dirname, '../skripsi_si_2023.json');

/**
 * Scraper otomatis untuk portal SADEWA UPN "Veteran" Yogyakarta
 * Mengambil data judul skripsi mahasiswa Sistem Informasi angkatan 2023 (Filter NIM: 12423)
 *
 * Menggunakan sistem otomatis seperti pada BIMA:
 * 1. Session Storage Persistence (auth/sadewa_session.json) - login sekali, pakai berulang kali tanpa CAPTCHA
 * 2. Ekstensi Buster + Audio Challenge Solver otomatis jika sesi belum ada atau kadaluarsa
 * 3. Fallback API Solver jika API key tersedia di .env
 * 4. Scraping DataTables dengan filter '12423' dan pagination otomatis hingga tuntas
 * 5. Menyimpan hasil ekstraksi ke file 'skripsi_si_2023.json'
 */
export async function scrapeSkripsiSADEWA() {
    const username = process.env.SADEWA_NIM || process.env.BIMA_USERNAME || '';
    const password = process.env.SADEWA_PASSWORD || process.env.BIMA_PASSWORD || '';

    if (!username || !password) {
        throw new Error(
            '[SADEWA] Kredensial tidak ditemukan! Pastikan SADEWA_NIM & SADEWA_PASSWORD ' +
            '(atau BIMA_USERNAME & BIMA_PASSWORD) tersedia di .env'
        );
    }

    console.log('[SADEWA] 🚀 Memulai scraper SADEWA...');
    console.log(`[SADEWA] 👤 Username / NIM: ${username}`);

    let browser = null;
    let context = null;
    let page = null;

    try {
        // ═══════════════════════════════════════════════════════════════
        // TAHAP 1: CEK SESI TERSIMPAN (PERSISTENT SESSION REUSE)
        // ═══════════════════════════════════════════════════════════════
        if (fs.existsSync(SESSION_FILE)) {
            console.log('[SADEWA] 🔍 Ditemukan file sesi login:', SESSION_FILE);
            console.log('[SADEWA] ⚡ Mencoba mengakses SADEWA menggunakan sesi tersimpan...');

            browser = await chromium.launch({
                headless: false,
                slowMo: 50,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            context = await browser.newContext({
                storageState: SESSION_FILE,
                viewport: { width: 1366, height: 768 },
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            });

            page = await context.newPage();
            await page.goto(`${BASE_URL}/tugas_akhir/list_judul/`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });
            await page.waitForTimeout(2000);

            // Cek apakah dialihkan ke login/lockscreen
            const isLoginPage = page.url().includes('/login') ||
                (await page.locator('body.lockscreen, input[placeholder="username"], input[name="username"]').count().catch(() => 0)) > 0;

            if (isLoginPage) {
                console.log('[SADEWA] ⚠️ Sesi tersimpan sudah kadaluarsa. Memperbarui sesi dengan login otomatis...');
                await context.close().catch(() => {});
                await browser.close().catch(() => {});
                browser = null;
                context = null;
                page = null;
            } else {
                console.log('[SADEWA] ✅ Sesi aktif berhasil digunakan! Melewati proses login & CAPTCHA.');
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // TAHAP 2: LOGIN OTOMATIS + CAPTCHA SOLVER (JIKA BELUM LOGIN)
        // ═══════════════════════════════════════════════════════════════
        if (!context) {
            console.log('[SADEWA] 🔐 Membuka peramban untuk login otomatis & pemecahan CAPTCHA...');

            const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
            const hasBuster = fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'));
            if (hasBuster) {
                console.log('[SADEWA] 🧩 Memuat ekstensi Buster (Captcha Solver for Humans)...');
                launchArgs.push(`--disable-extensions-except=${EXTENSION_DIR}`);
                launchArgs.push(`--load-extension=${EXTENSION_DIR}`);
            }

            if (!fs.existsSync(PROFILE_DIR)) {
                fs.mkdirSync(PROFILE_DIR, { recursive: true });
            }

            context = await chromium.launchPersistentContext(PROFILE_DIR, {
                headless: false,
                slowMo: 60,
                viewport: { width: 1366, height: 768 },
                args: launchArgs
            });

            page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

            await page.goto(`${BASE_URL}/`, {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            });
            await page.waitForTimeout(1500);

            // Cek apakah profil browser persisten sudah dalam status login
            const alreadyLoggedIn = (await page.locator('.sidebar-menu, .main-sidebar, a[href*="logout"], a:has-text("Akademik")').count().catch(() => 0)) > 0;

            if (!alreadyLoggedIn) {
                // Mengisi username & password
                const usernameInput = page.locator('input[placeholder="username"], input[name="username"], input[type="text"]').first();
                const passwordInput = page.locator('input[name="password"], input[placeholder="password"], input[type="password"]').first();

                await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
                await usernameInput.fill(username);
                await passwordInput.fill(password);
                console.log('[SADEWA]   ✅ Username & Password berhasil diisi.');

                // Jalankan solver otomatis (Buster & Audio STT)
                console.log('[SADEWA] 🤖 Menjalankan solver CAPTCHA otomatis (Buster & Audio Solver)...');
                const freeSolveResult = await trySolveCaptchaFree(page);
                let isCaptchaSolved = freeSolveResult.success;

                // Fallback API solver jika gratis belum berhasil & ada key
                const hasSolverApiKey = !!(process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || process.env.CAPSOLVER_API_KEY);
                if (!isCaptchaSolved && hasSolverApiKey) {
                    console.log('[SADEWA] 🌐 [Fallback] Menggunakan API Solver berbayar dari .env...');
                    try {
                        const sitekey = await page.evaluate(() => {
                            const el = document.querySelector('.g-recaptcha, [data-sitekey]');
                            return el ? el.getAttribute('data-sitekey') : '6LekiE0sAAAAABv_pEjSv8h_B6WNnz8BTlqe7AYZ';
                        });
                        const solveResult = await solveRecaptcha({ sitekey, pageUrl: `${BASE_URL}/` });
                        if (solveResult.success && solveResult.token) {
                            await injectRecaptchaToken(page, solveResult.token);
                            isCaptchaSolved = true;
                        }
                    } catch (e) {
                        console.warn('[SADEWA] ⚠️ API Solver fallback error:', e.message);
                    }
                }

                if (isCaptchaSolved) {
                    console.log('[SADEWA] 🎉 CAPTCHA terverifikasi! Mengklik tombol LOGIN otomatis...');
                    await page.waitForTimeout(1000);
                    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("LOGIN")').first();
                    await submitBtn.click().catch(() => {});
                } else {
                    console.log('[SADEWA] ℹ️ Memantau verifikasi CAPTCHA otomatis atau manual (maks 2 menit)...');
                }

                // Monitoring hingga login sukses
                const startTime = Date.now();
                const maxWaitMs = 120_000;
                let loggedIn = false;

                while (Date.now() - startTime < maxWaitMs) {
                    const hasDashboard = await page.locator('.sidebar-menu, .main-sidebar, a[href*="logout"], a:has-text("Akademik"), nav.navbar').count().catch(() => 0);
                    const isLockscreen = await page.locator('body.lockscreen').count().catch(() => 0);
                    const isLoginForm = await page.locator('input[placeholder="username"], input[name="username"]').isVisible().catch(() => false);

                    if (hasDashboard > 0 || (!isLoginForm && isLockscreen === 0)) {
                        loggedIn = true;
                        break;
                    }

                    // Auto-click LOGIN jika reCAPTCHA tercentang
                    const captchaResponse = await page.evaluate(() => {
                        const el = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
                        return el ? el.value : '';
                    }).catch(() => '');

                    if (captchaResponse && captchaResponse.length > 20 && isLoginForm) {
                        console.log('[SADEWA] 🤖 reCAPTCHA terverifikasi! Mengklik tombol LOGIN otomatis...');
                        const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("LOGIN")').first();
                        if (await submitBtn.isVisible().catch(() => false)) {
                            await submitBtn.click().catch(() => {});
                            await page.waitForTimeout(2500);
                        }
                    }

                    await page.waitForTimeout(1000);
                }

                if (!loggedIn) {
                    throw new Error('Login SADEWA gagal atau waktu tunggu habis (2 menit).');
                }
            }

            // Simpan Sesi (Cookies & StorageState) untuk reuse selanjutnya
            if (!fs.existsSync(AUTH_DIR)) {
                fs.mkdirSync(AUTH_DIR, { recursive: true });
            }
            await context.storageState({ path: SESSION_FILE });
            console.log('[SADEWA] 💾 Sesi login berhasil disimpan di:');
            console.log(`         ${SESSION_FILE}`);

            // Arahkan ke halaman List Judul Skripsi
            console.log('[SADEWA] 📄 Mengakses halaman List Judul Skripsi...');
            await page.goto(`${BASE_URL}/tugas_akhir/list_judul/`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }

        // Pastikan kita sudah di halaman list_judul
        if (!page.url().includes('list_judul')) {
            console.log('[SADEWA] ⚠️ Mengakses menu Tugas Akhir -> List Judul...');
            await page.goto(`${BASE_URL}/tugas_akhir/list_judul/`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }

        console.log('[SADEWA] ✅ Berada di halaman target:', page.url());

        // ═══════════════════════════════════════════════════════════════
        // TAHAP 3: FILTER DATATABLES — NIM PREFIX '12423' (SI 2023)
        // ═══════════════════════════════════════════════════════════════
        console.log('[SADEWA] 🔍 Memfilter NIM "12423" (Sistem Informasi Angkatan 2023)...');
        await page.waitForSelector('#table_mahasiswa_filter input, input[type="search"]', { timeout: 20000 });

        const searchInput = page.locator('#table_mahasiswa_filter input[type="search"], #table_mahasiswa_filter input, input[type="search"]').first();
        await searchInput.fill('12423');
        await page.waitForTimeout(2000); // Tunggu debounce DataTables merender ulang tabel

        // ═══════════════════════════════════════════════════════════════
        // TAHAP 4: SET JUMLAH ENTRI KE 100 (OPSI MAKSIMAL)
        // ═══════════════════════════════════════════════════════════════
        const lengthSelect = page.locator('select[name="table_mahasiswa_length"], select[name$="_length"]').first();
        if ((await lengthSelect.count()) > 0) {
            try {
                console.log('[SADEWA] 📊 Mengubah tampilan entri ke 100 per halaman...');
                await lengthSelect.selectOption('100');
                await page.waitForTimeout(1500);
            } catch {
                console.log('[SADEWA] ℹ️ Opsi 100 tidak tersedia atau gagal dipilih, melanjutkan...');
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // TAHAP 5: SCRAPE SELURUH DATA DENGAN PAGINATION
        // ═══════════════════════════════════════════════════════════════
        const hasilScrape = [];
        let halaman = 1;
        let hasNext = true;

        while (hasNext) {
            console.log(`[SADEWA] 📖 Mengambil data pada halaman ${halaman}...`);
            await page.waitForSelector('#table_mahasiswa tbody tr, table tbody tr', { timeout: 20000 });

            // Tunggu jika DataTables sedang memproses (processing overlay)
            const processing = page.locator('#table_mahasiswa_processing, .dataTables_processing');
            if (await processing.count() > 0) {
                await processing.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
            }

            const rows = page.locator('#table_mahasiswa tbody tr, table tbody tr');
            const rowCount = await rows.count();

            for (let i = 0; i < rowCount; i++) {
                const cells = rows.nth(i).locator('td');
                const colCount = await cells.count();

                // Pastikan baris data lengkap (bukan 'No data available in table')
                if (colCount >= 6) {
                    const rowData = {
                        no: (await cells.nth(0).innerText()).trim(),
                        nim: (await cells.nth(1).innerText()).trim(),
                        nama: (await cells.nth(2).innerText()).trim(),
                        judulAwal: (await cells.nth(3).innerText()).trim(),
                        judulTerbaru: (await cells.nth(4).innerText()).trim(),
                        dosenPembimbing: (await cells.nth(5).innerText()).trim(),
                        status: colCount >= 7 ? (await cells.nth(6).innerText()).trim() : '',
                    };

                    // Filter hanya NIM valid & hindari duplikasi
                    if (rowData.nim && !hasilScrape.some((item) => item.nim === rowData.nim)) {
                        hasilScrape.push(rowData);
                    }
                }
            }

            console.log(`[SADEWA]   ✅ Halaman ${halaman}: total ${hasilScrape.length} data terkumpul.`);

            // Cek status tombol Next DataTables
            const nextButton = page.locator('#table_mahasiswa_paginate .paginate_button.next, .paginate_button.next').first();
            let isNextDisabled = true;

            if ((await nextButton.count()) > 0 && (await nextButton.isVisible())) {
                isNextDisabled = await nextButton.evaluate((el) => el.classList.contains('disabled')).catch(() => true);
            }

            if (!isNextDisabled) {
                await nextButton.click();
                await page.waitForTimeout(1500); // Tunggu render halaman berikutnya
                halaman++;
            } else {
                hasNext = false;
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // TAHAP 6: SIMPAN HASIL KE JSON
        // ═══════════════════════════════════════════════════════════════
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(hasilScrape, null, 2), 'utf-8');

        console.log('');
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  🎉 SCRAPING SADEWA SELESAI!                                 ║');
        console.log(`║  📊 Total Data: ${String(hasilScrape.length).padEnd(45)}║`);
        console.log(`║  📄 Total Halaman: ${String(halaman).padEnd(42)}║`);
        console.log('║  💾 File: skripsi_si_2023.json                               ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');

        return hasilScrape;

    } catch (error) {
        console.error('[SADEWA] ❌ Error saat proses scraping:', error.message);
        if (page) {
            const screenshotPath = path.resolve('error_sadewa_scraping.png');
            await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
            console.error(`[SADEWA] 📸 Screenshot error disimpan di: ${screenshotPath}`);
        }
        throw error;
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        } else if (context) {
            await context.close().catch(() => {});
        }
        console.log('[SADEWA] 🔒 Browser ditutup.');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ENTRY POINT LANGSUNG VIA CLI
// ═══════════════════════════════════════════════════════════════════════
const isDirectRun =
    process.argv[1] &&
    (process.argv[1].endsWith('sadewaScraper.js') ||
        process.argv[1].includes('sadewaScraper'));

if (isDirectRun) {
    scrapeSkripsiSADEWA()
        .then((result) => {
            console.log(`\n✅ Selesai! Sebanyak ${result.length} judul skripsi berhasil diekstrak.`);
            process.exit(0);
        })
        .catch((err) => {
            console.error('\n❌ Eksekusi scraper gagal:', err.message);
            process.exit(1);
        });
}
