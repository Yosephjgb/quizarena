import { calculateScore, rankPlayers } from './scoring.js';
import { mapQuestion } from '../db.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid typos
const GRACE_MS = 400; // network slack after the timer ends
const LOBBY_TTL_MS = 30 * 60 * 1000;
const MAX_PLAYERS = 50;

export class GameError extends Error {}

/**
 * Owns all live games. State lives in memory (fast, simple) and finished games
 * are written to the database. If the server restarts, live games are lost —
 * see README "Scaling" for how to fix that with Redis.
 *
 * game = {
 *   code, hostId, hostName, dbId, category, status: 'lobby'|'question'|'reveal'|'ended',
 *   questions: [{id,text,options,correctIndex,timeLimit}], qIndex,
 *   questionStartedAt, endsAt, timer, lastResult, createdAt,
 *   players: Map<userId, {userId, username, score, correctCount, lastGain, connected, current}>
 * }
 */
export class GameManager {
  constructor({ io, db, revealMs = 4000 }) {
    this.io = io;
    this.db = db;
    this.revealMs = revealMs;
    this.games = new Map(); // code -> game
    this.userGame = new Map(); // userId -> code
    this.stopped = false;
    this.sweeper = setInterval(() => this.sweepLobbies(), 60_000);
    this.sweeper.unref();
  }

  liveCount() {
    return this.games.size;
  }

  // ---------- helpers ----------
  makeCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.games.has(code)) return code;
    }
  }

  playerList(game) {
    return [...game.players.values()].map((p) => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
      connected: p.connected,
    }));
  }

  leaderboard(game) {
    return rankPlayers([...game.players.values()]).map((p) => ({
      userId: p.userId,
      username: p.username,
      score: p.score,
      correctCount: p.correctCount,
      lastGain: p.lastGain,
      rank: p.rank,
    }));
  }

  state(game) {
    return {
      code: game.code,
      status: game.status,
      hostId: game.hostId,
      hostName: game.hostName,
      hostPlays: Boolean(game.hostPlays),
      category: game.category,
      total: game.questions.length,
      players: this.playerList(game),
    };
  }

  publicQuestion(game) {
    const q = game.questions[game.qIndex];
    return {
      index: game.qIndex,
      total: game.questions.length,
      text: q.text,
      options: q.options, // NOTE: correctIndex is never sent before the reveal
      timeLimit: q.timeLimit,
      endsAt: game.endsAt,
      serverNow: Date.now(),
    };
  }

  broadcastState(game) {
    this.io.to(game.code).emit('room:state', this.state(game));
  }

  /** Everything a (re)connecting client needs to draw the current screen. */
  snapshot(game, userId) {
    const snap = { ...this.state(game) };
    if (game.status === 'question') {
      snap.question = this.publicQuestion(game);
      snap.answered = !!game.players.get(userId)?.current;
      snap.answerCount = this.answerCount(game);
    }
    if (game.status === 'reveal') snap.result = game.lastResult;
    return snap;
  }

  answerCount(game) {
    const all = [...game.players.values()];
    return { answered: all.filter((p) => p.current).length, total: all.length };
  }

  getGameFor(userId) {
    const code = this.userGame.get(userId);
    return code ? this.games.get(code) : undefined;
  }

  // ---------- lobby ----------
  create(user, socket, { category, count, hostPlays = false }) {
    if (this.userGame.has(user.id)) {
      throw new GameError("You're already in a game. Leave it first.");
    }
    const rows = category
      ? this.db.prepare('SELECT * FROM questions WHERE category = ? ORDER BY RANDOM() LIMIT ?').all(category, count)
      : this.db.prepare('SELECT * FROM questions ORDER BY RANDOM() LIMIT ?').all(count);
    if (!rows.length) throw new GameError('There are no questions for that category yet.');

    const code = this.makeCode();
    const info = this.db
      .prepare('INSERT INTO games (code, host_id, status, category, question_count) VALUES (?,?,?,?,?)')
      .run(code, user.id, 'lobby', category ?? null, rows.length);

    const game = {
      code,
      hostId: user.id,
      hostName: user.username,
      hostPlays: Boolean(hostPlays),
      dbId: info.lastInsertRowid,
      category: category ?? null,
      status: 'lobby',
      questions: rows.map(mapQuestion),
      qIndex: -1,
      questionStartedAt: 0,
      endsAt: 0,
      timer: null,
      lastResult: null,
      createdAt: Date.now(),
      players: new Map(),
    };
    if (hostPlays) {
      game.players.set(user.id, {
        userId: user.id,
        username: user.username,
        score: 0,
        correctCount: 0,
        lastGain: 0,
        connected: true,
        current: null,
      });
    }
    this.games.set(code, game);
    this.userGame.set(user.id, code);
    socket.join(code);
    this.broadcastState(game);
    return { code, snapshot: this.snapshot(game, user.id) };
  }

  join(user, socket, { code }) {
    code = code.toUpperCase();
    const game = this.games.get(code);
    if (!game) throw new GameError('No game with that code.');

    const existing = this.userGame.get(user.id);
    if (existing && existing !== code) throw new GameError("You're already in another game.");

    if (game.hostId === user.id) {
      const player = game.players.get(user.id);
      if (player) {
        player.connected = true;
        this.broadcastState(game);
      }
      socket.join(code);
      return { code, snapshot: this.snapshot(game, user.id) };
    }

    let player = game.players.get(user.id);
    if (!player) {
      if (game.status !== 'lobby') throw new GameError('That game has already started.');
      if (game.players.size >= MAX_PLAYERS) throw new GameError('That game is full.');
      player = {
        userId: user.id,
        username: user.username,
        score: 0,
        correctCount: 0,
        lastGain: 0,
        connected: true,
        current: null,
      };
      game.players.set(user.id, player);
      this.userGame.set(user.id, code);
    }
    player.connected = true;
    socket.join(code);
    this.broadcastState(game);
    return { code, snapshot: this.snapshot(game, user.id) };
  }

  /** Called on every new socket connection: put returning users back into their game. */
  reattach(user, socket) {
    const game = this.getGameFor(user.id);
    if (!game) return;
    socket.join(game.code);
    const player = game.players.get(user.id);
    if (player) player.connected = true;
    this.broadcastState(game);
    socket.emit('room:rejoined', this.snapshot(game, user.id));
  }

  /** Called when a user's last socket closes. */
  detach(user) {
    if (this.stopped) return;
    const game = this.getGameFor(user.id);
    if (!game) return;
    const stillConnected = this.io.sockets.adapter.rooms.get(`user:${user.id}`)?.size > 0;
    if (stillConnected) return; // they have another tab open
    const player = game.players.get(user.id);
    if (player) {
      player.connected = false;
      this.broadcastState(game);
      // If the missing player was the last one we were waiting on, move on.
      if (game.status === 'question') this.maybeCloseEarly(game);
    }
  }

  leave(user, socket) {
    const game = this.getGameFor(user.id);
    if (!game) return;
    if (game.status !== 'lobby' && game.status !== 'ended') {
      throw new GameError("You can't leave a game that's in progress.");
    }
    if (game.hostId === user.id) return this.cancel(game, 'The host left the game.');
    game.players.delete(user.id);
    this.userGame.delete(user.id);
    socket.leave(game.code);
    this.broadcastState(game);
  }

  /** Admin banned someone: remove them from the live game and kill their sockets. */
  kickUser(userId) {
    const game = this.getGameFor(userId);
    if (game) {
      if (game.hostId === userId) this.cancel(game, 'The host was removed.');
      else {
        game.players.delete(userId);
        this.userGame.delete(userId);
        if (game.status === 'question') this.maybeCloseEarly(game);
        this.broadcastState(game);
      }
    }
    this.io.in(`user:${userId}`).disconnectSockets(true);
  }

  // ---------- gameplay ----------
  start(user) {
    const game = this.getGameFor(user.id);
    if (!game || game.hostId !== user.id) throw new GameError('Only the host can start the game.');
    if (game.status !== 'lobby') throw new GameError('The game has already started.');
    if (game.players.size < 1) throw new GameError('Wait for at least one player to join.');
    this.db.prepare("UPDATE games SET status='playing', started_at=datetime('now') WHERE id=?").run(game.dbId);
    this.nextQuestion(game);
  }

  nextQuestion(game) {
    if (this.stopped) return;
    game.qIndex += 1;
    if (game.qIndex >= game.questions.length) return this.finish(game);

    const q = game.questions[game.qIndex];
    for (const p of game.players.values()) {
      p.current = null;
      p.lastGain = 0;
    }
    game.status = 'question';
    game.questionStartedAt = Date.now();
    game.endsAt = game.questionStartedAt + q.timeLimit * 1000;
    game.lastResult = null;
    this.io.to(game.code).emit('question:show', this.publicQuestion(game));
    this.broadcastState(game);
    game.timer = setTimeout(() => this.closeQuestion(game), q.timeLimit * 1000 + GRACE_MS);
  }

  submitAnswer(user, { choice }) {
    const game = this.getGameFor(user.id);
    const player = game?.players.get(user.id);
    if (!game || !player) throw new GameError("You're not playing in a game.");
    if (game.status !== 'question') throw new GameError('No question is open right now.');
    if (player.current) throw new GameError('You already answered.');

    const q = game.questions[game.qIndex];
    if (choice >= q.options.length) throw new GameError('Invalid option.');

    const now = Date.now();
    if (now > game.endsAt + GRACE_MS) throw new GameError('Too late!');

    // The SERVER measures time and decides correctness. The client only says "I picked #choice".
    const elapsedMs = now - game.questionStartedAt;
    const correct = choice === q.correctIndex;
    const gained = calculateScore({ correct, elapsedMs, timeLimitMs: q.timeLimit * 1000 });
    player.current = { choice, correct, gained, elapsedMs };

    this.io.to(game.code).emit('answer:count', this.answerCount(game));
    this.maybeCloseEarly(game);
    return { locked: true };
  }

  maybeCloseEarly(game) {
    if (game.status !== 'question') return;
    const active = [...game.players.values()].filter((p) => p.connected);
    // Everyone still connected has answered -> don't wait for the timer.
    // If nobody is connected we just let the timer run, so people have a chance to reconnect.
    if (active.length > 0 && active.every((p) => p.current)) this.closeQuestion(game);
  }

  closeQuestion(game) {
    if (this.stopped || game.status !== 'question') return; // stopped, or already closed (timer + early close race)
    clearTimeout(game.timer);
    const q = game.questions[game.qIndex];

    for (const p of game.players.values()) {
      if (p.current) {
        p.score += p.current.gained;
        p.lastGain = p.current.gained;
        if (p.current.correct) p.correctCount += 1;
      } else {
        p.lastGain = 0;
      }
    }
    game.status = 'reveal';
    game.lastResult = {
      index: game.qIndex,
      total: game.questions.length,
      text: q.text,
      options: q.options,
      correctIndex: q.correctIndex,
      leaderboard: this.leaderboard(game),
      choices: [...game.players.values()].map((p) => ({
        userId: p.userId,
        choice: p.current ? p.current.choice : null,
        correct: p.current ? p.current.correct : false,
      })),
    };
    this.io.to(game.code).emit('question:result', game.lastResult);
    this.broadcastState(game);
    game.timer = setTimeout(() => this.nextQuestion(game), this.revealMs);
  }

  finish(game) {
    game.status = 'ended';
    clearTimeout(game.timer);
    const board = this.leaderboard(game);

    // Persist results atomically: either the whole game is saved or none of it.
    const save = this.db.transaction(() => {
      this.db.prepare("UPDATE games SET status='finished', ended_at=datetime('now') WHERE id=?").run(game.dbId);
      const insert = this.db.prepare(
        'INSERT INTO game_players (game_id, user_id, score, correct_count, rank) VALUES (?,?,?,?,?)'
      );
      for (const p of board) insert.run(game.dbId, p.userId, p.score, p.correctCount, p.rank);
    });
    try {
      save();
    } catch (err) {
      console.error('Failed to save game results', err);
    }

    this.io.to(game.code).emit('game:end', { code: game.code, leaderboard: board });
    this.dispose(game);
  }

  cancel(game, reason) {
    clearTimeout(game.timer);
    this.db
      .prepare("UPDATE games SET status='abandoned', ended_at=datetime('now') WHERE id=? AND status != 'finished'")
      .run(game.dbId);
    this.io.to(game.code).emit('game:cancelled', { reason });
    this.dispose(game);
  }

  dispose(game) {
    this.games.delete(game.code);
    this.userGame.delete(game.hostId);
    for (const id of game.players.keys()) this.userGame.delete(id);
    this.io.in(game.code).socketsLeave(game.code);
  }

  sweepLobbies() {
    const now = Date.now();
    for (const game of [...this.games.values()]) {
      if (game.status === 'lobby' && now - game.createdAt > LOBBY_TTL_MS) {
        this.cancel(game, 'The lobby expired.');
      }
    }
  }

  shutdown() {
    this.stopped = true;
    clearInterval(this.sweeper);
    for (const game of this.games.values()) clearTimeout(game.timer);
  }
}
