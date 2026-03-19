const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── PUBLIC endpoint — checkin page needs this without auth ──────
// GET /api/face/all-descriptors – returns all enrolled face descriptors
// Only returns descriptors (128 numbers) + student info — no sensitive data
router.get('/all-descriptors', async (req, res) => {
  try {
    // Join face_descriptors with users to get student info
    const { data, error } = await supabase
      .from('face_descriptors')
      .select('user_id, descriptor, users!face_descriptors_user_id_fkey(full_name, student_id, grade)');

    if (error) return res.status(500).json({ error: error.message });

    const descriptors = (data || []).map(row => ({
      userId:    row.user_id,
      name:      row.users?.full_name || 'Unknown',
      studentId: row.users?.student_id || null,
      grade:     row.users?.grade || null,
      descriptor: JSON.parse(row.descriptor)
    }));

    res.json({ count: descriptors.length, descriptors });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── All routes below require authentication ─────────────────────
router.use(requireAuth);

// POST /api/face/enrol – save a student's face descriptor
router.post('/enrol', async (req, res) => {
  const { user_id, descriptor } = req.body;

  // Students can only enrol themselves; admins can enrol anyone
  const targetId = user_id || req.user.id;
  if (req.user.role === 'student' && targetId !== req.user.id)
    return res.status(403).json({ error: 'Students can only enrol their own face' });

  if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128)
    return res.status(400).json({ error: 'descriptor must be an array of 128 numbers' });

  const { data, error } = await supabase
    .from('face_descriptors')
    .upsert({
      user_id:    targetId,
      descriptor: JSON.stringify(descriptor),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select('user_id, enrolled_at, updated_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, enrolled: true, ...data });
});

// GET /api/face/:userId – get a user's descriptor (admin only for others)
router.get('/:userId', async (req, res) => {
  if (req.user.role === 'student' && req.params.userId !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabase
    .from('face_descriptors')
    .select('user_id, descriptor, enrolled_at')
    .eq('user_id', req.params.userId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'No face enrolled for this user' });

  res.json({
    user_id:     data.user_id,
    descriptor:  JSON.parse(data.descriptor),
    enrolled_at: data.enrolled_at
  });
});

// GET /api/face/check/:userId – check if user has face enrolled
router.get('/check/:userId', async (req, res) => {
  const { data } = await supabase
    .from('face_descriptors')
    .select('user_id, enrolled_at')
    .eq('user_id', req.params.userId)
    .single();

  res.json({ enrolled: !!data, enrolled_at: data?.enrolled_at || null });
});

// DELETE /api/face/:userId – remove face data
router.delete('/:userId', requireRole('admin'), async (req, res) => {
  const { error } = await supabase
    .from('face_descriptors')
    .delete()
    .eq('user_id', req.params.userId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
