/**
 * WhatsApp Sender — Modul Pengiriman Ringkasan Jadwal
 *
 * Menggunakan Baileys untuk mengirim hasil analisis jadwal
 * kosong dosen ke nomor WhatsApp tujuan.
 * Dilengkapi konversi QR Code ke DataURL untuk ditampilkan di Web UI.
 */

import makeWASocket, { DisconnectReason, useMultiFileAuthState, delay } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

let sock = null;
let isConnected = false;
let currentQrDataUrl = null;
let isInitializing = false;

/**
 * Format nomor HP ke standar WhatsApp JID.
 * Mendukung: 08xxx, 628xxx, +62 8xxx, +62-812-xxxx-xxxx
 */
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Mendapatkan status koneksi WhatsApp saat ini dan QR Code aktif (jika ada).
 */
export function getWhatsAppStatus() {
  return {
    isConnected,
    qr: currentQrDataUrl
  };
}

/**
 * Inisialisasi koneksi WhatsApp via Baileys.
 * QR code ditampilkan di terminal dan juga dikonversi ke Data URL untuk Web UI.
 */
export async function initWhatsApp() {
  if (sock && isConnected) return sock;
  if (isInitializing) return sock;

  isInitializing = true;

  return new Promise(async (resolve, reject) => {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

      sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        keepAliveIntervalMs: 30_000,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            currentQrDataUrl = await QRCode.toDataURL(qr, {
              width: 320,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' }
            });
          } catch (err) {
            console.error('[WhatsApp] Gagal convert QR code:', err.message);
          }

          console.log('\n[WhatsApp] Scan QR Code berikut di WhatsApp Anda (atau lihat di Web UI):');
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
          isConnected = false;
          isInitializing = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode !== DisconnectReason.loggedOut) {
            console.log('[WhatsApp] Koneksi terputus, reconnecting...');
            setTimeout(() => initWhatsApp().then(resolve).catch(reject), 3000);
          } else {
            currentQrDataUrl = null;
            reject(new Error('WhatsApp logout. Hapus folder ./auth_info dan restart.'));
          }
        }

        if (connection === 'open') {
          isConnected = true;
          isInitializing = false;
          currentQrDataUrl = null;
          console.log('[WhatsApp] Status: Terhubung!');
          resolve(sock);
        }
      });
    } catch (err) {
      isInitializing = false;
      reject(err);
    }
  });
}

/**
 * Format hasil analisis jadwal menjadi teks rapi untuk WhatsApp.
 *
 * @param {string} dosenName
 * @param {string} semester
 * @param {Object} weekAnalysis - Hasil dari analyzeFullWeek()
 * @returns {string} Teks terformat
 */
function formatScheduleMessage(dosenName, semester, weekAnalysis) {
  const dayEmojis = {
    Senin: '🟦',
    Selasa: '🟩',
    Rabu: '🟨',
    Kamis: '🟧',
    Jumat: '🟥',
    Sabtu: '🟪'
  };

  let msg = `📋 *JADWAL KOSONG DOSEN*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👤 *${dosenName}*\n`;
  msg += `📅 Semester: ${semester}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n\n`;

  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  for (const day of days) {
    const analysis = weekAnalysis[day];
    const emoji = dayEmojis[day] || '📌';

    msg += `${emoji} *${day.toUpperCase()}*\n`;

    if (!analysis.busySlots || analysis.busySlots.length === 0) {
      msg += `   ✅ Kosong sepanjang hari (07:00 - 17:00)\n`;
    } else {
      for (const slot of analysis.busySlots) {
        msg += `   🔴 ${slot.startTime} - ${slot.endTime} → ${slot.subject}`;
        if (slot.room) msg += ` (${slot.room})`;
        msg += `\n`;
      }

      if (analysis.availableSlots && analysis.availableSlots.length > 0) {
        for (const free of analysis.availableSlots) {
          msg += `   ✅ ${free.start} - ${free.end} → _Tersedia_\n`;
        }
      } else {
        msg += `   ⚠️ Tidak ada slot kosong\n`;
      }
    }
    msg += `\n`;
  }

  msg += `⏰ _Diambil otomatis dari portal BIMA UPNYK_`;

  return msg;
}

/**
 * Kirim ringkasan jadwal dosen ke WhatsApp.
 *
 * @param {string} phoneNumber - Nomor HP tujuan
 * @param {string} dosenName
 * @param {string} semester
 * @param {Object} weekAnalysis - Hasil analisis mingguan
 */
export async function sendScheduleToWhatsApp(phoneNumber, dosenName, semester, weekAnalysis) {
  const formattedNumber = formatPhoneNumber(phoneNumber);
  const jid = `${formattedNumber}@s.whatsapp.net`;

  console.log(`[WhatsApp] Mengirim ke +${formattedNumber}...`);

  if (!sock || !isConnected) {
    await initWhatsApp();
  }

  const message = formatScheduleMessage(dosenName, semester, weekAnalysis);

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await sock.sendMessage(jid, { text: message });
      console.log(`[WhatsApp] Pesan terkirim ke +${formattedNumber}`);
      return true;
    } catch (err) {
      console.warn(`[WhatsApp] Percobaan ${attempt}/5 gagal: ${err.message}`);
      if (attempt < 5) {
        await delay(3000);
      } else {
        throw new Error(`Gagal mengirim setelah 5 percobaan: ${err.message}`);
      }
    }
  }
}
