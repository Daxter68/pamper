const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/campus/settings – get all campus settings (all roles can read)
router.get('/settings', async (req, res) => {
  const { data, error } = await supabase
    .from('campus_settings')
    .select('key, value, description, updated_at')
    .order('key');

  if (error) return res.status(500).json({ error: error.message });

  // Convert array to easy key:value object
  const settings = {};
  (data || []).forEach(row => { settings[row.key] = row.value; });

  res.json({
    settings,
    raw: data
  });
});

// GET /api/campus/geofence – just the geofence info (students use this)
router.get('/geofence', async (req, res) => {
  const { data, error } = await supabase
    .from('campus_settings')
    .select('key, value')
    .in('key', [
      'geofence_enabled',
      'geofence_lat',
      'geofence_lng',
      'geofence_radius',
      'campus_name',
      'self_checkin',
      'checkin_start',
      'checkin_end'
    ]);

  if (error) return res.status(500).json({ error: error.message });

  const s = {};
  (data || []).forEach(r => { s[r.key] = r.value; });

  res.json({
    enabled:       s.geofence_enabled === 'true',
    lat:           parseFloat(s.geofence_lat)    || 18.2706,
    lng:           parseFloat(s.geofence_lng)    || -77.1270,
    radius:        parseInt(s.geofence_radius)   || 300,
    campus_name:   s.campus_name                 || 'Campus',
    self_checkin:  s.self_checkin === 'true',
    checkin_start: s.checkin_start               || '07:00',
    checkin_end:   s.checkin_end                 || '18:00'
  });
});

// PATCH /api/campus/settings – update one or more settings (admin only)
router.patch('/settings', requireRole('admin'), async (req, res) => {
  const updates = req.body; // { geofence_radius: "500", geofence_enabled: "true", ... }

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'No settings provided' });

  // Validate numeric fields
  if (updates.geofence_radius && isNaN(Number(updates.geofence_radius)))
    return res.status(400).json({ error: 'Radius must be a number' });

  if (updates.geofence_lat && isNaN(Number(updates.geofence_lat)))
    return res.status(400).json({ error: 'Latitude must be a number (e.g. 18.2706)' });

  if (updates.geofence_lng && isNaN(Number(updates.geofence_lng)))
    return res.status(400).json({ error: 'Longitude must be a number (e.g. -77.1270)' });

  // Validate boolean fields
  const boolFields = ['geofence_enabled', 'self_checkin'];
  for (const f of boolFields) {
    if (updates[f] !== undefined && !['true','false'].includes(updates[f]))
      return res.status(400).json({ error: `${f} must be "true" or "false"` });
  }

  // Validate time fields
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (updates.checkin_start && !timeRegex.test(updates.checkin_start))
    return res.status(400).json({ error: 'checkin_start must be in HH:MM format (e.g. 07:00)' });
  if (updates.checkin_end && !timeRegex.test(updates.checkin_end))
    return res.status(400).json({ error: 'checkin_end must be in HH:MM format (e.g. 18:00)' });

  // Upsert each setting
  const upserts = Object.entries(updates).map(([key, value]) => ({
    key,
    value: String(value),
    updated_by: req.user.id,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from('campus_settings')
    .upsert(upserts, { onConflict: 'key' });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, updated: Object.keys(updates) });
});

// POST /api/campus/test-email – send a test email
router.post('/test-email', requireRole('admin'), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });

  const { sendMail } = require('../config/mailer');
  const sent = await sendMail({
    to,
    subject: 'PAMPER Test Email',
    html: `<div style="font-family:Arial,sans-serif;padding:20px;"><h2 style="color:#0e8a7c;">PAMPER Email Test</h2><p>Your email configuration is working correctly.</p><p style="color:#666;font-size:13px;">Sent from PAMPER Attendance System</p></div>`,
    type: 'test'
  });

  if (sent) res.json({ success: true, message: `Test email sent to ${to}` });
  else res.status(500).json({ error: 'Failed to send email. Check your SMTP settings.' });
});

// GET /api/campus/notification-log
router.get('/notification-log', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('notification_log')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
