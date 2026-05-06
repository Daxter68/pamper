const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── All routes below /api/attendance require auth EXCEPT id-checkin ──
// We apply requireAuth selectively, not globally, so the public kiosk works.

// ── Helpers ──────────────────────────────────────────────────────────

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fail-open: if campus_settings table is missing or empty, allow all check-ins
async function getCampusSettings() {
  try {
    const { data, error } = await supabase
      .from('campus_settings')
      .select('key, value')
      .in('key', [
        'geofence_enabled','geofence_lat','geofence_lng',
        'geofence_radius','self_checkin','checkin_start','checkin_end'
      ]);

    if (error || !data || data.length === 0) {
      return { enabled: false, lat: 18.2706, lng: -77.1270, radius: 300,
               selfCheckin: true, checkinStart: '00:00', checkinEnd: '23:59' };
    }

    const s = {};
    data.forEach(r => { s[r.key] = r.value; });

    return {
      enabled:      s.geofence_enabled === 'true',
      lat:          parseFloat(s.geofence_lat)  || 18.2706,
      lng:          parseFloat(s.geofence_lng)  || -77.1270,
      radius:       parseInt(s.geofence_radius) || 300,
      selfCheckin:  s.self_checkin !== 'false',
      checkinStart: s.checkin_start || '00:00',
      checkinEnd:   s.checkin_end   || '23:59'
    };
  } catch {
    return { enabled: false, lat: 18.2706, lng: -77.1270, radius: 300,
             selfCheckin: true, checkinStart: '00:00', checkinEnd: '23:59' };
  }
}

// Returns { log } on success, { error, status, message } on failure
async function recordScan(studentId, scannedBy, scanType, location) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('attendance_logs')
    .select('id')
    .eq('student_id', studentId)
    .eq('scan_type', scanType)
    .gte('scan_time', fiveMinAgo)
    .limit(1);

  if (recent && recent.length > 0) {
    return {
      error:   'DUPLICATE',
      status:  409,
      message: `Already recorded ${scanType === 'in' ? 'check-in' : 'check-out'} in the last 5 minutes`
    };
  }

  const { data: log, error: logErr } = await supabase
    .from('attendance_logs')
    .insert({
      student_id: studentId,
      scanned_by: scannedBy,
      scan_type:  scanType,
      location,
      date: new Date().toISOString().split('T')[0]
    })
    .select()
    .single();

  if (logErr) return { error: logErr.message, status: 500 };
  return { log };
}

// ── POST /api/attendance/scan — staff/admin QR scan ───────────────────
router.post('/scan', requireAuth, requireRole('admin', 'security'), async (req, res) => {
  const { qr_code, scan_type = 'in', location = 'Main Gate' } = req.body;
  if (!qr_code) return res.status(400).json({ error: 'qr_code is required' });

  const { data: student, error: findErr } = await supabase
    .from('users')
    .select('id, full_name, student_id, role, is_blacklisted, qr_status, grade')
    .eq('qr_code', qr_code)
    .single();

  if (findErr || !student)
    return res.status(404).json({ error: 'Unknown QR code – not registered in system' });

  if (student.role !== 'student')
    return res.status(400).json({ error: 'QR code does not belong to a student' });

  if (student.is_blacklisted) {
    await supabase.from('security_alerts').insert({
      alert_type:   'blacklist_scan',
      user_id:      student.id,
      triggered_by: req.user.id,
      description:  `Blacklisted student attempted scan: ${student.full_name}`,
      severity:     'high'
    });
    return res.status(403).json({
      error: 'BLACKLISTED',
      student: { name: student.full_name, studentId: student.student_id }
    });
  }

  if (student.qr_status !== 'active')
    return res.status(400).json({ error: `QR code is ${student.qr_status} – cannot scan` });

  const result = await recordScan(student.id, req.user.id, scan_type, location);
  if (result.error) return res.status(result.status).json({ error: result.error, message: result.message });

  res.json({
    success: true, scan_type,
    student: { id: student.id, name: student.full_name, studentId: student.student_id, grade: student.grade },
    scan_time: result.log.scan_time
  });
});

// ── POST /api/attendance/id-checkin — PUBLIC kiosk endpoint ───────────
// Accepts qr_code (UUID from QR card) OR student_id (e.g. ST001)
// No login required — this is used by the public /checkin kiosk page
router.post('/id-checkin', async (req, res) => {
  const { student_id, qr_code, scan_type = 'in' } = req.body;

  if (!student_id?.trim() && !qr_code?.trim())
    return res.status(400).json({ error: 'Student ID or QR code is required.' });

  // Look up student by qr_code OR student_id
  let query = supabase
    .from('users')
    .select('id, full_name, student_id, grade, is_blacklisted, qr_status, role, qr_code');

  if (qr_code?.trim()) {
    // QR card scan — look up by the UUID stored in the qr_code column
    query = query.eq('qr_code', qr_code.trim());
  } else {
    // Manual Student ID entry
    query = query
      .eq('student_id', student_id.trim().toUpperCase())
      .eq('role', 'student');
  }

  const { data: student, error } = await query.single();

  if (error || !student)
    return res.status(404).json({
      error: qr_code
        ? 'QR code not recognised. Please try entering your Student ID instead.'
        : 'Student ID not found. Please check your ID and try again.'
    });

  if (student.role !== 'student')
    return res.status(400).json({ error: 'This ID does not belong to a student account.' });

  if (student.is_blacklisted)
    return res.status(403).json({
      error:   'BLACKLISTED',
      message: 'This account is suspended. Contact administration.'
    });

  // Auto-activate QR if it was set to pending or null during account creation
  if (!student.qr_status || student.qr_status === 'pending') {
    await supabase
      .from('users')
      .update({ qr_status: 'active', updated_at: new Date() })
      .eq('id', student.id);
    student.qr_status = 'active';
  }

  if (student.qr_status === 'revoked')
    return res.status(400).json({
      error: 'This QR code has been revoked. Please see administration for a new card.'
    });

  // Load campus settings — fail-open so a missing table never blocks students
  const campus = await getCampusSettings();

  if (!campus.selfCheckin)
    return res.status(403).json({
      error: 'Self check-in is currently disabled. Please see security personnel.'
    });

  // Hours check using Jamaica time (UTC-5, no DST)
  const nowJamaica = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Jamaica' })
  );
  const nowMins   = nowJamaica.getHours() * 60 + nowJamaica.getMinutes();
  const [sh, sm]  = campus.checkinStart.split(':').map(Number);
  const [eh, em]  = campus.checkinEnd.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;

  if (nowMins < startMins || nowMins > endMins) {
    return res.status(403).json({
      error:   'OUTSIDE_HOURS',
      message: `Check-in is only available between ${campus.checkinStart} and ${campus.checkinEnd}.`
    });
  }

  const location = qr_code ? 'QR Card Scan (Kiosk)' : 'Student ID Entry (Kiosk)';
  const result   = await recordScan(student.id, student.id, scan_type, location);

  if (result.error)
    return res.status(result.status).json({ error: result.error, message: result.message });

  res.json({
    success:   true,
    scan_type,
    name:      student.full_name,
    studentId: student.student_id,
    grade:     student.grade,
    scan_time: result.log.scan_time,
    method:    qr_code ? 'qr' : 'id',
    message:   scan_type === 'in'
      ? `Welcome, ${student.full_name.split(' ')[0]}! You are checked in.`
      : `Goodbye, ${student.full_name.split(' ')[0]}! You are checked out.`
  });
});

// ── GET /api/attendance — list records (admin/security) ───────────────
router.get('/', requireAuth, requireRole('admin', 'security'), async (req, res) => {
  const { date, student_id, status, page = 1, limit = 100 } = req.query;
  const offset     = (page - 1) * limit;
  const filterDate = date || new Date().toISOString().split('T')[0];

  const { data: students } = await supabase
    .from('users')
    .select('id, student_id, full_name, grade')
    .eq('role', 'student');

  let logQuery = supabase
    .from('attendance_logs')
    .select('student_id, scan_type, scan_time, location')
    .eq('date', filterDate)
    .order('scan_time', { ascending: true });

  if (student_id) logQuery = logQuery.eq('student_id', student_id);

  const { data: logs } = await logQuery;

  const records = (students || []).map(s => {
    const studentLogs = (logs || []).filter(l => l.student_id === s.id);
    const inLog  = studentLogs.find(l => l.scan_type === 'in');
    const outLog = studentLogs.find(l => l.scan_type === 'out');
    const isPresent = !!inLog;

    return {
      id:         s.id,
      student_id: s.student_id,
      full_name:  s.full_name,
      grade:      s.grade,
      date:       filterDate,
      time_in:    inLog  ? new Date(inLog.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : null,
      time_out:   outLog ? new Date(outLog.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : null,
      status:     isPresent ? 'present' : 'absent'
    };
  }).filter(r => !status || r.status === status);

  res.json({
    date: filterDate,
    total:   records.length,
    present: records.filter(r => r.status === 'present').length,
    absent:  records.filter(r => r.status === 'absent').length,
    data:    records.slice(offset, offset + Number(limit))
  });
});

// ── GET /api/attendance/me — student's own history ────────────────────
router.get('/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'student')
    return res.status(403).json({ error: 'Students only' });

  const { data: logs } = await supabase
    .from('attendance_logs')
    .select('scan_type, scan_time, date, location')
    .eq('student_id', req.user.id)
    .order('scan_time', { ascending: false })
    .limit(60);

  const byDate = {};
  (logs || []).forEach(l => {
    if (!byDate[l.date]) byDate[l.date] = { date: l.date, time_in: null, time_out: null };
    if (l.scan_type === 'in' && !byDate[l.date].time_in)
      byDate[l.date].time_in = new Date(l.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    if (l.scan_type === 'out')
      byDate[l.date].time_out = new Date(l.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  });

  const records    = Object.values(byDate).sort((a,b) => b.date.localeCompare(a.date));
  const totalDays  = records.length;
  const presentDays = records.filter(r => r.time_in).length;

  res.json({
    records,
    summary: {
      total_days:      totalDays,
      present_days:    presentDays,
      attendance_rate: totalDays ? Math.round((presentDays / totalDays) * 100) : 0
    }
  });
});

// ── GET /api/attendance/today-stats ───────────────────────────────────
router.get('/today-stats', requireAuth, requireRole('admin', 'security'), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const [{ count: totalStudents }, { data: todayLogs }] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    supabase.from('attendance_logs').select('student_id').eq('date', today).eq('scan_type', 'in')
  ]);

  const present = new Set((todayLogs || []).map(l => l.student_id)).size;
  const absent  = (totalStudents || 0) - present;

  const { count: totalScans } = await supabase
    .from('attendance_logs').select('id', { count: 'exact', head: true }).eq('date', today);

  res.json({
    date: today,
    total_students: totalStudents || 0,
    present,
    absent,
    total_scans:     totalScans || 0,
    attendance_rate: totalStudents ? Math.round((present / totalStudents) * 100) : 0
  });
});

// ── GET /api/attendance/weekly ────────────────────────────────────────
router.get('/weekly', requireAuth, requireRole('admin', 'security'), async (req, res) => {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const { data: logs } = await supabase
    .from('attendance_logs')
    .select('student_id, date, scan_type')
    .in('date', days)
    .eq('scan_type', 'in');

  const { count: total } = await supabase
    .from('users').select('id', { count: 'exact', head: true }).eq('role', 'student');

  const result = days.map(date => {
    const dayLogs = (logs || []).filter(l => l.date === date);
    const present = new Set(dayLogs.map(l => l.student_id)).size;
    return {
      date,
      day:     new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      present,
      absent:  (total || 0) - present,
      total:   total || 0,
      rate:    total ? Math.round((present / total) * 100) : 0
    };
  });

  res.json(result);
});

// ── GET /api/attendance/live-feed ─────────────────────────────────────
router.get('/live-feed', requireAuth, requireRole('admin', 'security'), async (req, res) => {
  const { data } = await supabase
    .from('attendance_logs')
    .select('scan_type, scan_time, student_id, users!attendance_logs_student_id_fkey(full_name, student_id)')
    .order('scan_time', { ascending: false })
    .limit(10);

  const feed = (data || []).map(l => ({
    name:      l.users?.full_name,
    studentId: l.users?.student_id,
    scan_type: l.scan_type,
    scan_time: l.scan_time,
    initials:  (l.users?.full_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
  }));

  res.json(feed);
});

module.exports = router;
