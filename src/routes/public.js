import { Router } from 'express';

export function publicRoutes({ db, auth }) {
  const router = Router();

  router.get('/health', (req, res) => res.json({ ok: true }));

  router.get('/categories', (req, res) => {
    const rows = db
      .prepare('SELECT category, COUNT(*) AS count FROM questions GROUP BY category ORDER BY category')
      .all();
    res.json({ categories: rows });
  });

  // Leaderboard = a query over game_players. period=all | week
  router.get('/leaderboard', (req, res) => {
    const period = req.query.period === 'week' ? 'week' : 'all';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const since = period === 'week' ? "AND g.ended_at >= datetime('now', '-7 days')" : '';
    const rows = db
      .prepare(
        `SELECT u.username,
                SUM(gp.score)                         AS totalScore,
                COUNT(*)                              AS gamesPlayed,
                SUM(CASE WHEN gp.rank = 1 THEN 1 ELSE 0 END) AS wins,
                SUM(gp.correct_count)                 AS correctAnswers
           FROM game_players gp
           JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
           JOIN users u ON u.id = gp.user_id AND u.banned = 0
          WHERE 1 = 1 ${since}
          GROUP BY u.id
          ORDER BY totalScore DESC, wins DESC, u.username
          LIMIT ?`
      )
      .all(limit);
    res.json({ period, leaderboard: rows.map((r, i) => ({ rank: i + 1, ...r })) });
  });

  router.get('/me/history', auth.requireAuth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT g.code, g.category, g.ended_at AS endedAt, gp.score, gp.rank, gp.correct_count AS correctCount,
                g.question_count AS questionCount,
                (SELECT COUNT(*) FROM game_players WHERE game_id = g.id) AS playerCount
           FROM game_players gp
           JOIN games g ON g.id = gp.game_id AND g.status = 'finished'
          WHERE gp.user_id = ?
          ORDER BY g.ended_at DESC, g.id DESC
          LIMIT 50`
      )
      .all(req.user.id);
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(score),0) AS totalScore, COUNT(*) AS gamesPlayed,
                COALESCE(SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END),0) AS wins
           FROM game_players WHERE user_id = ?`
      )
      .get(req.user.id);
    res.json({ totals, games: rows });
  });

  return router;
}
