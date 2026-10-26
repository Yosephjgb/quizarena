import bcrypt from 'bcryptjs';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../src/app.js';

export async function startTestApp(overrides = {}) {
  const ctx = createApp({ dbPath: ':memory:', authRateMax: 1000, revealMs: 60, jwtSecret: 'test-secret', ...overrides });
  await new Promise((r) => ctx.server.listen(0, r));
  const base = `http://127.0.0.1:${ctx.server.address().port}`;

  // fetch wrapper that keeps a cookie jar per "browser"
  function client() {
    let cookie = '';
    return {
      async req(method, url, body) {
        const res = await fetch(base + url, {
          method,
          headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const set = res.headers.getSetCookie?.() ?? [];
        if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
        let json = null;
        try { json = await res.json(); } catch {}
        return { status: res.status, body: json };
      },
      get cookie() { return cookie; },
      socket() {
        return ioClient(base, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true });
      },
    };
  }
  return { ...ctx, base, client };
}

export function makeAdmin(db, email = 'boss@test.dev', username = 'boss', password = 'password123') {
  db.prepare("INSERT INTO users (email, username, password_hash, role) VALUES (?,?,?, 'admin')").run(
    email, username, bcrypt.hashSync(password, 4)
  );
  return { email, password };
}

export function addQuestions(db, n = 3, category = 'Test') {
  const ins = db.prepare('INSERT INTO questions (text, options, correct_index, category, time_limit) VALUES (?,?,?,?,?)');
  for (let i = 0; i < n; i++) ins.run(`Question ${i + 1}?`, JSON.stringify(['A', 'B', 'C', 'D']), 1, category, 5);
}

export const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

export const once = (socket, event, ms = 4000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (d) => { clearTimeout(t); resolve(d); });
  });

export const waitConnected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
