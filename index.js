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

let currentSock = null;
let scheduledTask = null;
let isConnected = false;

// Fungsi helper kirim pesan dengan auto-retry jika koneksi sedang terputus/reconnect
async function sendMessageWithRetry(targetJid, messageText, maxRetries = 12, retryDelayMs = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!currentSock || !isConnected) {
        throw new Error('Socket WhatsApp sedang tidak aktif / reconnecting.');
      }
      await currentSock.sendMessage(targetJid, { text: messageText });
      return true;
    } catch (err) {
      console.warn(`[Scheduler] Percobaan kirim ke-${attempt}/${maxRetries} gagal: ${err.message}`);
      if (attempt < maxRetries) {
        console.log(`[Scheduler] Menunggu ${retryDelayMs / 1000} detik sebelum mencoba ulang...`);
        await delay(retryDelayMs);
      } else {
        throw new Error(`Gagal mengirim pesan setelah ${maxRetries} percobaan. Error terakhir: ${err.message}`);
      }
    }
  }
}

async function connectToWhatsApp(config) {
  // Inisialisasi Baileys
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    keepAliveIntervalMs: 30_000,       // Ping rutin setiap 30 detik agar koneksi tidak dianggap idle
    connectTimeoutMs: 60_000,          // Timeout koneksi 60 detik
    defaultQueryTimeoutMs: 60_000
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('[WA] Silakan scan QR code berikut menggunakan WhatsApp Anda:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log('[WA] Koneksi terputus, mencoba menyambung kembali dalam 3 detik...');
        await delay(3000);
        connectToWhatsApp(config);
      } else {
        console.log('[WA] Sesi telah logout. Silakan hapus folder ./auth_info dan scan ulang.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      isConnected = true;
      console.log('[WA] Status: Terhubung!');

      // Daftarkan jadwal pengiriman jika belum terdaftar
      if (!scheduledTask) {
        console.log(`[Scheduler] Standby menunggu waktu pengiriman pukul ${config.scheduledTime} WIB...`);

        scheduledTask = cron.schedule(config.cronExpression, async () => {
          const currentTime = new Date().toLocaleString('id-ID', { timeZone: TIMEZONE });
          console.log(`\n[Scheduler] Waktu tiba (${currentTime}). Mengirim pesan...`);

          try {
            await sendMessageWithRetry(config.targetJid, config.messageText);
            console.log(`[Scheduler] Berhasil terkirim ke +${config.targetPhone}!`);

            scheduledTask.stop();

            console.log('[WA] Menutup koneksi secara aman...');
            await delay(3000);
            if (currentSock) {
              currentSock.end(undefined);
            }

            // Aktifkan Self-Destruct (hapus program setelah 10 menit)
            await selfDestruct();
          } catch (error) {
            console.error('[Error] Gagal mengirim pesan:', error.message);
          }
        }, {
          scheduled: true,
          timezone: TIMEZONE
        });
      } else {
        console.log(`[Scheduler] Melanjutkan standby menunggu waktu pengiriman pukul ${config.scheduledTime} WIB...`);
      }
    }
  });
}

async function startApp() {
  // 1. Ambil input dari pengguna (hanya sekali di awal)
  const config = await promptUserDetails();

  console.log('\n[Konfigurasi Disimpan]');
  console.log(`- Nomor Tujuan : +${config.targetPhone}`);
  console.log(`- Jadwal Kirim : ${config.scheduledTime} WIB (Cron: "${config.cronExpression}")`);
  console.log(`- Isi Pesan    : "${config.messageText}"`);
  console.log(`- Folder Program: ${TARGET_DIR}`);
  console.log(`- Auto-Hapus   : Ya (10 menit setelah pesan terkirim)`);
  console.log('\nMenghubungkan ke WhatsApp...\n');

  // 2. Hubungkan ke WhatsApp
  await connectToWhatsApp(config);
}

// Jalankan program
startApp();

