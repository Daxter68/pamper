const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/users – list users (admin/security)
router.get('/', requireRole('admin', 'security'), async (req, res) => {
  const { role, grade, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('users')
    .select('id, student_id, full_name, email, role, grade, qr_code, qr_status, is_blacklisted, created_at', { count: 'exact' })
    .order('full_name');

  if (role)   query = query.eq('role', role);
  if (grade)  query = query.eq('grade', grade);
  if (search) query = query.or(`full_name.ilike.%${search}%,student_id.ilike.%${search}%,email.ilike.%${search}%`);

  query = query.range(offset, offset + Number(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, count, page: Number(page), limit: Number(limit) });
});

// GET /api/users/:id – single user
router.get('/:id', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, student_id, full_name, email, role, grade, qr_code, qr_status, is_blacklisted, blacklist_reason, created_at')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

// POST /api/users – create user (admin only)
router.post('/', requireRole('admin'), async (req, res) => {
  const { full_name, email, password, role, grade, student_id } = req.body;
  if (!full_name || !email || !password || !role)
    return res.status(400).json({ error: 'full_name, email, password, and role are required' });

  const password_hash = await bcrypt.hash(password, 12);
  const qr_code = uuidv4();

  const { data, error } = await supabase
    .from('users')
    .insert({ full_name, email: email.toLowerCase(), password_hash, role, grade, student_id, qr_code })
    .select('id, student_id, full_name, email, role, grade, qr_code, qr_status')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/users/:id – update user
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const allowed = ['full_name', 'email', 'grade', 'student_id', 'qr_status'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  updates.updated_at = new Date();

  const { data, error } = await supabase
    .from('users').update(updates).eq('id', req.params.id)
    .select('id, student_id, full_name, email, role, grade, qr_status').single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/users/:id – soft delete (blacklist) or hard delete
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/users/:id/reset-password – admin resets any user's password
router.post('/:id/reset-password', requireRole('admin'), async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash = await bcrypt.hash(new_password, 12);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: hash, updated_at: new Date() })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: 'Password reset successfully' });
});

// POST /api/users/:id/blacklist – blacklist/unblacklist
router.post('/:id/blacklist', requireRole('admin'), async (req, res) => {
  const { blacklist, reason } = req.body;
  const updates = {
    is_blacklisted: !!blacklist,
    blacklist_reason: blacklist ? (reason || 'No reason provided') : null,
    updated_at: new Date()
  };

  const { data, error } = await supabase
    .from('users').update(updates).eq('id', req.params.id)
    .select('id, full_name, is_blacklisted, blacklist_reason').single();

  if (error) return res.status(400).json({ error: error.message });

  // Log security alert
  if (blacklist) {
    await supabase.from('security_alerts').insert({
      alert_type: 'blacklist_added',
      user_id: req.params.id,
      triggered_by: req.user.id,
      description: `User blacklisted: ${reason || 'No reason provided'}`,
      severity: 'high'
    });
  }

  res.json(data);
});

// POST /api/users/:id/regenerate-qr – generate a new QR code
router.post('/:id/regenerate-qr', requireRole('admin'), async (req, res) => {
  const newQr = uuidv4();

  // Revoke old QR in audit table
  const { data: user } = await supabase.from('users').select('qr_code').eq('id', req.params.id).single();
  if (user?.qr_code) {
    await supabase.from('qr_codes').update({ status: 'revoked', revoked_at: new Date(), revoked_by: req.user.id })
      .eq('user_id', req.params.id).eq('status', 'active');
  }

  // Insert new QR audit entry
  await supabase.from('qr_codes').insert({ user_id: req.params.id, code: newQr });

  const { data, error } = await supabase
    .from('users').update({ qr_code: newQr, qr_status: 'active', updated_at: new Date() })
    .eq('id', req.params.id).select('id, full_name, qr_code, qr_status').single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
