import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';

import { config } from './config.js';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { GameManager } from './game/manager.js';
import { attachSockets } from './sockets.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Builds the whole app. Tests call this with an in-memory DB. */
export function createApp(overrides = {}) {
  const cfg = { ...config, ...overrides };
  const db = openDb(cfg.dbPath);
  const auth = createAuth({ db, secret: cfg.jwtSecret, isProd: cfg.isProd });

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);
  app.use(helmet());
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());
  app.use(express.static(publicDir));

  const server = http.createServer(app);
  const io = new Server(server);
  const games = new GameManager({ io, db, revealMs: cfg.revealMs });

  app.use('/api/auth', authRoutes({ db, auth, authRateMax: cfg.authRateMax }));
  app.use('/api/admin', adminRoutes({ db, auth, games }));
  app.use('/api', publicRoutes({ db, auth }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler: never leak stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  attachSockets(io, { games, auth });

  async function close() {
    games.shutdown();
    await io.close(); // also closes the HTTP server
    server.closeAllConnections?.();
    db.close();
  }

  return { app, server, io, db, games, auth, close };
}
