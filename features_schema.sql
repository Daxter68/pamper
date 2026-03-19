-- ═══════════════════════════════════════════════════════════════
--  PAMPER – Feature Expansion Schema
--  Run this in Supabase SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Teacher role support (add to users CHECK constraint) ───
-- Note: If you get a constraint error, run the ALTER separately
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','security','student','teacher'));

-- ─── 2. Subjects / Classes ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS subjects (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(120) NOT NULL,
  code         VARCHAR(20) UNIQUE NOT NULL,
  grade        VARCHAR(30),
  teacher_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. Class Periods ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS periods (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id    UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name          VARCHAR(60) NOT NULL,       -- e.g. "Period 1", "Monday Morning"
  day_of_week   INTEGER,                   -- 0=Sun,1=Mon...6=Sat, NULL=any day
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  late_cutoff   TIME,                      -- scans after this = "Late"
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. Student-Subject Enrolments ─────────────────────────────
CREATE TABLE IF NOT EXISTS enrolments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  enrolled_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, subject_id)
);

-- ─── 5. Period Attendance Logs ─────────────────────────────────
CREATE TABLE IF NOT EXISTS period_attendance (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_id    UUID NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked_by    UUID REFERENCES users(id),  -- teacher or security
  status       VARCHAR(20) NOT NULL DEFAULT 'present'
               CHECK (status IN ('present','absent','late','excused')),
  notes        TEXT,
  marked_at    TIMESTAMPTZ DEFAULT NOW(),
  date         DATE DEFAULT CURRENT_DATE,
  UNIQUE(period_id, student_id, date)
);

-- ─── 6. Face Descriptors (for face recognition) ────────────────
CREATE TABLE IF NOT EXISTS face_descriptors (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  descriptor   TEXT NOT NULL,              -- JSON array of 128 floats
  photo_url    TEXT,                       -- optional stored photo
  enrolled_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 7. Academic Calendar ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS academic_terms (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(100) NOT NULL,      -- e.g. "Term 1 2025-2026"
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  is_current   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  term_id      UUID REFERENCES academic_terms(id) ON DELETE CASCADE,
  event_date   DATE NOT NULL,
  event_type   VARCHAR(30) NOT NULL
               CHECK (event_type IN ('holiday','exam','event','no_school')),
  name         VARCHAR(120) NOT NULL,
  affects_attendance BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 8. Email Notification Log ─────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient    VARCHAR(180) NOT NULL,
  subject      VARCHAR(255) NOT NULL,
  type         VARCHAR(50),               -- 'digest','alert','late'
  status       VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent','failed','pending')),
  sent_at      TIMESTAMPTZ DEFAULT NOW(),
  error        TEXT
);

-- ─── 9. Add late_cutoff_time to campus_settings ────────────────
INSERT INTO campus_settings (key, value, description) VALUES
  ('late_cutoff_time',    '08:00', 'Scans after this time are marked as Late (HH:MM)'),
  ('digest_email',        '',      'Email address to receive daily attendance digest'),
  ('digest_enabled',      'false', 'Whether to send daily email digests'),
  ('smtp_host',           '',      'SMTP server hostname'),
  ('smtp_port',           '587',   'SMTP server port'),
  ('smtp_user',           '',      'SMTP username/email'),
  ('smtp_pass',           '',      'SMTP password'),
  ('smtp_from',           'PAMPER Attendance <noreply@pamper.edu>', 'From name/email'),
  ('face_recognition',    'false', 'Enable face recognition as second factor'),
  ('face_threshold',      '0.5',   'Face match confidence threshold (0.3=strict, 0.6=lenient)')
ON CONFLICT (key) DO NOTHING;

-- ─── 10. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_period_att_date    ON period_attendance(date);
CREATE INDEX IF NOT EXISTS idx_period_att_student ON period_attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_period_att_period  ON period_attendance(period_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_student ON enrolments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_subject ON enrolments(subject_id);
CREATE INDEX IF NOT EXISTS idx_calendar_date      ON calendar_events(event_date);

-- ─── 11. RLS ───────────────────────────────────────────────────
ALTER TABLE subjects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE periods            ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrolments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_attendance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_descriptors   ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_terms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log   ENABLE ROW LEVEL SECURITY;

-- ─── 12. Sample term + default subjects ────────────────────────
INSERT INTO academic_terms (name, start_date, end_date, is_current)
VALUES ('Term 1 2025-2026', '2025-09-01', '2025-12-19', true)
ON CONFLICT DO NOTHING;
