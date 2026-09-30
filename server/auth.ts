import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db, UserRow } from './db';

// ------------------------------------------------------------------ passwords

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Hash a password as `scrypt$N$r$p$salt$hash` (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to compare against when the email is unknown, so both cases take the same time. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

// ------------------------------------------------------------------ validation

export const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function validateRegistration(input: { email: string; password: unknown; name: unknown }): string | null {
  if (!EMAIL.test(input.email) || input.email.length > 254) return 'Please enter a valid email address.';
  if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD)
    return `The password must be at least ${MIN_PASSWORD} characters.`;
  if (input.password.length > 200) return 'The password is too long.';
  if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 100)) return 'The name is too long.';
  return null;
}

// ------------------------------------------------------------------ sessions

/** Named after the app's first name (TruthEditor); kept so existing log-ins stay valid. */
export const SESSION_COOKIE = 'te_session';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: Db, userId: number, days: number): { token: string; expires: Date } {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires.getTime());
  return { token, expires };
}

export function userForSession(db: Db, token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as UserRow | undefined;
  return row ?? null;
}

export function deleteSession(db: Db, token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function purgeExpiredSessions(db: Db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

// ------------------------------------------------------------------ rate limiting

/** A simple in-memory limiter: at most `max` attempts per `windowMs` per key. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Record an attempt; returns false when the key is over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

// ------------------------------------------------------------------ cookies

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, expires: Date, secure: boolean): string {
  return [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expires.toUTCString()}`, secure ? 'Secure' : '']
    .filter(Boolean)
    .join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', secure ? 'Secure' : ''].filter(Boolean).join('; ');
}
