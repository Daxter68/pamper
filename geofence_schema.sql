-- ═══════════════════════════════════════════════════════════
--  PAMPER – Campus Geofence Settings Table
--  Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS campus_settings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key          VARCHAR(100) UNIQUE NOT NULL,
  value        TEXT NOT NULL,
  description  TEXT,
  updated_by   UUID REFERENCES users(id),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE campus_settings ENABLE ROW LEVEL SECURITY;

-- Insert default campus geofence settings
-- Default: Moneague College, Jamaica (adjust lat/lng to exact location)
INSERT INTO campus_settings (key, value, description) VALUES
  ('geofence_enabled',   'true',                    'Whether geofencing is active for student self check-in'),
  ('geofence_lat',       '18.2706',                 'Campus center latitude (Moneague College)'),
  ('geofence_lng',       '-77.1270',                'Campus center longitude (Moneague College)'),
  ('geofence_radius',    '300',                     'Allowed radius in metres from campus center'),
  ('campus_name',        'Moneague College',         'Display name of the campus'),
  ('self_checkin',       'true',                    'Whether students can check themselves in/out'),
  ('checkin_start',      '07:00',                   'Earliest time students can check in (24hr)'),
  ('checkin_end',        '18:00',                   'Latest time students can check out (24hr)')
ON CONFLICT (key) DO NOTHING;
