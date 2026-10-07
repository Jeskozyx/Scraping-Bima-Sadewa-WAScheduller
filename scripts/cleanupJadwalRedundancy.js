/**
 * Script Pembersih & Normalisasi Data Redundan pada Tabel Jadwal Supabase
 *
 * Mengatasi:
 * 1. Multi-dosen ter-concatenated (misal: "Juwairiah S.Si., M.T.Zaidir, S.T., M.Cs")
 * 2. Posisi gelar terbalik (misal: "Rizki Kurniati Dr. S.Pd., M.Or." -> "Dr. Rizki Kurniati, S.Pd., M.Or.")
 * 3. Spasi ganda & format gelar tidak baku
 * 4. Memastikan relasi tabel jadwal 100% konsisten dengan tabel dosen
 */

import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient.js';

export function extractCanonicalLecturers(text, masterLecturers = []) {
  if (!text) return [];
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const found = [];
  const degreeRegex = /\b(dr|dra|drs|ir|prof|se|mm|msi|s\.e|m\.si|sh|mh|s\.kom|m\.kom|s\.pd|m\.pd|s\.s|m\.hum|ph\.d|phd|m\.sc|m\.acc|ak|akt|ca|s\.t|m\.t|s\.si|m\.or|s\.st|m\.eng|m\.ict|mce|mcf|cipm|lic\.th|m\.psi)\b/gi;

  if (Array.isArray(masterLecturers) && masterLecturers.length > 0) {
    for (const lec of masterLecturers) {
      const coreWords = lec
        .replace(degreeRegex, '')
        .replace(/[^a-zA-Z\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 3);

      if (coreWords.length === 0) continue;

      const textNorm = cleanText.toLowerCase().replace(/[^a-z\s]/g, ' ');
      const matches = coreWords.every((w) => {
        const regex = new RegExp('\\b' + w.toLowerCase() + '\\b', 'i');
        return regex.test(textNorm) || textNorm.includes(w.toLowerCase());
      });

      if (matches) found.push(lec);
    }
  }

  if (found.length > 0) {
    return Array.from(new Set(found));
  }

  return [cleanText];
}

async function runCleanup(isDryRun = false) {
  console.log('===========================================================');
  console.log(`   CLEANUP & NORMALISASI JADWAL DOSEN SUPABASE (${isDryRun ? 'DRY-RUN' : 'LIVE'})`);
  console.log('===========================================================');

  if (!isSupabaseConfigured()) {
    console.error('❌ Supabase belum terkonfigurasi.');
    process.exit(1);
  }

  const supabase = getSupabaseClient();

  // 1. Ambil master dosen
  const { data: dosenList, error: errDosen } = await supabase.from('dosen').select('nama');
  if (errDosen || !dosenList) {
    console.error('❌ Gagal mengambil master dosen:', errDosen?.message);
    process.exit(1);
  }
  const masterLecturers = dosenList.map((d) => d.nama);
  console.log(`📋 Membaca ${masterLecturers.length} nama dosen resmi dari tabel dosen.`);

  // 2. Ambil seluruh data jadwal
  const { data: allJadwal, error: errJadwal } = await supabase.from('jadwal').select('*');
  if (errJadwal || !allJadwal) {
    console.error('❌ Gagal mengambil tabel jadwal:', errJadwal?.message);
    process.exit(1);
  }
  console.log(`📊 Total baris di tabel jadwal saat ini: ${allJadwal.length} baris.`);

  // 3. Analisis dan pembersihan
  const recordsToInsert = new Map();
  const idsToDelete = [];
  let multiSplitCount = 0;
  let normalizedCount = 0;

  for (const j of allJadwal) {
    const canonicalLecs = extractCanonicalLecturers(j.dosen_nama, masterLecturers);

    // Tandai ID lama untuk dihapus jika nama dosennya tidak sama persis dengan canonical (misal gabungan / spasi ganda)
    const isSingleExact = canonicalLecs.length === 1 && canonicalLecs[0] === j.dosen_nama;
    if (!isSingleExact) {
      idsToDelete.push(j.id);
      if (canonicalLecs.length > 1) {
        multiSplitCount++;
      } else {
        normalizedCount++;
      }
    }

    for (const cLec of canonicalLecs) {
      const uniqueKey = [cLec, j.semester, j.hari, j.jam_mulai, j.matkul, j.kelas].join('|');
      recordsToInsert.set(uniqueKey, {
        dosen_nama: cLec,
        semester: j.semester || 'Gasal 2026/2027',
        hari: j.hari,
        jam_mulai: j.jam_mulai,
        jam_selesai: j.jam_selesai,
        matkul: j.matkul,
        kelas: j.kelas,
        ruang: j.ruang,
        sks: j.sks,
        jml_mhs: j.jml_mhs,
        is_praktikum: j.is_praktikum,
        scraped_at: j.scraped_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }

  console.log(`\n🔍 Hasil Analisis:`);
  console.log(`  - Baris gabungan (team teaching) yang dipecah: ${multiSplitCount} baris`);
  console.log(`  - Baris dengan nama tidak baku yang dinormalisasi: ${normalizedCount} baris`);
  console.log(`  - Total baris kotor yang perlu dihapus/digantikan: ${idsToDelete.length} baris`);
  console.log(`  - Total baris bersih final yang akan tersimpan: ${recordsToInsert.size} baris`);

  if (isDryRun) {
    console.log('\n[Dry Run Selesai] Tidak ada perubahan data yang disimpan ke database.');
    return;
  }

  // 4. Eksekusi Hapus Baris Kotor
  if (idsToDelete.length > 0) {
    console.log(`\n🧹 Menghapus ${idsToDelete.length} baris kotor/tergabung dari tabel jadwal...`);
    for (let i = 0; i < idsToDelete.length; i += 50) {
      const chunk = idsToDelete.slice(i, i + 50);
      const { error: delErr } = await supabase.from('jadwal').delete().in('id', chunk);
      if (delErr) {
        console.warn(`⚠️ Warning saat menghapus chunk baris kotor:`, delErr.message);
      }
    }
    console.log('✅ Selesai menghapus baris kotor.');
  }

  // 5. Eksekusi Upsert Baris Bersih
  const cleanRecords = Array.from(recordsToInsert.values());
  console.log(`\n💾 Menyimpan ${cleanRecords.length} baris bersih ke tabel jadwal...`);
  for (let i = 0; i < cleanRecords.length; i += 50) {
    const chunk = cleanRecords.slice(i, i + 50);
    const { error: upsertErr } = await supabase
      .from('jadwal')
      .upsert(chunk, { onConflict: 'dosen_nama,semester,hari,jam_mulai,matkul,kelas' });
    if (upsertErr) {
      console.error(`❌ Gagal menyimpan chunk baris bersih:`, upsertErr.message);
    }
  }

  console.log('🎉 PEMBERSIHAN TABEL JADWAL BERHASIL DILAKUKAN!');
}

if (process.argv[1] && process.argv[1].endsWith('cleanupJadwalRedundancy.js')) {
  const isDryRun = process.argv.includes('--dry-run');
  runCleanup(isDryRun)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
