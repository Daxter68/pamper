require('dotenv').config();

const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');

// ── Route imports ─────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes     = require('./routes/reports');
const campusRoutes     = require('./routes/campus');
const { requireAuth, requireRole } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/campus',     campusRoutes);

// ── Page Routes ───────────────────────────────────────────────
// Public
app.get('/',       (req, res) => res.redirect('/login'));
app.get('/login',  (req, res) => res.sendFile(path.join(__dirname, 'public/pages/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/signup.html')));

// Smart root redirect — sends each role to their correct home page
app.get('/home', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.redirect('/student-home');
  return res.redirect('/dashboard');
});

// ── Admin / Security only pages ───────────────────────────────
app.get('/dashboard',  requireAuth, requireRole('admin','security'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/dashboard.html')));

app.get('/scanner',    requireAuth, requireRole('admin','security'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/scanner.html')));

app.get('/students',   requireAuth, requireRole('admin'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/students.html')));

app.get('/attendance', requireAuth, requireRole('admin','security'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/attendance.html')));

app.get('/reports',    requireAuth, requireRole('admin','security'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/reports.html')));

app.get('/geofence',   requireAuth, requireRole('admin'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/geofence.html')));

// ── Student only pages ────────────────────────────────────────
app.get('/student-home', requireAuth, requireRole('student'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/student-home.html')));

// ── Shared pages (all roles) ──────────────────────────────────
app.get('/profile', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public/pages/profile.html')));

// 404 fallback
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   PAMPER – Attendance System          ║`);
  console.log(`  ║   Server running on port ${PORT}          ║`);
  console.log(`  ║   http://localhost:${PORT}               ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

module.exports = app;
