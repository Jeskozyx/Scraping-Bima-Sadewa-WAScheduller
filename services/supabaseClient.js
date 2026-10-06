/**
 * Supabase Client & Helper Services
 * 
 * Mengelola koneksi ke Supabase Database, operasi tabel `users` dan `skripsi`.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Supabase] ✅ Klien Supabase berhasil diinisialisasi ke:', SUPABASE_URL);
  } catch (err) {
    console.warn('[Supabase] Gagal menginisialisasi client:', err.message);
  }
} else {
  console.log('[Supabase] ℹ️ SUPABASE_URL belum diisi di .env. Operasi database Supabase akan dilewati / fallback ke lokal.');
}

/**
 * Cek apakah Supabase aktif & siap digunakan
 */
export function isSupabaseConfigured() {
  return !!(supabase && SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Dapatkan instance klien Supabase langsung
 */
export function getSupabaseClient() {
  return supabase;
}

// ============================================================
// OPERASI TABEL USERS (username, password, nim, nama, dll.)
// ============================================================

/**
 * Simpan atau perbarui data user ke tabel `users`
 * @param {Object} userData
 */
export async function upsertUserToSupabase(userData) {
  if (!isSupabaseConfigured()) return null;

  try {
    const payload = {
      username: userData.username || userData.npm || userData.nim,
      password: userData.password || '',
      nim: userData.npm || userData.nim,
      nama: userData.nama || '',
      prefix_nim: userData.prefixNim || (userData.npm ? String(userData.npm).slice(0, 5) : ''),
      prodi: userData.prodi || '',
      angkatan: userData.angkatan || '',
      last_login: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'username' })
      .select();

    if (error) {
      console.warn('[Supabase] Gagal upsert user:', error.message);
      return null;
    }

    console.log(`[Supabase] ✅ User "${payload.nama}" (${payload.nim}) berhasil disimpan ke tabel users!`);
    return data;
  } catch (err) {
    console.warn('[Supabase] Exception saat upsert user:', err.message);
    return null;
  }
}

/**
 * Ambil data user dari Supabase berdasarkan username / NIM
 * @param {string} usernameOrNim 
 */
export async function getUserFromSupabase(usernameOrNim) {
  if (!isSupabaseConfigured()) return null;

  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .or(`username.eq.${usernameOrNim},nim.eq.${usernameOrNim}`)
      .limit(1)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// ============================================================
// OPERASI TABEL SKRIPSI
// ============================================================

/**
 * Simpan / perbarui batch judul skripsi ke tabel `skripsi`
 * @param {Array<Object>} skripsiList 
 * @param {string} filterNim 
 */
export async function upsertSkripsiBatchToSupabase(skripsiList, filterNim = '12423') {
  if (!isSupabaseConfigured() || !Array.isArray(skripsiList) || skripsiList.length === 0) {
    return null;
  }

  try {
    const records = skripsiList.map((item) => {
      const nim = item.nim || '';
      const prefix = item.prefixNim || (nim ? nim.slice(0, 5) : filterNim);
      return {
        nim,
        nama: item.nama || '',
        judul_awal: item.judulAwal || '',
        judul_terbaru: item.judulTerbaru || null,
        dosen_pembimbing: item.dosenPembimbing || '',
        status: item.status || 'Bimbingan TA',
        prefix_nim: prefix,
        scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    // Supabase upsert dengan onConflict: 'nim,judul_awal'
    const { data, error } = await supabase
      .from('skripsi')
      .upsert(records, { onConflict: 'nim,judul_awal' })
      .select('id');

    if (error) {
      console.warn('[Supabase] Gagal menyimpan batch skripsi:', error.message);
      return null;
    }

    console.log(`[Supabase] ✅ ${records.length} judul skripsi berhasil disinkronkan ke tabel skripsi!`);
    return data;
  } catch (err) {
    console.warn('[Supabase] Exception saat menyimpan skripsi ke Supabase:', err.message);
    return null;
  }
}

/**
 * Ambil data skripsi dari Supabase berdasarkan 5-digit prefix NIM
 * @param {string} filterNim 
 */
export async function getSkripsiFromSupabase(filterNim = '12423') {
  if (!isSupabaseConfigured()) return null;

  try {
    let query = supabase
      .from('skripsi')
      .select('*')
      .order('id', { ascending: true });

    if (filterNim) {
      query = query.like('nim', `${filterNim}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[Supabase] Gagal membaca skripsi:', error.message);
      return null;
    }

    // Mapping kembali ke format frontend camelCase
    return (data || []).map((row) => ({
      nim: row.nim,
      nama: row.nama,
      judulAwal: row.judul_awal,
      judulTerbaru: row.judul_terbaru,
      dosenPembimbing: row.dosen_pembimbing,
      status: row.status,
      scrapedAt: row.scraped_at
    }));
  } catch (err) {
    console.warn('[Supabase] Exception saat mengambil data skripsi:', err.message);
    return null;
  }
}

// ============================================================
// OPERASI TABEL DOSEN (Nama, Prodi, dll.)
// ============================================================

/**
 * Simpan / perbarui daftar dosen ke tabel `dosen`
 * @param {Array<string|Object>} dosenList - Array nama dosen atau objek dosen
 * @param {string} prodi - Opsional: nama prodi mahasiswa
 */
export async function upsertDosenBatchToSupabase(dosenList, prodi = '', fakultas = '') {
  if (!isSupabaseConfigured() || !Array.isArray(dosenList) || dosenList.length === 0) {
    return null;
  }

  try {
    const uniqueMap = new Map();
    for (const item of dosenList) {
      const nama = typeof item === 'string' ? item.trim() : (item.nama || '').trim();
      if (!nama || nama.length < 2) continue;
      const key = nama.toLowerCase();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          nama,
          prodi: (typeof item === 'object' && item.prodi) ? item.prodi : (prodi || null),
          fakultas: (typeof item === 'object' && item.fakultas) ? item.fakultas : (fakultas || null),
          scraped_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    }
    const records = Array.from(uniqueMap.values());

    const { data, error } = await supabase
      .from('dosen')
      .upsert(records, { onConflict: 'nama' })
      .select('id, nama');

    if (error) {
      console.warn('[Supabase] Gagal upsert daftar dosen:', error.message);
      return null;
    }

    console.log(`[Supabase] ✅ ${records.length} dosen berhasil disinkronkan ke tabel dosen!`);

    // Hapus data dosen lama yang redundan / tidak ada di master list baru
    try {
      const validNames = new Set(records.map((r) => r.nama.toLowerCase().trim()));
      let cleanupQuery = supabase.from('dosen').select('id, nama');
      if (prodi) cleanupQuery = cleanupQuery.ilike('prodi', `%${prodi}%`);
      else if (fakultas) cleanupQuery = cleanupQuery.ilike('fakultas', `%${fakultas}%`);

      const { data: existingRows } = await cleanupQuery;
      if (existingRows && existingRows.length > 0) {
        const obsoleteIds = existingRows
          .filter((row) => !validNames.has((row.nama || '').toLowerCase().trim()))
          .map((row) => row.id);

        if (obsoleteIds.length > 0) {
          console.log(`[Supabase] 🧹 Menghapus ${obsoleteIds.length} baris dosen redundan/usang...`);
          for (let i = 0; i < obsoleteIds.length; i += 50) {
            const chunk = obsoleteIds.slice(i, i + 50);
            await supabase.from('dosen').delete().in('id', chunk);
          }
        }
      }
    } catch (cleanErr) {
      console.warn('[Supabase] Cleanup redundant dosen warning:', cleanErr.message);
    }

    return data;
  } catch (err) {
    console.warn('[Supabase] Exception saat menyimpan dosen:', err.message);
    return null;
  }
}

/**
 * Ambil daftar dosen dari tabel `dosen`
 * @param {string} search - Opsional filter kata kunci pencarian
 * @param {string} prodi - Opsional filter program studi
 */
export async function getDosenFromSupabase(search = '', prodi = '') {
  if (!isSupabaseConfigured()) return [];

  try {
    let query = supabase
      .from('dosen')
      .select('*')
      .order('nama', { ascending: true });

    if (search && search.trim()) {
      query = query.ilike('nama', `%${search.trim()}%`);
    }

    if (prodi && prodi.trim()) {
      query = query.ilike('prodi', `%${prodi.trim()}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[Supabase] Gagal mengambil daftar dosen:', error.message);
      return [];
    }

    // Jika filter prodi tidak menghasilkan data, lakukan fallback agar daftar dosen tidak kosong (0)
    if ((!data || data.length === 0) && prodi) {
      let fallbackQuery = supabase
        .from('dosen')
        .select('*')
        .order('nama', { ascending: true });

      if (search && search.trim()) {
        fallbackQuery = fallbackQuery.ilike('nama', `%${search.trim()}%`);
      }

      const fallbackRes = await fallbackQuery;
      if (fallbackRes.data && fallbackRes.data.length > 0) {
        return fallbackRes.data;
      }
    }

    return data || [];
  } catch (err) {
    console.warn('[Supabase] Exception saat mengambil dosen:', err.message);
    return [];
  }
}

// ============================================================
// OPERASI TABEL JADWAL (Jadwal Mengajar Dosen)
// ============================================================

/**
 * Simpan baris-baris jadwal mengajar dosen ke tabel `jadwal`
 * @param {string} dosenNama - Nama dosen
 * @param {string} semester - Semester target
 * @param {Array<Object>} rawRows - Array baris mentah dari scraper tabel BIMA
 */
export async function upsertJadwalBatchToSupabase(dosenNama, semester = 'Gasal 2026/2027', rawRows = []) {
  if (!isSupabaseConfigured() || !Array.isArray(rawRows) || rawRows.length === 0) {
    return null;
  }

  try {
    const dayNames = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const records = [];

    for (const row of rawRows) {
      const match = (row.jadwal || '').match(/([A-Za-z]+)\s+(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/);
      const hariStr = match ? match[1] : (row.hari || '');
      const jamMulai = match ? match[2].replace('.', ':') : (row.jamMulai || '00:00');
      const jamSelesai = match ? match[3].replace('.', ':') : (row.jamSelesai || '00:00');
      const isPraktikum = /praktikum/i.test(row.matkul || '');

      const standardDay = dayNames.find((d) => d.toLowerCase() === hariStr.toLowerCase()) || hariStr;

      records.push({
        dosen_nama: dosenNama,
        semester: semester || 'Gasal 2026/2027',
        hari: standardDay || 'Senin',
        jam_mulai: jamMulai,
        jam_selesai: jamSelesai,
        matkul: row.matkul || '-',
        kelas: row.kelas || '-',
        ruang: row.ruang || '-',
        sks: String(row.sks || ''),
        jml_mhs: String(row.jmlMhs || row.jml_mhs || ''),
        is_praktikum: isPraktikum,
        scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    if (records.length === 0) return null;

    const { data, error } = await supabase
      .from('jadwal')
      .upsert(records, { onConflict: 'dosen_nama,semester,hari,jam_mulai,matkul,kelas' })
      .select('id');

    if (error) {
      console.warn('[Supabase] Gagal menyimpan jadwal dosen:', error.message);
      return null;
    }

    console.log(`[Supabase] ✅ ${records.length} baris jadwal untuk "${dosenNama}" berhasil disimpan ke tabel jadwal!`);
    return data;
  } catch (err) {
    console.warn('[Supabase] Exception saat menyimpan jadwal dosen:', err.message);
    return null;
  }
}

/**
 * Ambil jadwal mengajar dosen dari tabel `jadwal`
 * @param {string} dosenNama 
 * @param {string} semester 
 */
export async function getJadwalFromSupabase(dosenNama, semester = 'Gasal 2026/2027') {
  if (!isSupabaseConfigured()) return null;

  try {
    const cleanSearch = dosenNama.trim();
    let query = supabase
      .from('jadwal')
      .select('*')
      .order('hari', { ascending: true })
      .order('jam_mulai', { ascending: true });

    if (semester) {
      query = query.ilike('semester', `%${semester}%`);
    }

    let { data, error } = await query.ilike('dosen_nama', `%${cleanSearch}%`);

    // Jika tidak ditemukan dengan exact ilike, cari dengan kata kunci nama inti (tanpa gelar)
    if ((!data || data.length === 0) && cleanSearch) {
      const coreWords = cleanSearch
        .replace(/\b(dr|dra|drs|ir|prof|se|mm|msi|s\.e|m\.si|sh|mh|s\.kom|m\.kom|s\.pd|m\.pd|s\.s|m\.hum|ph\.d|m\.sc|m\.acc|ak|akt|ca)\b/gi, '')
        .replace(/[^a-zA-Z\s]/g, '')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3);

      if (coreWords.length > 0) {
        let coreQuery = supabase
          .from('jadwal')
          .select('*')
          .order('hari', { ascending: true })
          .order('jam_mulai', { ascending: true });

        if (semester) {
          coreQuery = coreQuery.ilike('semester', `%${semester}%`);
        }

        for (const w of coreWords) {
          coreQuery = coreQuery.ilike('dosen_nama', `%${w}%`);
        }

        const coreRes = await coreQuery;
        if (coreRes.data && coreRes.data.length > 0) {
          data = coreRes.data;
        }
      }
    }

    if (error) {
      console.warn('[Supabase] Gagal membaca jadwal dosen:', error.message);
      return null;
    }

    return (data || []).map((r) => ({
      id: r.id,
      dosenNama: r.dosen_nama,
      semester: r.semester,
      hari: r.hari,
      jamMulai: r.jam_mulai,
      jamSelesai: r.jam_selesai,
      matkul: r.matkul,
      kelas: r.kelas,
      ruang: r.ruang,
      sks: r.sks,
      jmlMhs: r.jml_mhs,
      isPraktikum: r.is_praktikum,
      scrapedAt: r.scraped_at
    }));
  } catch (err) {
    console.warn('[Supabase] Exception saat mengambil jadwal dosen:', err.message);
    return null;
  }
}
