/**
 * Script Sinkronisasi Data Lokal ke Supabase Database
 * 
 * Mengirimkan data pengguna aktif dan seluruh data skripsi lokal
 * langsung ke tabel `users` dan `skripsi` di Supabase.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { upsertUserToSupabase, upsertSkripsiBatchToSupabase, isSupabaseConfigured } from '../services/supabaseClient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function syncAll() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('   SINKRONISASI DATA LOKAL KE SUPABASE DATABASE');
  console.log('════════════════════════════════════════════════════════════');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_URL.trim()) {
    console.error('❌ SUPABASE_URL belum diisi di file .env!');
    console.error('   Silakan klik tombol hijau "Connect" di dashboard Supabase Anda,');
    console.error('   lalu salin Project URL (https://xxxx.supabase.co) ke file .env.');
    process.exit(1);
  }

  if (!isSupabaseConfigured()) {
    console.error('❌ Supabase belum terkonfigurasi dengan benar.');
    process.exit(1);
  }

  // 1. SINKRONKAN DATA PENGGUNA
  const userFile = path.resolve(__dirname, '../auth/current_user.json');
  if (fs.existsSync(userFile)) {
    try {
      const user = JSON.parse(fs.readFileSync(userFile, 'utf-8'));
      console.log(`\n👤 Mengunggah profil pengguna: ${user.nama} (${user.npm})...`);
      await upsertUserToSupabase({
        username: user.npm,
        password: process.env.SADEWA_PASSWORD || process.env.BIMA_PASSWORD || '',
        npm: user.npm,
        nama: user.nama,
        prefixNim: user.prefixNim,
        prodi: user.prodi,
        angkatan: user.angkatan
      });
      console.log('✅ Profil pengguna berhasil diunggah ke tabel public.users!');
    } catch (e) {
      console.error('⚠️ Gagal sinkronkan user:', e.message);
    }
  }

  // 2. SINKRONKAN DATA SKRIPSI
  const rootDir = path.resolve(__dirname, '..');
  const files = fs.readdirSync(rootDir).filter(f => f.startsWith('skripsi_') && f.endsWith('.json'));

  let totalUploaded = 0;
  for (const file of files) {
    const filePath = path.join(rootDir, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const list = Array.isArray(content) ? content : (content.data || []);
      if (list.length > 0) {
        console.log(`\n📚 Mengunggah ${list.length} judul skripsi dari ${file}...`);
        const prefix = file.replace('skripsi_', '').replace('.json', '') || '12423';
        await upsertSkripsiBatchToSupabase(list, prefix);
        totalUploaded += list.length;
        console.log(`✅ File ${file} berhasil disinkronkan ke tabel public.skripsi!`);
      }
    } catch (e) {
      console.error(`⚠️ Gagal memproses ${file}:`, e.message);
    }
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`🎉 SINKRONISASI SELESAI! Total ${totalUploaded} data skripsi di Supabase.`);
  console.log('════════════════════════════════════════════════════════════\n');
}

syncAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
