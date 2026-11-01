import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  newsletter: number;
  newsletter_at: string | null;
  brevo_status: string | null;
  created_at: string;
}

export type Db = DatabaseSync;

/** Open (and create or migrate) the SQLite database. Use ':memory:' in tests. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      name          TEXT    NOT NULL DEFAULT '',
      password_hash TEXT    NOT NULL,
      newsletter    INTEGER NOT NULL DEFAULT 0,  -- 1 = ticked the newsletter box when registering
      newsletter_at TEXT,                        -- when that choice was made (UTC)
      brevo_status  TEXT,                        -- result of the Brevo call: 'subscribed', 'skipped: ...', 'error: ...'
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT    PRIMARY KEY,             -- sha256 of the cookie value; the cookie itself is never stored
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,                -- unix ms
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    -- Designs saved in the account ("My projects")
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT    PRIMARY KEY,             -- random, unguessable
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      data       TEXT    NOT NULL,                -- the design as JSON (format droptoapp/v1, incl. hand-written app.R)
      version    INTEGER NOT NULL DEFAULT 1,      -- +1 on every content change; used to detect edits elsewhere
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated_at);

    -- "Forgot your password?" links: single use, short-lived; only a hash of the token is stored
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT    PRIMARY KEY,             -- sha256 of the token in the emailed link
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,                -- unix ms
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
  `);
  return db;
}
