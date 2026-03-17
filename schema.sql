-- ═══════════════════════════════════════════════════════════
--  PAMPER – QR-Based Campus Attendance & Security System
--  Supabase SQL Schema
--  Run this in your Supabase project → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. Users (Admins, Security, Students) ───────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    VARCHAR(20) UNIQUE,           -- e.g. ST001 (null for staff)
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(180) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','security','student')),
  grade         VARCHAR(30),                  -- students only
  qr_code       VARCHAR(36) UNIQUE DEFAULT uuid_generate_v4()::text,
  qr_status     VARCHAR(20) DEFAULT 'active' CHECK (qr_status IN ('active','pending','revoked')),
  is_blacklisted BOOLEAN DEFAULT FALSE,
  blacklist_reason TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. Attendance Logs ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_by    UUID REFERENCES users(id),    -- security personnel who scanned
  scan_type     VARCHAR(10) NOT NULL CHECK (scan_type IN ('in','out')),
  scan_time     TIMESTAMPTZ DEFAULT NOW(),
  date          DATE DEFAULT CURRENT_DATE,
  location      VARCHAR(100) DEFAULT 'Main Gate',
  notes         TEXT
);

-- ─── 3. QR Codes (audit trail) ───────────────────────────────
CREATE TABLE IF NOT EXISTS qr_codes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code          VARCHAR(36) UNIQUE NOT NULL DEFAULT uuid_generate_v4()::text,
  status        VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  generated_at  TIMESTAMPTZ DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES users(id)
);

-- ─── 4. Security Alerts ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_alerts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_type    VARCHAR(40) NOT NULL,         -- 'blacklist_scan','unknown_qr','duplicate_scan'
  user_id       UUID REFERENCES users(id),
  triggered_by  UUID REFERENCES users(id),   -- security who triggered
  description   TEXT,
  severity      VARCHAR(10) DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  resolved      BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5. Daily Summary (materialized view helper) ─────────────
CREATE TABLE IF NOT EXISTS daily_summary (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  summary_date  DATE UNIQUE NOT NULL,
  total_students INTEGER DEFAULT 0,
  total_present  INTEGER DEFAULT 0,
  total_absent   INTEGER DEFAULT 0,
  total_scans    INTEGER DEFAULT 0,
  generated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
--  INDEXES
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_attendance_student  ON attendance_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date     ON attendance_logs(date);
CREATE INDEX IF NOT EXISTS idx_attendance_scantime ON attendance_logs(scan_time);
CREATE INDEX IF NOT EXISTS idx_users_role          ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_qr            ON users(qr_code);
CREATE INDEX IF NOT EXISTS idx_alerts_created      ON security_alerts(created_at);

-- ═══════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summary    ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (your Node.js server uses service key)
-- For the anon key (client-side), deny everything by default

-- ═══════════════════════════════════════════════════════════
--  SEED DATA – Default Admin Account
--  Password: Admin@123  (bcrypt hash – change after first login)
-- ═══════════════════════════════════════════════════════════
INSERT INTO users (full_name, email, password_hash, role, student_id)
VALUES (
  'System Administrator',
  'admin@pamper.edu',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsG.6PKZ9kZ5ZG5v.b7MYeWXiP.2',
  'admin',
  NULL
) ON CONFLICT (email) DO NOTHING;

-- Seed sample security user
-- Password: Security@123
INSERT INTO users (full_name, email, password_hash, role, student_id)
VALUES (
  'Gate Security',
  'security@pamper.edu',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsG.6PKZ9kZ5ZG5v.b7MYeWXiP.2',
  'security',
  NULL
) ON CONFLICT (email) DO NOTHING;

-- Seed sample students
INSERT INTO users (full_name, email, password_hash, role, student_id, grade, qr_status) VALUES
  ('John Brown',    'john.brown@student.pamper.edu',    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsG.6PKZ9kZ5ZG5v.b7MYeWXiP.2', 'student', 'ST001', 'Grade 5', 'active'),
  ('Maria Davis',   'maria.davis@student.pamper.edu',   '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsG.6PKZ9kZ5ZG5v.b7MYeWXiP.2', 'student', 'ST002', 'Grade 6', 'active'),
  ('Kevin Smith',   'kevin.smith@student.pamper.edu',   '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsG.6PKZ9kZ5ZG5v.b7MYeWXiP.2', 'student', 'ST003', 'Grade 5', 'pending'),
  ('Alicia Brown',  'alicia.brown@student.pamper.edu',  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsG.6PKZ9kZ5ZG5v.b7MYeWXiP.2', 'student', 'ST004', 'Grade 7', 'active'),
  ('Michael Lee',   'michael.lee@student.pamper.edu',   '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsG.6PKZ9kZ5ZG5v.b7MYeWXiP.2', 'student', 'ST005', 'Grade 6', 'active')
ON CONFLICT (email) DO NOTHING;
