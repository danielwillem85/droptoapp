/**
 * "Forgot your password?": single-use links that expire after an hour. Only a hash of each
 * token is stored, so a copy of the database can't be used to reset passwords.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';

export const RESET_MINUTES = 60;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A new reset token for the user. Earlier links for the same account stop working. */
export function createResetToken(db: Db, userId: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at <= ?').run(userId, now);
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    now + RESET_MINUTES * 60_000,
  );
  return token;
}

/** Whether a token is valid right now, without using it up (for showing the form). */
export function resetTokenValid(db: Db, token: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return false;
  const row = db.prepare('SELECT expires_at FROM password_resets WHERE token_hash = ?').get(sha256(token)) as { expires_at: number } | undefined;
  return !!row && row.expires_at > now;
}

/** Use a token up: returns the user id when it was valid, null otherwise. Single use. */
export function consumeResetToken(db: Db, token: unknown, now = Date.now()): number | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const hash = sha256(token);
  const row = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').get(hash) as
    | { user_id: number; expires_at: number }
    | undefined;
  if (!row) return null;
  // Deleting is what makes it single use: of two requests at the same moment, only one deletes it.
  const { changes } = db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(hash);
  if (changes !== 1 || row.expires_at <= now) return null;
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
  return row.user_id;
}
