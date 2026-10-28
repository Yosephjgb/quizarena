import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, addQuestions, emitAck, once, waitConnected } from './helpers.js';

let ctx;
before(async () => {
  ctx = await startTestApp();
  addQuestions(ctx.db, 3);
});
after(() => ctx.close());

async function signup(name) {
  const c = ctx.client();
  const r = await c.req('POST', '/api/auth/register', { email: `${name}@t.dev`, username: name, password: 'password123' });
  assert.equal(r.status, 201);
  const socket = c.socket();
  await waitConnected(socket);
  return { c, socket, id: r.body.user.id, name };
}

test('sockets reject unauthenticated connections', async () => {
  const socket = ctx.client().socket();
  await assert.rejects(waitConnected(socket), /unauthorized/);
  socket.close();
});

test('full game: host + 2 players, server-side scoring, results saved, leaderboard updated', async () => {
  const host = await signup('hosty');
  const ann = await signup('ann');
  const bob = await signup('bob');

  const created = await emitAck(host.socket, 'game:create', { count: 3 });
  assert.ok(created.ok, created.error);
  const code = created.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);

  assert.ok((await emitAck(ann.socket, 'room:join', { code })).ok);
  assert.ok((await emitAck(bob.socket, 'room:join', { code: code.toLowerCase() })).ok, 'codes are case-insensitive');

  // Only the host can start
  assert.equal((await emitAck(ann.socket, 'game:start', {})).ok, false);

  const gameEnd = once(ann.socket, 'game:end', 15000);
  let sawCorrectIndexLeak = false;
  ann.socket.on('question:show', (q) => { if ('correctIndex' in q) sawCorrectIndexLeak = true; });

  // Players answer every question: ann always right (index 1), bob always wrong.
  let questionsSeen = 0;
  const play = (p, choice) => p.socket.on('question:show', async () => {
    questionsSeen++;
    const r = await emitAck(p.socket, 'answer:submit', { choice });
    assert.ok(r.ok, r.error);
    // second answer to the same question must be rejected
    assert.equal((await emitAck(p.socket, 'answer:submit', { choice })).ok, false);
  });
  play(ann, 1);
  play(bob, 0);

  assert.ok((await emitAck(host.socket, 'game:start', {})).ok);
  const end = await gameEnd;

  assert.equal(questionsSeen, 6);
  assert.equal(sawCorrectIndexLeak, false, 'correct answer must never be sent before the reveal');
  assert.equal(end.leaderboard[0].username, 'ann');
  assert.equal(end.leaderboard[0].rank, 1);
  assert.ok(end.leaderboard[0].score > 1400 && end.leaderboard[0].score <= 3000);
  assert.equal(end.leaderboard.find((p) => p.username === 'bob').score, 0);

  // persisted
  const game = ctx.db.prepare("SELECT * FROM games WHERE code = ?").get(code);
  assert.equal(game.status, 'finished');
  const rows = ctx.db.prepare('SELECT * FROM game_players WHERE game_id = ?').all(game.id);
  assert.equal(rows.length, 2);

  // leaderboard endpoint
  const lb = await ctx.client().req('GET', '/api/leaderboard');
  assert.equal(lb.body.leaderboard[0].username, 'ann');
  assert.equal(lb.body.leaderboard[0].wins, 1);

  // history endpoint
  const hist = await ann.c.req('GET', '/api/me/history');
  assert.equal(hist.body.games.length, 1);
  assert.equal(hist.body.totals.gamesPlayed, 1);

  // users are free again
  assert.ok((await emitAck(ann.socket, 'game:create', { count: 1 })).ok);
  for (const p of [host, ann, bob]) p.socket.close();
});

test('cannot join unknown or started games; invalid payloads are rejected', async () => {
  const host = await signup('host2');
  const late = await signup('late');
  assert.equal((await emitAck(late.socket, 'room:join', { code: 'ZZZZZZ' })).ok, false);
  assert.equal((await emitAck(late.socket, 'room:join', { code: 'x' })).ok, false);
  assert.equal((await emitAck(host.socket, 'game:create', { count: 9999 })).ok, false);
  assert.equal((await emitAck(host.socket, 'game:create', { category: 'Nope', count: 3 })).ok, false);
  host.socket.close(); late.socket.close();
});

test('a player who disconnects mid-game can reconnect and resume', async () => {
  const host = await signup('host3');
  const rita = await signup('rita');
  const { code } = await emitAck(host.socket, 'game:create', { count: 2 });
  await emitAck(rita.socket, 'room:join', { code });

  const firstQuestion = once(rita.socket, 'question:show');
  await emitAck(host.socket, 'game:start', {});
  await firstQuestion;

  rita.socket.close();
  await new Promise((r) => setTimeout(r, 100));

  const back = rita.c.socket();
  const rejoined = once(back, 'room:rejoined');
  await waitConnected(back);
  const snap = await rejoined;
  assert.equal(snap.code, code);
  assert.equal(snap.status, 'question');
  assert.equal(snap.question.index, 0);
  assert.equal(snap.answered, false);
  assert.equal('correctIndex' in snap.question, false);

  assert.ok((await emitAck(back, 'answer:submit', { choice: 1 })).ok, 'can still answer after reconnecting');
  host.socket.close(); back.close();
});

test('host can play: host + 1 player, host answers and gets scored on leaderboard', async () => {
  const host = await signup('host_player');
  const player = await signup('regular_player');

  const created = await emitAck(host.socket, 'game:create', { count: 2, hostPlays: true });
  assert.ok(created.ok, created.error);
  const code = created.code;

  assert.ok((await emitAck(player.socket, 'room:join', { code })).ok);

  const gameEnd = once(host.socket, 'game:end', 15000);

  // Both host and player answer
  const play = (p, choice) => p.socket.on('question:show', async () => {
    const r = await emitAck(p.socket, 'answer:submit', { choice });
    assert.ok(r.ok, r.error);
  });
  play(host, 1);
  play(player, 0);

  assert.ok((await emitAck(host.socket, 'game:start', {})).ok);
  const end = await gameEnd;

  assert.equal(end.leaderboard.length, 2);
  assert.equal(end.leaderboard[0].username, 'host_player');
  assert.equal(end.leaderboard[0].rank, 1);
  assert.ok(end.leaderboard[0].score > 0);

  // Persisted in database
  const game = ctx.db.prepare('SELECT * FROM games WHERE code = ?').get(code);
  const rows = ctx.db.prepare('SELECT * FROM game_players WHERE game_id = ?').all(game.id);
  assert.equal(rows.length, 2);

  for (const p of [host, player]) p.socket.close();
});

test('solo game: host plays alone with hostPlays: true', async () => {
  const host = await signup('solo_host');
  const created = await emitAck(host.socket, 'game:create', { count: 1, hostPlays: true });
  assert.ok(created.ok, created.error);

  const gameEnd = once(host.socket, 'game:end', 15000);
  host.socket.on('question:show', async () => {
    const r = await emitAck(host.socket, 'answer:submit', { choice: 1 });
    assert.ok(r.ok, r.error);
  });

  assert.ok((await emitAck(host.socket, 'game:start', {})).ok);
  const end = await gameEnd;
  assert.equal(end.leaderboard.length, 1);
  assert.equal(end.leaderboard[0].username, 'solo_host');
  host.socket.close();
});
