# PAMPER – QR-Based Campus Attendance & Security System
### Beta v0.4 | Node.js + Express + Supabase

---

## Tech Stack
| Layer      | Technology                        |
|------------|-----------------------------------|
| Frontend   | HTML, CSS (custom design system), Vanilla JS |
| Backend    | Node.js, Express.js               |
| Database   | Supabase (PostgreSQL)             |
| Auth       | JWT (httpOnly cookies) + bcrypt   |
| QR Display | qrcode.js (CDN)                   |
| QR Scan    | html5-qrcode (CDN)                |

---

## Setup Instructions

### 1. Create a Supabase Project
1. Go to https://supabase.com and create a free account
2. Create a **new project** (choose a region close to Jamaica)
3. Wait for the project to initialize (~2 minutes)

### 2. Run the Database Schema
1. In your Supabase dashboard go to **SQL Editor → New Query**
2. Paste the entire contents of `schema.sql`
3. Click **Run** — this creates all tables, indexes, RLS policies, and seeds demo accounts

### 3. Get Your Supabase Keys
In your Supabase project go to **Settings → API**:
- Copy **Project URL**
- Copy **anon / public key**
- Copy **service_role / secret key** (keep this private!)

### 4. Configure Environment Variables
```bash
cp .env.example .env
```
Edit `.env` and fill in your values:
```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_KEY=your-service-role-key-here
JWT_SECRET=any-long-random-string-at-least-32-chars
PORT=3000
```

### 5. Install Dependencies
```bash
npm install
```

### 6. Start the Server
```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

Open http://localhost:3000

---

## Pages & Routes

### Frontend Pages
| URL          | Description                        | Roles              |
|--------------|------------------------------------|--------------------|
| `/login`     | Sign in page                       | Public             |
| `/dashboard` | Stats, live activity feed          | Admin, Security    |
| `/scanner`   | Live QR camera scanner             | Admin, Security    |
| `/students`  | Student list, add/edit, QR regen   | Admin              |
| `/attendance`| Attendance records with filters    | Admin, Security    |
| `/reports`   | Daily/Weekly/Monthly reports+CSV   | Admin, Security    |
| `/profile`   | Personal profile, QR card, password| All roles          |

### API Endpoints
```
POST   /api/auth/login              — Sign in, returns JWT cookie
POST   /api/auth/logout             — Clear session
GET    /api/auth/me                 — Current user from token
POST   /api/auth/change-password    — Update password

GET    /api/users                   — List users (admin/security)
POST   /api/users                   — Create user (admin)
GET    /api/users/:id               — Get single user (admin)
PATCH  /api/users/:id               — Update user (admin)
DELETE /api/users/:id               — Delete user (admin)
POST   /api/users/:id/blacklist     — Blacklist/unblacklist (admin)
POST   /api/users/:id/regenerate-qr — New QR code (admin)

POST   /api/attendance/scan         — Record a QR scan (security/admin)
GET    /api/attendance              — List records by date (admin/security)
GET    /api/attendance/me           — Student's own history (student)
GET    /api/attendance/today-stats  — Dashboard summary (admin/security)
GET    /api/attendance/weekly       — 7-day chart data (admin/security)
GET    /api/attendance/live-feed    — Recent scan activity (admin/security)

GET    /api/reports/daily           — Daily attendance report (admin/security)
GET    /api/reports/weekly          — Weekly trend report (admin/security)
GET    /api/reports/monthly         — Monthly per-student report (admin/security)
GET    /api/reports/alerts          — Security alerts list (admin/security)
PATCH  /api/reports/alerts/:id/resolve — Resolve an alert (admin)
```

---

## Project Structure
```
pamper/
├── server.js                 ← Express entry point
├── schema.sql                ← Supabase database schema (run once)
├── .env.example              ← Environment variable template
├── config/
│   └── supabase.js           ← Supabase client (service role)
├── middleware/
│   └── auth.js               ← JWT verify + role guard
├── routes/
│   ├── auth.js               ← Login / logout / me
│   ├── users.js              ← Student & staff CRUD
│   ├── attendance.js         ← Scan + records + stats
│   └── reports.js            ← Reports + security alerts
└── public/
    ├── css/
    │   └── app.css           ← Shared design system
    ├── js/
    │   └── api.js            ← API client + sidebar + utilities
    └── pages/
        ├── login.html
        ├── dashboard.html
        ├── scanner.html
        ├── students.html
        ├── attendance.html
        ├── reports.html
        └── profile.html
```

---

## Features Implemented

### ✅ Authentication
- Role-based login (Admin, Security, Student)
- JWT stored in httpOnly cookie (secure, XSS-resistant)
- Route protection on both server and client
- Password change with current password verification

### ✅ Student Management
- Add, view, and update students
- Auto-generated UUID QR code per student
- QR regeneration with audit trail
- Blacklist / unblacklist with reason logging
- Live search and grade filtering

### ✅ QR Attendance Scanning
- Real camera-based QR scanning (html5-qrcode)
- Manual QR/ID entry fallback
- Check-in and check-out modes
- Duplicate scan prevention (5-minute window)
- Blacklisted student detection + security alert
- Unknown QR rejection

### ✅ Records & Reports
- Daily attendance with time-in / time-out
- Weekly bar chart with present/absent trend
- Monthly per-student attendance percentage
- Live dashboard stats (auto-refresh every 30s)
- CSV export for all report types

### ✅ Student Self-Service
- View own attendance history
- See personal QR code to present at gate
- Monthly attendance rate calculation

---

## What's Next (Iteration 3)
- [ ] Email/SMS notifications for blacklist alerts
- [ ] Offline QR scanning with sync on reconnect
- [ ] GPS location tagging per scan
- [ ] Multi-gate support
- [ ] Admin analytics dashboard with charts
- [ ] Automated daily summary emails
- [ ] Mobile app (React Native)
