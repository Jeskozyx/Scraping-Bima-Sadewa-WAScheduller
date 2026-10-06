import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createTables() {
  const connStr = 'postgresql://postgres.rswkkogynttthwlioxfy:QZg%25Yi27B%3Fkc.xv@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
  const sql = postgres(connStr, { ssl: 'require' });

  console.log('⚡ Menghubungkan ke Supabase Cloud PostgreSQL...');

  try {
    // 1. Buat Tabel DOSEN
    console.log('📌 Membuat tabel public.dosen...');
    await sql`
      CREATE TABLE IF NOT EXISTS public.dosen (
        id BIGSERIAL PRIMARY KEY,
        nama VARCHAR(255) UNIQUE NOT NULL,
        prodi VARCHAR(100),
        fakultas VARCHAR(100),
        total_matkul INT DEFAULT 0,
        scraped_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_dosen_nama ON public.dosen(nama);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_dosen_prodi ON public.dosen(prodi);`;

    // 2. Buat Tabel JADWAL
    console.log('📌 Membuat tabel public.jadwal...');
    await sql`
      CREATE TABLE IF NOT EXISTS public.jadwal (
        id BIGSERIAL PRIMARY KEY,
        dosen_nama VARCHAR(255) NOT NULL,
        semester VARCHAR(100) DEFAULT 'Gasal 2026/2027',
        hari VARCHAR(20) NOT NULL,
        jam_mulai VARCHAR(10) NOT NULL,
        jam_selesai VARCHAR(10) NOT NULL,
        matkul VARCHAR(255) NOT NULL,
        kelas VARCHAR(50),
        ruang VARCHAR(100),
        sks VARCHAR(10),
        jml_mhs VARCHAR(10),
        is_praktikum BOOLEAN DEFAULT FALSE,
        scraped_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT uq_jadwal_unique UNIQUE (dosen_nama, semester, hari, jam_mulai, matkul, kelas)
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_jadwal_dosen ON public.jadwal(dosen_nama);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_jadwal_semester ON public.jadwal(semester);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_jadwal_hari ON public.jadwal(hari);`;

    // 3. RLS & Policy
    console.log('🔒 Mengatur Row Level Security & Policies...');
    await sql`ALTER TABLE public.dosen ENABLE ROW LEVEL SECURITY;`;
    await sql`ALTER TABLE public.jadwal ENABLE ROW LEVEL SECURITY;`;

    await sql`DROP POLICY IF EXISTS "Allow anon read dosen" ON public.dosen;`;
    await sql`CREATE POLICY "Allow anon read dosen" ON public.dosen FOR SELECT USING (true);`;
    await sql`DROP POLICY IF EXISTS "Allow anon insert dosen" ON public.dosen;`;
    await sql`CREATE POLICY "Allow anon insert dosen" ON public.dosen FOR INSERT WITH CHECK (true);`;
    await sql`DROP POLICY IF EXISTS "Allow anon update dosen" ON public.dosen;`;
    await sql`CREATE POLICY "Allow anon update dosen" ON public.dosen FOR UPDATE USING (true);`;

    await sql`DROP POLICY IF EXISTS "Allow anon read jadwal" ON public.jadwal;`;
    await sql`CREATE POLICY "Allow anon read jadwal" ON public.jadwal FOR SELECT USING (true);`;
    await sql`DROP POLICY IF EXISTS "Allow anon insert jadwal" ON public.jadwal;`;
    await sql`CREATE POLICY "Allow anon insert jadwal" ON public.jadwal FOR INSERT WITH CHECK (true);`;
    await sql`DROP POLICY IF EXISTS "Allow anon update jadwal" ON public.jadwal;`;
    await sql`CREATE POLICY "Allow anon update jadwal" ON public.jadwal FOR UPDATE USING (true);`;

    // 4. Migrasi data awal dari data/lecturers.json jika ada
    const lecturersFile = path.resolve(__dirname, '../data/lecturers.json');
    if (fs.existsSync(lecturersFile)) {
      const lecturers = JSON.parse(fs.readFileSync(lecturersFile, 'utf-8'));
      if (Array.isArray(lecturers) && lecturers.length > 0) {
        console.log(`📦 Memigrasikan ${lecturers.length} dosen awal dari data/lecturers.json...`);
        for (const name of lecturers) {
          if (!name || typeof name !== 'string') continue;
          await sql`
            INSERT INTO public.dosen (nama, created_at, updated_at)
            VALUES (${name.trim()}, NOW(), NOW())
            ON CONFLICT (nama) DO UPDATE SET updated_at = NOW()
          `;
        }
        console.log(`✅ Sukses memigrasikan dosen ke tabel public.dosen!`);
      }
    }

    console.log('🎉 SEMUA TABEL DOSEN & JADWAL BERHASIL DIBUAT DI SUPABASE!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Gagal membuat tabel:', err.message);
    process.exit(1);
  }
}

createTables();
