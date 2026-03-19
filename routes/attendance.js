const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Haversine distance calculator (metres between two GPS coords) ──
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Fetch campus geofence settings — gracefully returns permissive defaults ──
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
      // Table doesn't exist yet or is empty — allow self check-in with no geofence
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
      selfCheckin:  s.self_checkin !== 'false',   // default true
      checkinStart: s.checkin_start || '00:00',
      checkinEnd:   s.checkin_end   || '23:59'
    };
  } catch {
    // Any error — fail open so students aren't locked out
    return { enabled: false, lat: 18.2706, lng: -77.1270, radius: 300,
             selfCheckin: true, checkinStart: '00:00', checkinEnd: '23:59' };
  }
}

// ── Shared scan logic ─────────────────────────────────────────────
// Returns { log, isLate, minutesLate } on success, or { error, status } on failure
async function recordScan(studentId, scannedBy, scanType, location) {
  // Duplicate check (5 min window)
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

  // ── Late detection ──────────────────────────────────────────
  let isLate      = false;
  let minutesLate = 0;

  if (scanType === 'in') {
    try {
      const { data: settings } = await supabase
        .from('campus_settings')
        .select('value')
        .eq('key', 'late_cutoff_time')
        .single();

      if (settings?.value) {
        const [lh, lm] = settings.value.split(':').map(Number);
        const nowJ     = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Jamaica' }));
        const nowMins  = nowJ.getHours() * 60 + nowJ.getMinutes();
        const cutMins  = lh * 60 + lm;
        if (nowMins > cutMins) {
          isLate      = true;
          minutesLate = nowMins - cutMins;
        }
      }
    } catch(e) { /* ignore — proceed without late check */ }
  }

  const { data: log, error: logErr } = await supabase
    .from('attendance_logs')
    .insert({
      student_id: studentId,
      scanned_by: scannedBy,
      scan_type:  scanType,
      location,
      notes:      isLate ? `Late by ${minutesLate} minutes` : null,
      date:       new Date().toISOString().split('T')[0]
    })
    .select()
    .single();

  if (logErr) return { error: logErr.message, status: 500 };
  return { log, isLate, minutesLate };
}

// POST /api/attendance/scan – staff/admin scan (no geofence required)
router.post('/scan', requireRole('admin', 'security'), async (req, res) => {
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

  // Send late alert if applicable
  if (result.isLate) {
    const { sendLateAlert } = require('../config/mailer');
    const scanTimeStr = new Date(result.log.scan_time)
      .toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    sendLateAlert(student, scanTimeStr, result.minutesLate).catch(() => {});
  }

  res.json({
    success: true, scan_type,
    student: { id: student.id, name: student.full_name, studentId: student.student_id, grade: student.grade },
    scan_time: result.log.scan_time,
    is_late:      result.isLate,
    minutes_late: result.minutesLate
  });
});

// POST /api/attendance/id-checkin – public, no login required
// Accepts student_id (e.g. ST001) OR qr_code (UUID from QR card)
router.post('/id-checkin', async (req, res) => {
  const { student_id, qr_code, scan_type = 'in' } = req.body;
  const usingQR = !!(qr_code && qr_code.trim());
  const usingID = !!(student_id && student_id.trim());

  if (!usingQR && !usingID)
    return res.status(400).json({ error: 'Student ID or QR code is required.' });

  // Look up student — by qr_code UUID or by student_id
  let query = supabase
    .from('users')
    .select('id, full_name, student_id, grade, is_blacklisted, qr_status, role, qr_code');

  if (usingQR) {
    query = query.eq('qr_code', qr_code.trim());
  } else {
    query = query
      .eq('student_id', student_id.trim().toUpperCase())
      .eq('role', 'student');
  }

  const { data: student, error } = await query.single();

  if (error || !student)
    return res.status(404).json({
      error: usingQR
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

  // Auto-activate if pending or null
  if (!student.qr_status || student.qr_status === 'pending') {
    await supabase.from('users').update({ qr_status: 'active' }).eq('id', student.id);
    student.qr_status = 'active';
  }

  if (student.qr_status === 'revoked')
    return res.status(400).json({ error: 'This QR code has been revoked. Please see administration.' });

  // Campus settings
  const campus = await getCampusSettings();

  if (!campus.selfCheckin)
    return res.status(403).json({ error: 'Self check-in is currently disabled. Please see security personnel.' });

  // Hours check (Jamaica time)
  const nowJamaica = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Jamaica' }));
  const nowMins    = nowJamaica.getHours() * 60 + nowJamaica.getMinutes();
  const [sh, sm]   = campus.checkinStart.split(':').map(Number);
  const [eh, em]   = campus.checkinEnd.split(':').map(Number);

  if (nowMins < sh * 60 + sm || nowMins > eh * 60 + em)
    return res.status(403).json({
      error:   'OUTSIDE_HOURS',
      message: `Check-in is only available between ${campus.checkinStart} and ${campus.checkinEnd}.`
    });

  // Duplicate check (5 min)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('attendance_logs')
    .select('id')
    .eq('student_id', student.id)
    .eq('scan_type', scan_type)
    .gte('scan_time', fiveMinAgo)
    .limit(1);

  if (recent && recent.length > 0)
    return res.status(409).json({
      error:   'DUPLICATE',
      message: `Already checked ${scan_type === 'in' ? 'in' : 'out'} in the last 5 minutes.`
    });

  // Record
  const { data: log, error: logErr } = await supabase
    .from('attendance_logs')
    .insert({
      student_id: student.id,
      scanned_by: student.id,
      scan_type,
      location:   usingQR ? 'QR Card Scan' : 'Student ID Entry',
      date:       new Date().toISOString().split('T')[0]
    })
    .select()
    .single();

  if (logErr)
    return res.status(500).json({ error: 'Failed to record attendance. Please try again.' });

  res.json({
    success:   true,
    scan_type,
    name:      student.full_name,
    studentId: student.student_id,
    grade:     student.grade,
    scan_time: log.scan_time,
    method:    usingQR ? 'qr' : 'id',
    message:   scan_type === 'in'
      ? `Welcome, ${student.full_name.split(' ')[0]}! You are checked in.`
      : `Goodbye, ${student.full_name.split(' ')[0]}! You are checked out.`
  });
});


router.get('/debug-scan', requireRole('student'), async (req, res) => {
  const checks = {};

  // 1. Check student record
  const { data: student, error: findErr } = await supabase
    .from('users')
    .select('id, full_name, student_id, qr_code, is_blacklisted, qr_status, grade, role')
    .eq('id', req.user.id)
    .single();

  checks.student_found    = !findErr && !!student;
  checks.role             = student?.role;
  checks.qr_code          = student?.qr_code || null;
  checks.qr_status        = student?.qr_status || null;
  checks.is_blacklisted   = student?.is_blacklisted || false;
  checks.qr_status_ok     = student?.qr_status === 'active';

  // 2. Campus settings
  const campus = await getCampusSettings();
  checks.campus_settings_loaded = true;
  checks.self_checkin_enabled   = campus.selfCheckin;
  checks.geofence_enabled       = campus.enabled;
  checks.geofence_radius        = campus.radius;
  checks.checkin_start          = campus.checkinStart;
  checks.checkin_end            = campus.checkinEnd;

  // 3. Hours check
  const nowJamaica = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Jamaica' }));
  const nowMins    = nowJamaica.getHours() * 60 + nowJamaica.getMinutes();
  const [sh, sm]   = campus.checkinStart.split(':').map(Number);
  const [eh, em]   = campus.checkinEnd.split(':').map(Number);
  checks.current_time_jamaica = nowJamaica.toTimeString().slice(0,5);
  checks.current_mins         = nowMins;
  checks.start_mins           = sh * 60 + sm;
  checks.end_mins             = eh * 60 + em;
  checks.within_hours         = nowMins >= (sh*60+sm) && nowMins <= (eh*60+em);

  // 4. Overall verdict
  const blockers = [];
  if (!checks.student_found)        blockers.push('Student record not found');
  if (!checks.qr_status_ok)         blockers.push(`QR status is "${checks.qr_status}" — must be "active"`);
  if (checks.is_blacklisted)        blockers.push('Account is blacklisted');
  if (!checks.self_checkin_enabled) blockers.push('Self check-in is disabled in campus settings');
  if (!checks.within_hours)         blockers.push(`Outside check-in hours (now: ${checks.current_time_jamaica}, allowed: ${campus.checkinStart}–${campus.checkinEnd})`);

  checks.blockers         = blockers;
  checks.would_succeed    = blockers.length === 0;
  checks.note             = 'Geofence check requires GPS coords — not tested here';

  res.json(checks);
});

// POST /api/attendance/self-scan – student self check-in with optional geofence
router.post('/self-scan', requireRole('student'), async (req, res) => {
  const { scan_type = 'in', latitude, longitude } = req.body;

  // Get the student's own record
  const { data: student, error: findErr } = await supabase
    .from('users')
    .select('id, full_name, student_id, qr_code, is_blacklisted, qr_status, grade')
    .eq('id', req.user.id)
    .single();

  if (findErr || !student)
    return res.status(404).json({ error: 'Student account not found' });

  if (student.is_blacklisted)
    return res.status(403).json({
      error: 'BLACKLISTED',
      message: 'Your account is suspended. Contact administration.'
    });

  // Auto-fix: if qr_status is null/undefined, set it to active
  if (!student.qr_status || student.qr_status === 'pending') {
    await supabase
      .from('users')
      .update({ qr_status: 'active', updated_at: new Date() })
      .eq('id', student.id);
    student.qr_status = 'active';
  }

  if (student.qr_status === 'revoked')
    return res.status(400).json({
      error: 'Your QR code has been revoked. Contact an admin to reactivate it.'
    });

  // Load campus settings (never throws — returns safe defaults on failure)
  const campus = await getCampusSettings();

  // Check if self check-in is enabled
  if (!campus.selfCheckin)
    return res.status(403).json({
      error: 'Self check-in is currently disabled. Please see security personnel.'
    });

  // Check operating hours using Jamaica time (UTC-5)
  const nowJamaica = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Jamaica' }));
  const nowMins    = nowJamaica.getHours() * 60 + nowJamaica.getMinutes();
  const [sh, sm]   = campus.checkinStart.split(':').map(Number);
  const [eh, em]   = campus.checkinEnd.split(':').map(Number);
  const startMins  = sh * 60 + sm;
  const endMins    = eh * 60 + em;

  if (nowMins < startMins || nowMins > endMins) {
    return res.status(403).json({
      error:   'OUTSIDE_HOURS',
      message: `Self check-in is only available between ${campus.checkinStart} and ${campus.checkinEnd}.`
    });
  }

  // Geofence check — only if geofence is enabled
  if (campus.enabled) {
    if (latitude == null || longitude == null) {
      return res.status(400).json({
        error:   'LOCATION_REQUIRED',
        message: 'Your location is required for self check-in. Please allow location access and try again.'
      });
    }

    const distance = haversineDistance(
      campus.lat, campus.lng,
      parseFloat(latitude), parseFloat(longitude)
    );

    if (distance > campus.radius) {
      await supabase.from('security_alerts').insert({
        alert_type:   'out_of_bounds_scan',
        user_id:      student.id,
        triggered_by: student.id,
        description:  `Student attempted self check-in from ${Math.round(distance)}m away (limit: ${campus.radius}m)`,
        severity:     'low'
      }).catch(() => {}); // Don't fail the request if alert insert fails

      return res.status(403).json({
        error:    'OUT_OF_BOUNDS',
        message:  `You are ${Math.round(distance)} metres from campus. You must be within ${campus.radius} metres to check in.`,
        distance: Math.round(distance),
        allowed:  campus.radius
      });
    }
  }

  // All checks passed — record the scan
  const locString = (latitude != null && longitude != null)
    ? `Self Check-in (${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)})`
    : 'Self Check-in';

  const result = await recordScan(student.id, student.id, scan_type, locString);
  if (result.error) return res.status(result.status).json({ error: result.error, message: result.message });

  res.json({
    success:   true,
    scan_type,
    student: { id: student.id, name: student.full_name, studentId: student.student_id, grade: student.grade },
    scan_time: result.log.scan_time,
    location:  locString
  });
});

// GET /api/attendance – list records (admin/security)
router.get('/', requireRole('admin', 'security'), async (req, res) => {
  const { date, student_id, status, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;
  const filterDate = date || new Date().toISOString().split('T')[0];

  // Get all students
  const { data: students } = await supabase
    .from('users')
    .select('id, student_id, full_name, grade')
    .eq('role', 'student');

  // Get attendance logs for the day
  let logQuery = supabase
    .from('attendance_logs')
    .select('student_id, scan_type, scan_time, location')
    .eq('date', filterDate)
    .order('scan_time', { ascending: true });

  if (student_id) logQuery = logQuery.eq('student_id', student_id);

  const { data: logs } = await logQuery;

  // Build merged records
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
    total: records.length,
    present: records.filter(r => r.status === 'present').length,
    absent:  records.filter(r => r.status === 'absent').length,
    data: records.slice(offset, offset + Number(limit))
  });
});

// GET /api/attendance/me – student's own history
router.get('/me', async (req, res) => {
  if (req.user.role !== 'student')
    return res.status(403).json({ error: 'Students only' });

  const { data: student } = await supabase
    .from('users').select('id').eq('id', req.user.id).single();

  const { data: logs } = await supabase
    .from('attendance_logs')
    .select('scan_type, scan_time, date, location')
    .eq('student_id', student.id)
    .order('scan_time', { ascending: false })
    .limit(60);

  // Group by date
  const byDate = {};
  (logs || []).forEach(l => {
    if (!byDate[l.date]) byDate[l.date] = { date: l.date, time_in: null, time_out: null };
    if (l.scan_type === 'in' && !byDate[l.date].time_in)
      byDate[l.date].time_in = new Date(l.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    if (l.scan_type === 'out')
      byDate[l.date].time_out = new Date(l.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  });

  const records = Object.values(byDate).sort((a,b) => b.date.localeCompare(a.date));
  const totalDays = records.length;
  const presentDays = records.filter(r => r.time_in).length;

  res.json({
    records,
    summary: {
      total_days: totalDays,
      present_days: presentDays,
      attendance_rate: totalDays ? Math.round((presentDays / totalDays) * 100) : 0
    }
  });
});

// GET /api/attendance/today-stats – dashboard summary
router.get('/today-stats', requireRole('admin', 'security'), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const [{ count: totalStudents }, { data: todayLogs }] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    supabase.from('attendance_logs').select('student_id, scan_type').eq('date', today).eq('scan_type', 'in')
  ]);

  const presentIds = [...new Set((todayLogs || []).map(l => l.student_id))];
  const present = presentIds.length;
  const absent  = (totalStudents || 0) - present;

  const { count: totalScans } = await supabase
    .from('attendance_logs').select('id', { count: 'exact', head: true }).eq('date', today);

  res.json({
    date: today,
    total_students: totalStudents || 0,
    present,
    absent,
    total_scans: totalScans || 0,
    attendance_rate: totalStudents ? Math.round((present / totalStudents) * 100) : 0
  });
});

// GET /api/attendance/weekly – last 7 days chart data
router.get('/weekly', requireRole('admin', 'security'), async (req, res) => {
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
      day: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      present,
      absent: (total || 0) - present,
      total:  total || 0,
      rate:   total ? Math.round((present / total) * 100) : 0
    };
  });

  res.json(result);
});

// GET /api/attendance/live-feed – recent scans for activity panel
router.get('/live-feed', requireRole('admin', 'security'), async (req, res) => {
  const { data } = await supabase
    .from('attendance_logs')
    .select('scan_type, scan_time, student_id, users!attendance_logs_student_id_fkey(full_name, student_id)')
    .order('scan_time', { ascending: false })
    .limit(10);

  const feed = (data || []).map(l => ({
    name:       l.users?.full_name,
    studentId:  l.users?.student_id,
    scan_type:  l.scan_type,
    scan_time:  l.scan_time,
    initials:   (l.users?.full_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
  }));

  res.json(feed);
});

module.exports = router;
