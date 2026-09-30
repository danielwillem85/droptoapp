import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import {
  RateLimiter,
  SESSION_COOKIE,
  clearedSessionCookie,
  createSession,
  deleteSession,
  dummyPasswordHash,
  hashPassword,
  normalizeEmail,
  parseCookies,
  sessionCookie,
  userForSession,
  validateRegistration,
  verifyPassword,
} from './auth';
import { subscribeToNewsletter } from './brevo';
import type { Config } from './config';
import type { Db, UserRow } from './db';

const LOGIN_TEMPLATE = resolve(import.meta.dirname, 'login.html');
/** Public files (images for the landing page and link previews), served without logging in at /static/. */
const PUBLIC_DIR = resolve(import.meta.dirname, 'public');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  newsletter: boolean;
}

const publicUser = (u: UserRow): PublicUser => ({ id: u.id, email: u.email, name: u.name, newsletter: u.newsletter === 1 });

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Only allow redirects to paths on this site (no //evil.com, no loops back to /login). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) return '/';
  return next;
}

export interface AppOptions {
  fetchImpl?: typeof fetch;
}

export function createApp(cfg: Config, db: Db, opts: AppOptions = {}) {
  const authLimiter = new RateLimiter(10, 15 * 60 * 1000); // per IP, login + register
  const emailLimiter = new RateLimiter(10, 15 * 60 * 1000); // per email, login
  const background = new Set<Promise<unknown>>();
  const loginTemplate = readFileSync(LOGIN_TEMPLATE, 'utf8').replace(
    '{{NEWSLETTER_CHECKED}}',
    cfg.newsletterCheckedByDefault ? 'checked' : '',
  );

  /** The site's public address: SITE_URL, or else worked out from the request. */
  function siteUrl(req: IncomingMessage) {
    if (cfg.siteUrl) return cfg.siteUrl;
    const host = String(req.headers.host ?? 'localhost').replace(/[^\w.:\-\[\]]/g, '');
    const forwarded = cfg.trustProxy ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() : '';
    const proto = forwarded === 'https' || forwarded === 'http' ? forwarded : cfg.cookieSecure ? 'https' : 'http';
    return `${proto}://${host}`;
  }

  const landingPage = (req: IncomingMessage) => loginTemplate.replaceAll('{{SITE_URL}}', siteUrl(req));

  const clientIp = (req: IncomingMessage) =>
    (cfg.trustProxy && (req.headers['x-real-ip'] as string)) || req.socket.remoteAddress || 'unknown';

  function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string | string[]> = {}) {
    res.writeHead(status, {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      ...headers,
    });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }

  const json = (res: ServerResponse, status: number, data: unknown, headers: Record<string, string | string[]> = {}) =>
    send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    // Requiring a JSON body means plain HTML forms on other sites can't post here (CSRF), together with SameSite cookies.
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Expected JSON.');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 16 * 1024) throw new HttpError(413, 'Request too large.');
      chunks.push(chunk as Buffer);
    }
    try {
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Invalid JSON.');
    }
  }

  function startSession(res: ServerResponse, user: UserRow, status: number) {
    const { token, expires } = createSession(db, user.id, cfg.sessionDays);
    json(res, status, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, expires, cfg.cookieSecure) });
  }

  // -------------------------------------------------------------- API

  async function api(req: IncomingMessage, res: ServerResponse, path: string, token: string | undefined, user: UserRow | null) {
    const route = `${req.method} ${path}`;

    if (route === 'GET /api/me') return user ? json(res, 200, { user: publicUser(user) }) : json(res, 401, { error: 'Not logged in.' });

    if (route === 'POST /api/logout') {
      deleteSession(db, token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': clearedSessionCookie(cfg.cookieSecure) });
    }

    if (route === 'POST /api/register') {
      if (!authLimiter.allow(clientIp(req))) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const problem = validateRegistration({ email, password: body.password, name: body.name });
      if (problem) throw new HttpError(400, problem);
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
        throw new HttpError(409, 'An account with this email already exists. Please log in instead.');
      const newsletter = body.newsletter === true;
      const hash = await hashPassword(body.password as string);
      const info = db
        .prepare(
          `INSERT INTO users (email, name, password_hash, newsletter, newsletter_at)
           VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END)`,
        )
        .run(email, name, hash, newsletter ? 1 : 0, newsletter ? 1 : 0);
      const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as unknown as UserRow;
      if (newsletter) {
        // Don't keep the new user waiting for Brevo; record the outcome on their row.
        const task = subscribeToNewsletter(cfg.brevo, { email, name }, opts.fetchImpl).then((r) => {
          db.prepare('UPDATE users SET brevo_status = ? WHERE id = ?').run(r.status, created.id);
          if (!r.ok) console.warn(`[brevo] ${email}: ${r.status}`);
        });
        background.add(task);
        task.finally(() => background.delete(task));
      }
      return startSession(res, created, 201);
    }

    if (route === 'POST /api/login') {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      if (!authLimiter.allow(clientIp(req)) || !emailLimiter.allow(email))
        throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
      const found = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as UserRow | undefined;
      const password = typeof body.password === 'string' ? body.password : '';
      // Compare against a dummy hash for unknown emails so response times don't reveal which accounts exist.
      const ok = await verifyPassword(password, found?.password_hash ?? (await dummyPasswordHash()));
      if (!found || !ok) throw new HttpError(401, 'Invalid email or password.');
      return startSession(res, found, 200);
    }

    throw new HttpError(404, 'Not found.');
  }

  // -------------------------------------------------------------- the editor (static files)

  function serveEditor(res: ServerResponse, path: string) {
    if (!existsSync(join(cfg.distDir, 'index.html')))
      return send(res, 503, 'The editor has not been built yet. Run "npm run build" (or use "npm run dev" while developing).', {
        'Content-Type': 'text/plain; charset=utf-8',
      });
    let file = normalize(join(cfg.distDir, decodeURIComponent(path)));
    if (!file.startsWith(cfg.distDir + sep) && file !== cfg.distDir) throw new HttpError(400, 'Bad path.');
    let isFile = existsSync(file) && statSync(file).isFile();
    if (!isFile) {
      if (extname(path)) throw new HttpError(404, 'Not found.');
      file = join(cfg.distDir, 'index.html'); // client-side routes
      isFile = true;
    }
    const isIndex = file.endsWith(`${sep}index.html`);
    send(res, 200, readFileSync(file), {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': isIndex ? 'no-cache' : path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }

  function sendLanding(req: IncomingMessage, res: ServerResponse) {
    // "/" is the landing page or the editor depending on the session cookie, so caches must not mix them up.
    return send(res, 200, landingPage(req), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Cookie',
    });
  }

  function servePublic(res: ServerResponse, name: string) {
    // Flat folder, plain file names only: no sub-folders, no "..".
    if (!/^[\w-]+\.[a-z0-9]+$/i.test(name)) throw new HttpError(404, 'Not found.');
    const file = join(PUBLIC_DIR, name);
    if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'Not found.');
    send(res, 200, readFileSync(file), {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    });
  }

  // -------------------------------------------------------------- request handler

  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = userForSession(db, token);

      if (path.startsWith('/api/')) return await api(req, res, path, token, user);

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

      // Public pages and files, the same for everyone.
      if (path === '/robots.txt')
        return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        });
      if (path === '/sitemap.xml')
        return send(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${siteUrl(req)}/</loc></url>\n</urlset>\n`,
          { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        );
      if (path.startsWith('/static/')) return servePublic(res, path.slice('/static/'.length));

      // Logged-out visitors get the landing page (with the login and registration form) at / and /login.
      if (path === '/login') {
        if (user) return send(res, 302, '', { Location: safeNext(url.searchParams.get('next')) });
        return sendLanding(req, res);
      }
      if (path === '/' && !user) return sendLanding(req, res);

      // Everything else is the editor: logged-in users only.
      if (!user) {
        const wantsPage = !extname(path) || String(req.headers.accept ?? '').includes('text/html');
        if (wantsPage) {
          const next = path === '/' && !url.search ? '' : `?next=${encodeURIComponent(path + url.search)}`;
          return send(res, 302, '', { Location: `/login${next}`, 'Cache-Control': 'no-store' });
        }
        throw new HttpError(401, 'Please log in.');
      }
      return serveEditor(res, path);
    } catch (e) {
      if (e instanceof HttpError) {
        if (req.url?.startsWith('/api/')) return json(res, e.status, { error: e.message });
        return send(res, e.status, e.message, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  return {
    handle,
    /** Resolves when background work (Brevo calls) has finished. Used by tests and on shutdown. */
    idle: () => Promise.all([...background]),
  };
}
