-- ============================================================
-- SQL SCHEMA UNTUK SUPABASE DATABASE
-- Portal Scraping BIMA, SADEWA & WAScheduller UPNYK
-- ============================================================

-- 1. TABEL USERS (Mahasiswa / Pengguna SSO UPN)
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nim VARCHAR(20) NOT NULL,
  nama VARCHAR(255),
  prefix_nim VARCHAR(10),
  prodi VARCHAR(100),
  angkatan VARCHAR(10),
  last_login TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index untuk pencarian cepat user berdasarkan NIM dan username
CREATE INDEX IF NOT EXISTS idx_users_nim ON public.users(nim);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_prefix ON public.users(prefix_nim);

-- 2. TABEL SKRIPSI (Data Judul Skripsi SADEWA)
CREATE TABLE IF NOT EXISTS public.skripsi (
  id BIGSERIAL PRIMARY KEY,
  nim VARCHAR(20) NOT NULL,
  nama VARCHAR(255) NOT NULL,
  judul_awal TEXT,
  judul_terbaru TEXT,
  dosen_pembimbing VARCHAR(255),
  status VARCHAR(100) DEFAULT 'Bimbingan TA',
  prefix_nim VARCHAR(10),
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_skripsi_nim_judul UNIQUE (nim, judul_awal)
);

-- Index untuk filter dan pencarian skripsi
CREATE INDEX IF NOT EXISTS idx_skripsi_nim ON public.skripsi(nim);
CREATE INDEX IF NOT EXISTS idx_skripsi_prefix ON public.skripsi(prefix_nim);
CREATE INDEX IF NOT EXISTS idx_skripsi_dospem ON public.skripsi(dosen_pembimbing);
CREATE INDEX IF NOT EXISTS idx_skripsi_status ON public.skripsi(status);

-- 3. TABEL DOSEN (Daftar Dosen Pengampu BIMA)
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

CREATE INDEX IF NOT EXISTS idx_dosen_nama ON public.dosen(nama);
CREATE INDEX IF NOT EXISTS idx_dosen_prodi ON public.dosen(prodi);

-- 4. TABEL JADWAL (Jadwal Mengajar Dosen BIMA)
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

CREATE INDEX IF NOT EXISTS idx_jadwal_dosen ON public.jadwal(dosen_nama);
CREATE INDEX IF NOT EXISTS idx_jadwal_semester ON public.jadwal(semester);
CREATE INDEX IF NOT EXISTS idx_jadwal_hari ON public.jadwal(hari);

-- 5. ENABLE ROW LEVEL SECURITY (RLS) & PUBLIC POLICIES
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skripsi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dosen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Allow anon read users" ON public.users;
CREATE POLICY "Allow anon read users" ON public.users FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow anon insert users" ON public.users;
CREATE POLICY "Allow anon insert users" ON public.users FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon update users" ON public.users;
CREATE POLICY "Allow anon update users" ON public.users FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow anon read skripsi" ON public.skripsi;
CREATE POLICY "Allow anon read skripsi" ON public.skripsi FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow anon insert skripsi" ON public.skripsi;
CREATE POLICY "Allow anon insert skripsi" ON public.skripsi FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon update skripsi" ON public.skripsi;
CREATE POLICY "Allow anon update skripsi" ON public.skripsi FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow anon read dosen" ON public.dosen;
CREATE POLICY "Allow anon read dosen" ON public.dosen FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow anon insert dosen" ON public.dosen;
CREATE POLICY "Allow anon insert dosen" ON public.dosen FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon update dosen" ON public.dosen;
CREATE POLICY "Allow anon update dosen" ON public.dosen FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow anon read jadwal" ON public.jadwal;
CREATE POLICY "Allow anon read jadwal" ON public.jadwal FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow anon insert jadwal" ON public.jadwal;
CREATE POLICY "Allow anon insert jadwal" ON public.jadwal FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow anon update jadwal" ON public.jadwal;
CREATE POLICY "Allow anon update jadwal" ON public.jadwal FOR UPDATE USING (true);
