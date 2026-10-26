import jwt from 'jsonwebtoken';

const COOKIE = 'token';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createAuth({ db, secret, isProd }) {
  const getUser = db.prepare(
    'SELECT id, email, username, role, banned FROM users WHERE id = ?'
  );

  function signToken(userId) {
    return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
  }

  function setCookie(res, userId) {
    res.cookie(COOKIE, signToken(userId), {
      httpOnly: true, // JavaScript in the browser can't read it (blocks XSS token theft)
      sameSite: 'lax', // not sent on cross-site POSTs (basic CSRF protection)
      secure: isProd, // HTTPS only in production
      maxAge: MAX_AGE_MS,
    });
  }

  function clearCookie(res) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProd });
  }

  // Returns the user for a JWT, or null if the token is bad or the user is banned/deleted.
  // We hit the DB every time so a ban takes effect immediately.
  function userFromToken(token) {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, secret);
      const user = getUser.get(payload.sub);
      if (!user || user.banned) return null;
      return { id: user.id, email: user.email, username: user.username, role: user.role };
    } catch {
      return null;
    }
  }

  function requireAuth(req, res, next) {
    const user = userFromToken(req.cookies?.[COOKIE]);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  }

  function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      next();
    });
  }

  return { setCookie, clearCookie, userFromToken, requireAuth, requireAdmin, COOKIE };
}
