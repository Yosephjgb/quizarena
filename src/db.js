import { DatabaseSync } from 'node:sqlite'; // built into Node 22+, no native build step
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  banned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  text          TEXT NOT NULL,
  options       TEXT NOT NULL,              -- JSON array of strings
  correct_index INTEGER NOT NULL,
  category      TEXT NOT NULL DEFAULT 'General',
  time_limit    INTEGER NOT NULL DEFAULT 20, -- seconds
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);

CREATE TABLE IF NOT EXISTS games (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL,
  host_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'lobby', -- lobby | playing | finished | abandoned
  category       TEXT,
  question_count INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  started_at     TEXT,
  ended_at       TEXT
);

CREATE TABLE IF NOT EXISTS game_players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score         INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  rank          INTEGER NOT NULL,
  UNIQUE (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  // Small helper: db.transaction(fn) returns a function that runs fn atomically (all or nothing).
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

export function mapQuestion(row) {
  return {
    id: row.id,
    text: row.text,
    options: JSON.parse(row.options),
    correctIndex: row.correct_index,
    category: row.category,
    timeLimit: row.time_limit,
    createdAt: row.created_at,
  };
}
