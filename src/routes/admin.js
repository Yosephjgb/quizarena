import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../validate.js';
import { mapQuestion } from '../db.js';

const questionSchema = z
  .object({
    text: z.string().trim().min(3).max(300),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(4),
    correctIndex: z.number().int().min(0),
    category: z.string().trim().min(1).max(40).default('General'),
    timeLimit: z.number().int().min(5).max(60).default(20),
  })
  .refine((q) => q.correctIndex < q.options.length, {
    path: ['correctIndex'],
    message: 'must point at one of the options',
  });

const userPatchSchema = z
  .object({
    role: z.enum(['player', 'admin']).optional(),
    banned: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.banned !== undefined, { message: 'nothing to update' });

export function adminRoutes({ db, auth, games }) {
  const router = Router();
  router.use(auth.requireAdmin); // every route below is admin-only

  // ---------- Questions CRUD ----------
  router.get('/questions', (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    const category = String(req.query.category || '');
    const rows = db
      .prepare(
        `SELECT * FROM questions
          WHERE text LIKE ? AND (? = '' OR category = ?)
          ORDER BY id DESC LIMIT 500`
      )
      .all(q, category, category);
    res.json({ questions: rows.map(mapQuestion) });
  });

  router.post('/questions', validate(questionSchema), (req, res) => {
    const { text, options, correctIndex, category, timeLimit } = req.body;
    const info = db
      .prepare(
        'INSERT INTO questions (text, options, correct_index, category, time_limit, created_by) VALUES (?,?,?,?,?,?)'
      )
      .run(text, JSON.stringify(options), correctIndex, category, timeLimit, req.user.id);
    const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ question: mapQuestion(row) });
  });

  router.put('/questions/:id', validate(questionSchema), (req, res) => {
    const { text, options, correctIndex, category, timeLimit } = req.body;
    const info = db
      .prepare(
        'UPDATE questions SET text=?, options=?, correct_index=?, category=?, time_limit=? WHERE id=?'
      )
      .run(text, JSON.stringify(options), correctIndex, category, timeLimit, req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Question not found' });
    const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
    res.json({ question: mapQuestion(row) });
  });

  router.delete('/questions/:id', (req, res) => {
    const info = db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Question not found' });
    res.json({ ok: true });
  });

  // ---------- Users ----------
  router.get('/users', (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.username, u.role, u.banned, u.created_at AS createdAt,
                (SELECT COUNT(*) FROM game_players WHERE user_id = u.id) AS gamesPlayed
           FROM users u
          WHERE u.username LIKE ? OR u.email LIKE ?
          ORDER BY u.id DESC LIMIT 200`
      )
      .all(q, q);
    res.json({ users: rows.map((r) => ({ ...r, banned: !!r.banned })) });
  });

  router.patch('/users/:id', validate(userPatchSchema), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: "You can't change your own role or ban yourself" });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { role, banned } = req.body;
    if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (banned !== undefined) {
      db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, id);
      if (banned) games.kickUser(id); // drop them from any live game / socket right away
    }
    const row = db
      .prepare('SELECT id, email, username, role, banned FROM users WHERE id = ?')
      .get(id);
    res.json({ user: { ...row, banned: !!row.banned } });
  });

  // ---------- Stats ----------
  router.get('/stats', (req, res) => {
    const one = (sql) => db.prepare(sql).get();
    const totals = one(`SELECT
        (SELECT COUNT(*) FROM users)                              AS users,
        (SELECT COUNT(*) FROM questions)                          AS questions,
        (SELECT COUNT(*) FROM games WHERE status = 'finished')    AS gamesPlayed,
        (SELECT COUNT(*) FROM users WHERE banned = 1)             AS bannedUsers`);
    const gamesPerDay = db
      .prepare(
        `SELECT date(ended_at) AS day, COUNT(*) AS games
           FROM games WHERE status = 'finished' AND ended_at >= datetime('now','-7 days')
          GROUP BY day ORDER BY day`
      )
      .all();
    const topPlayers = db
      .prepare(
        `SELECT u.username, SUM(gp.score) AS totalScore, COUNT(*) AS games
           FROM game_players gp JOIN users u ON u.id = gp.user_id
          GROUP BY u.id ORDER BY totalScore DESC LIMIT 5`
      )
      .all();
    const byCategory = db
      .prepare('SELECT category, COUNT(*) AS count FROM questions GROUP BY category ORDER BY count DESC')
      .all();
    res.json({ totals, liveGames: games.liveCount(), gamesPerDay, topPlayers, byCategory });
  });

  return router;
}
