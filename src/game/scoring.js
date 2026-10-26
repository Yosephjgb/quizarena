export const BASE_POINTS = 1000;

/**
 * Points for one answer. Computed ONLY on the server.
 * - wrong answer or no answer: 0
 * - correct and instant: 1000
 * - correct at the very end of the timer: 500 (linear in between)
 */
export function calculateScore({ correct, elapsedMs, timeLimitMs }) {
  if (!correct) return 0;
  const limit = Math.max(1, timeLimitMs);
  const ratio = Math.min(Math.max(elapsedMs / limit, 0), 1);
  return Math.round(BASE_POINTS * (1 - ratio / 2));
}

/** Competition ranking: equal scores share a rank (1, 2, 2, 4). */
export function rankPlayers(players) {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || b.correctCount - a.correctCount || a.username.localeCompare(b.username)
  );
  let lastScore = null;
  let lastRank = 0;
  return sorted.map((p, i) => {
    const rank = p.score === lastScore ? lastRank : i + 1;
    lastScore = p.score;
    lastRank = rank;
    return { ...p, rank };
  });
}
