require('dotenv').config();

const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');

const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes     = require('./routes/reports');
const campusRoutes     = require('./routes/campus');
const faceRoutes       = require('./routes/face');
const { requireAuth, requireRole } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/campus',     campusRoutes);
app.use('/api/face',       faceRoutes);

// ── Public pages ───────────────────────────────────────────────
app.get('/',        (req, res) => res.redirect('/login'));
app.get('/login',   (req, res) => res.sendFile(path.join(__dirname, 'public/pages/login.html')));
app.get('/signup',  (req, res) => res.sendFile(path.join(__dirname, 'public/pages/signup.html')));
app.get('/checkin', (req, res) => res.sendFile(path.join(__dirname, 'public/pages/checkin.html')));

// Smart redirect by role
app.get('/home', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.redirect('/student-home');
  return res.redirect('/dashboard');
});

// ── Admin + Security ───────────────────────────────────────────
app.get('/dashboard',  requireAuth, requireRole('admin','security'), (req,res) => res.sendFile(path.join(__dirname,'public/pages/dashboard.html')));
app.get('/scanner',    requireAuth, requireRole('admin','security'), (req,res) => res.sendFile(path.join(__dirname,'public/pages/scanner.html')));
app.get('/students',   requireAuth, requireRole('admin'),            (req,res) => res.sendFile(path.join(__dirname,'public/pages/students.html')));
app.get('/attendance', requireAuth, requireRole('admin','security'), (req,res) => res.sendFile(path.join(__dirname,'public/pages/attendance.html')));
app.get('/reports',    requireAuth, requireRole('admin','security'), (req,res) => res.sendFile(path.join(__dirname,'public/pages/reports.html')));
app.get('/geofence',   requireAuth, requireRole('admin'),            (req,res) => res.sendFile(path.join(__dirname,'public/pages/geofence.html')));

// ── New features ───────────────────────────────────────────────
app.get('/idcards',    requireAuth, requireRole('admin'),            (req,res) => res.sendFile(path.join(__dirname,'public/pages/idcards.html')));
app.get('/face-enrol', requireAuth, requireRole('admin'),            (req,res) => res.sendFile(path.join(__dirname,'public/pages/face-enrol.html')));

// ── Student ────────────────────────────────────────────────────
app.get('/student-home', requireAuth, requireRole('student'), (req,res) => res.sendFile(path.join(__dirname,'public/pages/student-home.html')));

// ── Shared ─────────────────────────────────────────────────────
app.get('/profile', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public/pages/profile.html')));

// ── Fallbacks ──────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error('[ERROR]', err.message); res.status(500).json({ error: 'Internal server error' }); });

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   PAMPER – Attendance System          ║`);
  console.log(`  ║   Running on http://localhost:${PORT}    ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

module.exports = app;
