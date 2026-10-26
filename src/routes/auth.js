import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../validate.js';

const registerSchema = z.object({
  email: z.string().trim().email('must be a valid email').max(120),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,20}$/, 'must be 3-20 letters, numbers or underscores'),
  password: z.string().min(8, 'must be at least 8 characters').max(100),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(120),
  password: z.string().min(1).max(100),
});

// Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRoutes({ db, auth, authRateMax }) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: authRateMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts, try again in a few minutes.' },
  });

  router.post('/register', limiter, validate(registerSchema), (req, res) => {
    const { email, username, password } = req.body;
    const hash = bcrypt.hashSync(password, 10);
    try {
      const info = db
        .prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)')
        .run(email, username, hash);
      auth.setCookie(res, info.lastInsertRowid);
      res.status(201).json({ user: { id: info.lastInsertRowid, email, username, role: 'player' } });
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        return res.status(409).json({ error: 'Email or username is already taken' });
      }
      throw err;
    }
  });

  router.post('/login', limiter, validate(loginSchema), (req, res) => {
    const { email, password } = req.body;
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) return res.status(401).json({ error: 'Invalid email or password' });
    if (row.banned) return res.status(403).json({ error: 'This account has been banned' });
    auth.setCookie(res, row.id);
    res.json({ user: { id: row.id, email: row.email, username: row.username, role: row.role } });
  });

  router.post('/logout', (req, res) => {
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', auth.requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
