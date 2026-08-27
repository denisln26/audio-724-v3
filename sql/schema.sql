-- ============================================
-- Musik Pintar v2.0 - SCHEMA LENGKAP
-- AMAN dijalankan berulang kali (idempotent)
-- Tabel/lama TIDAK lagi di-drop otomatis.
-- ============================================
-- ⚠️ PERINGATAN: versi lama file ini berisi blok
-- "DROP TABLE ... users/tracks/playlists/..." yang
-- MENGHAPUS SEMUA DATA (termasuk login/profile user,
-- library musik, playlist, jadwal) bila dijalankan
-- ulang pada database yang sudah terisi.
-- Blok itu sengaja DIHAPUS dari file ini.

-- ============================================
-- TABEL USERS (linked ke auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    username TEXT UNIQUE,
    name TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    storage_limit INT DEFAULT 500,
    force_change_password BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABEL TRACKS
-- ============================================
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    src TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'offline',
    duration FLOAT DEFAULT 0,
    size TEXT DEFAULT '0 MB',
    volume INT DEFAULT 100,
    owner TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABEL PLAYLISTS
-- ============================================
CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    track_ids TEXT[] DEFAULT '{}',
    owner TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABEL UPACARA
-- ============================================
CREATE TABLE IF NOT EXISTS upacaras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    track_ids TEXT[] DEFAULT '{}',
    play_once BOOLEAN DEFAULT TRUE,
    owner TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABEL SCHEDULES
-- ============================================
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    days INT[] DEFAULT '{1,2,3,4,5}',
    loop BOOLEAN DEFAULT TRUE,
    source_type TEXT DEFAULT 'single',
    source_id TEXT,
    indonesia_raya BOOLEAN DEFAULT FALSE,
    volume INT DEFAULT 100,
    enabled BOOLEAN DEFAULT TRUE,
    owner TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tracks_owner ON tracks(owner);
CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists(owner);
CREATE INDEX IF NOT EXISTS idx_upacaras_owner ON upacaras(owner);
CREATE INDEX IF NOT EXISTS idx_schedules_owner ON schedules(owner);

-- ============================================
-- RLS & POLICIES
-- ============================================
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE upacaras ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracks_all" ON tracks;
DROP POLICY IF EXISTS "playlists_all" ON playlists;
DROP POLICY IF EXISTS "upacaras_all" ON upacaras;
DROP POLICY IF EXISTS "schedules_all" ON schedules;
DROP POLICY IF EXISTS "users_all" ON users;
CREATE POLICY "tracks_all" ON tracks FOR ALL USING (true);
CREATE POLICY "playlists_all" ON playlists FOR ALL USING (true);
CREATE POLICY "upacaras_all" ON upacaras FOR ALL USING (true);
CREATE POLICY "schedules_all" ON schedules FOR ALL USING (true);
CREATE POLICY "users_all" ON users FOR ALL USING (true);

-- ============================================
-- MIGRASI (WAJIB dijalankan untuk database yang sudah ada):
-- pastikan kolom settings ada di tabel users,
-- agar SEMUA PENGATURAN bisa tersimpan ke database.
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
-- Volume per-jadwal musik
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS volume INT DEFAULT 100;
-- ALTER TABLE tracks ALTER COLUMN id TYPE TEXT;
-- ALTER TABLE tracks ALTER COLUMN src SET DEFAULT '';
-- ALTER TABLE tracks ADD COLUMN IF NOT EXISTS volume INT DEFAULT 100;

-- ============================================
-- BROADCAST CONTROL SYSTEM
-- Jalankan seluruh file ini ATAU hanya blok ini
-- (aman dijalankan berulang - IF NOT EXISTS)
-- ============================================
CREATE TABLE IF NOT EXISTS broadcast_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_code VARCHAR(6),
    device_key TEXT,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    host_name TEXT DEFAULT '',
    status TEXT DEFAULT 'connecting',
    media_status TEXT DEFAULT 'stopped',
    media_type TEXT,
    media_url TEXT,
    volume INT DEFAULT 70,
    muted BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS broadcast_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID REFERENCES broadcast_hosts(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    media_type TEXT,
    media_url TEXT,
    volume INT,
    seek_to FLOAT,
    start_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS broadcast_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID,
    host_id UUID REFERENCES broadcast_hosts(id) ON DELETE CASCADE,
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ,
    status TEXT DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_bc_hosts_owner ON broadcast_hosts(owner_id);
CREATE INDEX IF NOT EXISTS idx_bc_cmds_host ON broadcast_commands(host_id);
CREATE INDEX IF NOT EXISTS idx_bc_sessions_host ON broadcast_sessions(host_id);
ALTER TABLE broadcast_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "broadcast_hosts_all" ON broadcast_hosts;
DROP POLICY IF EXISTS "broadcast_commands_all" ON broadcast_commands;
DROP POLICY IF EXISTS "broadcast_sessions_all" ON broadcast_sessions;
CREATE POLICY "broadcast_hosts_all" ON broadcast_hosts FOR ALL USING (true);
CREATE POLICY "broadcast_commands_all" ON broadcast_commands FOR ALL USING (true);
CREATE POLICY "broadcast_sessions_all" ON broadcast_sessions FOR ALL USING (true);
-- Identitas perangkat host (resume kode tanpa login)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_hosts_device ON broadcast_hosts(device_key) WHERE device_key IS NOT NULL;
-- Aktifkan Realtime untuk tabel broadcast (wajib agar command masuk tanpa refresh):
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='broadcast_hosts') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE broadcast_hosts;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='broadcast_commands') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE broadcast_commands;
    END IF;
END $$;
-- Untuk database lama yang sudah punya tabel broadcast (tambah kolom device_key):
ALTER TABLE broadcast_hosts ADD COLUMN IF NOT EXISTS device_key TEXT;
-- ============================================
