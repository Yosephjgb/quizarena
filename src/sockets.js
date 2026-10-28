import { z } from 'zod';
import { GameError } from './game/manager.js';

// Every socket event is validated just like a REST route — sockets are an attack surface too.
const schemas = {
  'game:create': z.object({
    category: z.string().trim().min(1).max(40).optional(),
    count: z.number().int().min(1).max(30).default(10),
    hostPlays: z.boolean().default(false),
  }),
  'room:join': z.object({ code: z.string().trim().length(6) }),
  'game:start': z.object({}).optional(),
  'room:leave': z.object({}).optional(),
  'answer:submit': z.object({ choice: z.number().int().min(0).max(3) }),
};

// Minimal Cookie-header parser (avoids depending on a library whose API changes between versions).
function parseCookie(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!(key in out)) {
      try {
        out[key] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        out[key] = part.slice(i + 1).trim();
      }
    }
  }
  return out;
}

const WINDOW_MS = 5000;
const MAX_EVENTS_PER_WINDOW = 25;

export function attachSockets(io, { games, auth }) {
  // Authenticate during the handshake using the same httpOnly cookie as the REST API.
  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie || '');
    const user = auth.userFromToken(cookies[auth.COOKIE]);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`); // lets us reach/kick all of a user's tabs
    games.reattach(user, socket);

    // Simple per-socket rate limit (anti-spam / anti-flood).
    let windowStart = Date.now();
    let count = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart > WINDOW_MS) {
        windowStart = now;
        count = 0;
      }
      return ++count <= MAX_EVENTS_PER_WINDOW;
    };

    // Wrap each handler: rate-limit -> validate -> run -> ack({ ok, ... }).
    const handle = (event, fn) => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          if (!allowed()) throw new GameError('Slow down!');
          const data = schemas[event].parse(payload ?? {});
          reply({ ok: true, ...(fn(data) || {}) });
        } catch (err) {
          if (err instanceof GameError) return reply({ ok: false, error: err.message });
          if (err instanceof z.ZodError) return reply({ ok: false, error: 'Invalid request.' });
          console.error(`socket ${event} failed`, err);
          reply({ ok: false, error: 'Something went wrong.' });
        }
      });
    };

    handle('game:create', (d) => games.create(user, socket, d));
    handle('room:join', (d) => games.join(user, socket, d));
    handle('game:start', () => games.start(user));
    handle('room:leave', () => games.leave(user, socket));
    handle('answer:submit', (d) => games.submitAnswer(user, d));

    socket.on('disconnect', () => games.detach(user));
  });
}
