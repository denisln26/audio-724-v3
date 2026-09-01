-- ============================================
-- Site Config — satu lokasi untuk semua device
-- Jalankan di Supabase SQL Editor (sekali saja)
-- ============================================
CREATE TABLE IF NOT EXISTS site_config (
    id INT PRIMARY KEY,
    lat DOUBLE PRECISION DEFAULT -6.2088,
    lng DOUBLE PRECISION DEFAULT 106.8456,
    time_offset INT DEFAULT 0,
    prayer_offsets JSONB DEFAULT '{"Imsak":0,"Subuh":0,"Terbit":0,"Dzuhur":0,"Ashar":0,"Maghrib":0,"Isya":0}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Satu baris global id=1 (Depok default jika belum ada)
INSERT INTO site_config (id, lat, lng) VALUES (1, -6.2088, 106.8456)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "site_config_all" ON site_config;
CREATE POLICY "site_config_all" ON site_config FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_site_config_id ON site_config(id);
