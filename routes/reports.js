const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'security'));

// GET /api/reports/daily?date=YYYY-MM-DD
router.get('/daily', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const { data: students } = await supabase
    .from('users').select('id, student_id, full_name, grade').eq('role', 'student').order('full_name');

  const { data: logs } = await supabase
    .from('attendance_logs').select('student_id, scan_type, scan_time').eq('date', date);

  const records = (students || []).map(s => {
    const sl = (logs || []).filter(l => l.student_id === s.id);
    const inL  = sl.find(l => l.scan_type === 'in');
    const outL = sl.find(l => l.scan_type === 'out');
    return {
      student_id: s.student_id,
      full_name:  s.full_name,
      grade:      s.grade,
      time_in:    inL  ? new Date(inL.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '—',
      time_out:   outL ? new Date(outL.scan_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '—',
      status:     inL ? 'Present' : 'Absent'
    };
  });

  res.json({
    date,
    total:   records.length,
    present: records.filter(r => r.status === 'Present').length,
    absent:  records.filter(r => r.status === 'Absent').length,
    rate:    records.length ? Math.round((records.filter(r=>r.status==='Present').length / records.length)*100) : 0,
    records
  });
});

// GET /api/reports/weekly?start=YYYY-MM-DD
router.get('/weekly', async (req, res) => {
  const start = req.query.start || (() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0];
  })();

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start + 'T12:00:00');
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }

  const { count: total } = await supabase
    .from('users').select('id', { count: 'exact', head: true }).eq('role', 'student');

  const { data: logs } = await supabase
    .from('attendance_logs').select('student_id, date').in('date', days).eq('scan_type', 'in');

  const weekly = days.map(date => {
    const present = new Set((logs||[]).filter(l=>l.date===date).map(l=>l.student_id)).size;
    return {
      date,
      day: new Date(date + 'T12:00:00').toLocaleDateString('en-US',{weekday:'short'}),
      present, absent: (total||0) - present, total: total||0,
      rate: total ? Math.round((present/total)*100) : 0
    };
  });

  res.json({ range: `${days[0]} to ${days[6]}`, total_students: total||0, days: weekly });
});

// GET /api/reports/monthly?year=2026&month=3
router.get('/monthly', async (req, res) => {
  const year  = Number(req.query.year)  || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const pad = n => String(n).padStart(2,'0');
  const start = `${year}-${pad(month)}-01`;
  const end   = `${year}-${pad(month)}-${new Date(year, month, 0).getDate()}`;

  const { data: students } = await supabase
    .from('users').select('id, student_id, full_name, grade').eq('role', 'student').order('full_name');

  const { data: logs } = await supabase
    .from('attendance_logs').select('student_id, date').gte('date', start).lte('date', end).eq('scan_type', 'in');

  // Count unique days per student
  const workingDays = new Set((logs||[]).map(l=>l.date)).size || 1;

  const records = (students||[]).map(s => {
    const days = new Set((logs||[]).filter(l=>l.student_id===s.id).map(l=>l.date)).size;
    return {
      student_id:   s.student_id,
      full_name:    s.full_name,
      grade:        s.grade,
      days_present: days,
      days_absent:  workingDays - days,
      rate:         Math.round((days / workingDays) * 100)
    };
  });

  res.json({ year, month, working_days: workingDays, total_students: records.length, records });
});

// GET /api/reports/alerts – security alerts
router.get('/alerts', async (req, res) => {
  const { resolved } = req.query;
  let query = supabase
    .from('security_alerts')
    .select('id, alert_type, description, severity, resolved, created_at, user_id, users!security_alerts_user_id_fkey(full_name, student_id)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (resolved !== undefined) query = query.eq('resolved', resolved === 'true');

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PATCH /api/reports/alerts/:id/resolve
router.patch('/alerts/:id/resolve', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('security_alerts').update({ resolved: true }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
