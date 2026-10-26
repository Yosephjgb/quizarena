import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, rankPlayers } from '../src/game/scoring.js';

test('wrong answers score 0', () => {
  assert.equal(calculateScore({ correct: false, elapsedMs: 0, timeLimitMs: 10000 }), 0);
});

test('instant correct answer scores 1000', () => {
  assert.equal(calculateScore({ correct: true, elapsedMs: 0, timeLimitMs: 10000 }), 1000);
});

test('correct answer at the deadline scores 500', () => {
  assert.equal(calculateScore({ correct: true, elapsedMs: 10000, timeLimitMs: 10000 }), 500);
});

test('halfway through the timer scores 750', () => {
  assert.equal(calculateScore({ correct: true, elapsedMs: 5000, timeLimitMs: 10000 }), 750);
});

test('negative or overlong elapsed time is clamped', () => {
  assert.equal(calculateScore({ correct: true, elapsedMs: -50, timeLimitMs: 10000 }), 1000);
  assert.equal(calculateScore({ correct: true, elapsedMs: 99999, timeLimitMs: 10000 }), 500);
});

test('ranking uses competition ranking for ties', () => {
  const ranked = rankPlayers([
    { username: 'a', score: 100, correctCount: 1 },
    { username: 'b', score: 300, correctCount: 2 },
    { username: 'c', score: 100, correctCount: 1 },
    { username: 'd', score: 0, correctCount: 0 },
  ]);
  assert.deepEqual(ranked.map((p) => [p.username, p.rank]), [['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
});
