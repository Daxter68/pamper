const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/attendance/scan – record a QR scan (security/admin)
router.post('/scan', requireRole('admin', 'security'), async (req, res) => {
  const { qr_code, scan_type = 'in', location = 'Main Gate' } = req.body;
  if (!qr_code) return res.status(400).json({ error: 'qr_code is required' });

  // Look up student by QR code
  const { data: student, error: findErr } = await supabase
    .from('users')
    .select('id, full_name, student_id, role, is_blacklisted, qr_status, grade')
    .eq('qr_code', qr_code)
    .single();

  if (findErr || !student)
    return res.status(404).json({ error: 'Unknown QR code – not registered in system' });

  if (student.role !== 'student')
    return res.status(400).json({ error: 'QR code does not belong to a student' });

  // Check blacklist
  if (student.is_blacklisted) {
    await supabase.from('security_alerts').insert({
      alert_type: 'blacklist_scan',
      user_id: student.id,
      triggered_by: req.user.id,
      description: `Blacklisted student attempted scan: ${student.full_name}`,
      severity: 'high'
    });
    return res.status(403).json({
      error: 'BLACKLISTED',
      student: { name: student.full_name, studentId: student.student_id }
    });
  }

  if (student.qr_status !== 'active')
    return res.status(400).json({ error: `QR code is ${student.qr_status} – cannot scan` });

  // Check duplicate scan within last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('attendance_logs')
    .select('id, scan_type, scan_time')
    .eq('student_id', student.id)
    .eq('scan_type', scan_type)
    .gte('scan_time', fiveMinAgo)
    .limit(1);

  if (recent && recent.length > 0) {
    return res.status(409).json({
      error: 'DUPLICATE',
      message: `Already recorded ${scan_type === 'in' ? 'check-in' : 'check-out'} in the last 5 minutes`,
      student: { name: student.full_name, studentId: student.student_id }
    });
  }

  // Record scan
  const { data: log, error: logErr } = await supabase
    .from('attendance_logs')
    .insert({
      student_id: student.id,
      scanned_by: req.user.id,
      scan_type,
      location,
      date: new Date().toISOString().split('T')[0]
    })
    .select()
    .single();

  if (logErr) return res.status(500).json({ error: logErr.message });

  res.json({
    success: true,
    scan_type,
    student: {
      id:        student.id,
      name:      student.full_name,
      studentId: student.student_id,
      grade:     student.grade
    },
    scan_time: log.scan_time
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
