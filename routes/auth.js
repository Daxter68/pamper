const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }; // 8h

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { full_name, email, password, confirm_password, role, student_id, grade } = req.body;

  // Validation
  if (!full_name || !email || !password || !role)
    return res.status(400).json({ error: 'Full name, email, password and role are required' });

  if (password !== confirm_password)
    return res.status(400).json({ error: 'Passwords do not match' });

  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return res.status(400).json({ error: 'Please enter a valid email address' });

  if (!['admin', 'security', 'student', 'teacher'].includes(role))
    return res.status(400).json({ error: 'Invalid role selected' });

  if (role === 'student' && !student_id)
    return res.status(400).json({ error: 'Student ID is required for student accounts' });

  // Check if email already exists
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (existing)
    return res.status(409).json({ error: 'An account with this email already exists' });

  // Hash password and create user
  const password_hash = await bcrypt.hash(password, 12);
  const qr_code = uuidv4();

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      full_name:     full_name.trim(),
      email:         email.toLowerCase().trim(),
      password_hash,
      role,
      student_id:    role === 'student' ? student_id.trim().toUpperCase() : null,
      grade:         role === 'student' ? grade : null,
      qr_code,
      qr_status:     'active'
    })
    .select('id, full_name, email, role, student_id, grade, qr_code')
    .single();

  if (error) {
    if (error.message.includes('unique') || error.message.includes('duplicate'))
      return res.status(409).json({ error: 'Email or Student ID already in use' });
    return res.status(500).json({ error: 'Failed to create account – ' + error.message });
  }

  // Auto sign-in after registration
  const token = jwt.sign(
    {
      id:        newUser.id,
      email:     newUser.email,
      name:      newUser.full_name,
      role:      newUser.role,
      studentId: newUser.student_id,
      grade:     newUser.grade,
      qrCode:    newUser.qr_code
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, COOKIE_OPTS);
  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    user: { id: newUser.id, name: newUser.full_name, role: newUser.role, email: newUser.email }
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  // Fetch user
  const { data: user, error } = await supabase
    .from('users')
    .select('id, full_name, email, password_hash, role, student_id, grade, qr_code, is_blacklisted')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !user)
    return res.status(401).json({ error: 'Invalid email or password' });

  // Check password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ error: 'Invalid email or password' });

  if (user.is_blacklisted)
    return res.status(403).json({ error: 'Account suspended – contact administration' });

  // Sign JWT
  const token = jwt.sign(
    {
      id:         user.id,
      email:      user.email,
      name:       user.full_name,
      role:       user.role,
      studentId:  user.student_id,
      grade:      user.grade,
      qrCode:     user.qr_code
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, COOKIE_OPTS);
  res.json({
    success: true,
    user: { id: user.id, name: user.full_name, role: user.role, email: user.email }
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// GET /api/auth/me – return current user from token
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const { data: user } = await supabase
    .from('users').select('password_hash').eq('id', req.user.id).single();

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  await supabase.from('users').update({ password_hash: hash, updated_at: new Date() }).eq('id', req.user.id);

  res.json({ success: true, message: 'Password updated successfully' });
});

module.exports = router;
