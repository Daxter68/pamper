const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies?.token || extractBearer(req);
  if (!token) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized – please sign in' });
    return res.redirect('/login');
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch(err) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired – please sign in again' });
    res.clearCookie('token');
    return res.redirect('/login');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: `Access denied – requires role: ${roles.join(' or ')}` });
      if (req.user.role === 'student') return res.redirect('/student-home');
      return res.redirect('/dashboard');
    }
    next();
  };
}

function extractBearer(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

module.exports = { requireAuth, requireRole };
