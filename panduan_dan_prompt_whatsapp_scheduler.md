# Panduan WhatsApp Scheduler — Deploy ke Server KAI (Auto-Hapus)

Panduan deploy aplikasi pengiriman 1 pesan WhatsApp terjadwal ke **server KAI** (komputer yang berjalan 24 jam). Setelah pesan berhasil terkirim, program otomatis menghapus dirinya sendiri dalam **10 menit**.

---

## Fitur Utama

- **Input interaktif CLI** — Nomor tujuan, jam kirim, dan isi pesan diinput saat menjalankan program.
- **Login sekali** — Scan QR hanya pertama kali; sesi tersimpan di folder `auth_info`.
- **Auto-Destruct** — 10 menit setelah pesan terkirim, **seluruh folder program dihapus otomatis** (termasuk `node_modules`, `auth_info`, semua file).
- **Exit otomatis** — Program keluar sendiri setelah selesai.

---

## Arsitektur & Lifecycle

```
[Start Program]
      │
      ▼
[Input: Nomor, Jam, Pesan]
      │
      ▼
[Koneksi WhatsApp via Baileys]
      │ (scan QR jika pertama kali)
      ▼
[Standby menunggu jam kirim]
      │
      ▼
[Jam tiba → Kirim pesan]
      │
      ▼
[Tutup koneksi WA]
      │
      ▼
[Tunggu 10 menit]
      │
      ▼
[HAPUS SELURUH FOLDER PROGRAM]
      │
      ▼
[process.exit(0)]
```

---

## File yang Dibutuhkan

### 1. `package.json`

```json
{
  "name": "wa-single-scheduler",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.18",
    "node-cron": "^3.0.3",
    "pino": "^9.6.0",
    "qrcode-terminal": "^0.12.0"
  }
}
```

### 2. `index.js`

```javascript
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  delay
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';

const TIMEZONE = 'Asia/Jakarta';

// ============================================================
// KONFIGURASI FOLDER PROGRAM (untuk fitur auto-hapus)
// HANYA folder WAScheduller yang akan dihapus.
// Folder backuo_handler dan lainnya TIDAK terhapus.
// ============================================================
const PROGRAM_DIR = 'D:\\laragon\\www\\RaillNetworking\\backuo_handler\\WAScheduller';

// Waktu tunggu sebelum menghapus program (dalam milidetik)
// Default: 10 menit = 600.000 ms
const SELF_DESTRUCT_DELAY_MS = 10 * 60 * 1000;

// Deteksi folder program secara otomatis
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_DIR = PROGRAM_DIR || __dirname;

// Fungsi helper untuk membersihkan dan memformat nomor HP
// Mendukung format: 08xxx, 628xxx, +62 8xxx, +62-812-8562-0614, dll.
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/[^0-9]/g, ''); // hapus +, -, spasi, dll.
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  }
  return cleaned;
}

// Fungsi untuk menghapus seluruh folder program
async function selfDestruct() {
  console.log(`\n[Self-Destruct] Menunggu ${SELF_DESTRUCT_DELAY_MS / 1000 / 60} menit sebelum menghapus program...`);
  await delay(SELF_DESTRUCT_DELAY_MS);

  console.log(`[Self-Destruct] Menghapus folder program: ${TARGET_DIR}`);
  try {
    await rm(TARGET_DIR, { recursive: true, force: true });
    console.log('[Self-Destruct] Folder program berhasil dihapus.');
  } catch (err) {
    console.error('[Self-Destruct] Gagal menghapus folder:', err.message);
  }

  console.log('[Self-Destruct] Program selesai. Keluar.');
  process.exit(0);
}

// Fungsi meminta input dari pengguna di terminal
async function promptUserDetails() {
  const rl = readline.createInterface({ input, output });

  console.log('============================================');
  console.log('    WHATSAPP SCHEDULED MESSAGE SETUP');
  console.log('        (Mode: Server KAI + Auto-Hapus)');
  console.log('============================================\n');

  let rawPhone = '';
  while (!rawPhone.trim()) {
    rawPhone = await rl.question('>> Masukkan Nomor Tujuan (contoh: 08123456789 / +62 812-8562-0614): ');
  }

  let sendTime = '';
  const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
  while (!timeRegex.test(sendTime.trim())) {
    sendTime = await rl.question('>> Masukkan Jam Kirim (format 24 jam JJ:MM, contoh: 14:30): ');
    if (!timeRegex.test(sendTime.trim())) {
      console.log('   [Format Salah!] Harap gunakan format JJ:MM antara 00:00 s/d 23:59.');
    }
  }

  let message = '';
  while (!message.trim()) {
    message = await rl.question('>> Masukkan Isi Pesan Teks: ');
  }

  rl.close();

  const formattedNumber = formatPhoneNumber(rawPhone);
  const [hours, minutes] = sendTime.split(':').map((val) => parseInt(val, 10));
  const cronExpression = `${minutes} ${hours} * * *`;

  return {
    targetPhone: formattedNumber,
    targetJid: `${formattedNumber}@s.whatsapp.net`,
    scheduledTime: sendTime,
    cronExpression,
    messageText: message
  };
}

async function startApp() {
  // 1. Ambil input dari pengguna
  const config = await promptUserDetails();

  console.log('\n[Konfigurasi Disimpan]');
  console.log(`- Nomor Tujuan : +${config.targetPhone}`);
  console.log(`- Jadwal Kirim : ${config.scheduledTime} WIB (Cron: "${config.cronExpression}")`);
  console.log(`- Isi Pesan    : "${config.messageText}"`);
  console.log(`- Folder Program: ${TARGET_DIR}`);
  console.log(`- Auto-Hapus   : Ya (10 menit setelah pesan terkirim)`);
  console.log('\nMenghubungkan ke WhatsApp...\n');

  // 2. Inisialisasi Baileys
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('[WA] Silakan scan QR code berikut menggunakan WhatsApp Anda:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log('[WA] Koneksi terputus, mencoba menyambung kembali...');
        startApp();
      } else {
        console.log('[WA] Sesi telah logout. Silakan hapus folder ./auth_info dan scan ulang.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      console.log('[WA] Status: Terhubung!');
      console.log(`[Scheduler] Standby menunggu waktu pengiriman pukul ${config.scheduledTime} WIB...`);

      // 3. Mendaftarkan Jadwal Pengiriman
      const task = cron.schedule(config.cronExpression, async () => {
        const currentTime = new Date().toLocaleString('id-ID', { timeZone: TIMEZONE });
        console.log(`\n[Scheduler] Waktu tiba (${currentTime}). Mengirim pesan...`);

        try {
          await sock.sendMessage(config.targetJid, { text: config.messageText });
          console.log(`[Scheduler] Berhasil terkirim ke +${config.targetPhone}!`);

          task.stop();

          console.log('[WA] Menutup koneksi secara aman...');
          await delay(3000);
          sock.end(undefined);

          // 4. Aktifkan Self-Destruct (hapus program setelah 10 menit)
          await selfDestruct();
        } catch (error) {
          console.error('[Error] Gagal mengirim pesan:', error);
        }
      }, {
        scheduled: true,
        timezone: TIMEZONE
      });
    }
  });
}

// Jalankan program
startApp();
```

---

## Konfigurasi Penting

### Path Folder Program (Sudah Dikonfigurasi)

Di dalam `index.js`, path folder sudah diatur ke lokasi server KAI:

```javascript
const PROGRAM_DIR = 'D:\\laragon\\www\\RaillNetworking\\backuo_handler\\WAScheduller';
```

> **⚠️ PENTING:** Yang dihapus **HANYA** folder `WAScheduller` beserta seluruh isinya. Folder `backuo_handler` dan folder lain di luar `WAScheduller` **TIDAK** akan terhapus.

**Struktur yang terdampak:**
```
D:\laragon\www\RaillNetworking\backuo_handler\
├── WAScheduller\          ← 🗑️ FOLDER INI YANG DIHAPUS (beserta isinya)
│   ├── index.js           ← dihapus
│   ├── package.json       ← dihapus
│   ├── node_modules\      ← dihapus
│   ├── auth_info\         ← dihapus
│   └── ...                ← semua file di dalam dihapus
└── (folder lain)          ← ✅ AMAN, tidak terhapus
```

### Mengatur Waktu Tunggu Self-Destruct

Default 10 menit. Bisa diubah di baris:

```javascript
const SELF_DESTRUCT_DELAY_MS = 10 * 60 * 1000; // 10 menit
```

Contoh ubah ke 5 menit:
```javascript
const SELF_DESTRUCT_DELAY_MS = 5 * 60 * 1000; // 5 menit
```

---

## Langkah Deploy ke Server KAI

### Prasyarat
- Server KAI sudah terinstall **Node.js** (v18 atau lebih baru)
- Server terhubung ke **internet**

### Langkah-Langkah

**1. Salin folder program ke server KAI:**
```bash
# Contoh: salin via USB/SCP ke path tertentu
# misal ke /home/user/wa-scheduler atau C:\Apps\wa-scheduler
```

**2. Buka terminal di folder program, lalu install dependencies:**
```bash
cd {PATH_FOLDER_PROGRAM}
npm install
```

**3. (Opsional) Isi `PROGRAM_DIR` di `index.js` sesuai path folder:**
```javascript
const PROGRAM_DIR = '{PATH_FOLDER_PROGRAM}';
```

**4. Jalankan program:**
```bash
node index.js
```

**5. Ikuti prompt interaktif:**
```
>> Masukkan Nomor Tujuan (contoh: 08123456789 / +62 812-8562-0614): +62 812-8562-0614
>> Masukkan Jam Kirim (format 24 jam JJ:MM, contoh: 14:30): 08:30
>> Masukkan Isi Pesan Teks: Selamat pagi, ini pesan otomatis!
```

**6. Scan QR Code (pertama kali saja):**
- Buka WhatsApp HP → Settings → Linked Devices → Link a Device
- Scan QR yang muncul di terminal

**7. Biarkan terminal terbuka:**
- Program standby menunggu jam kirim
- Saat jam tiba → pesan terkirim → 10 menit kemudian folder terhapus

### Menjalankan di Background (agar terminal bisa ditutup)

**Linux (screen):**
```bash
screen -S wa-scheduler
node index.js
# Setelah input selesai & QR terscan, tekan Ctrl+A lalu D untuk detach
```

**Linux (nohup):**
```bash
# Catatan: nohup tidak mendukung input interaktif.
# Gunakan screen atau tmux saja.
```

**Windows (jangan tutup CMD):**
```cmd
node index.js
:: Biarkan CMD tetap terbuka
```

---

## Alur Lengkap

```
1. Jalankan: node index.js
2. Input nomor, jam, pesan
3. Scan QR (pertama kali)
4. Program standby menunggu...
5. Jam tiba → pesan terkirim ✅
6. Koneksi WA ditutup
7. Countdown 10 menit...
8. Seluruh folder program DIHAPUS 🗑️
9. Program exit
```

---

## FAQ

**Q: Apakah aman? Program benar-benar terhapus?**
A: Ya. Menggunakan `fs.rm()` dengan opsi `recursive: true` dan `force: true`. Seluruh isi folder (termasuk `node_modules`, `auth_info`, `index.js`, `package.json`) dihapus.

**Q: Bagaimana jika gagal menghapus?**
A: Error akan di-log ke terminal. Program tetap exit, tapi folder mungkin masih ada (perlu hapus manual).

**Q: Apakah Node.js ikut terhapus?**
A: Tidak. Yang dihapus hanya folder program ini, bukan instalasi Node.js di server.

**Q: Bisa dipakai ulang?**
A: Tidak setelah terhapus. Perlu salin ulang folder program ke server.

**Q: Server KAI pakai OS apa?**
A: Script ini kompatibel dengan **Linux** dan **Windows** (selama Node.js terinstall).