import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { openDb, type Db } from '../server/db';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}
const mails: Mail[] = [];
/** Notices to NOTIFY_EMAILS (new accounts, logins). */
const notices: { to: string; subject: string; text: string }[] = [];
const fakeBrevo: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body));
  if (String(url).endsWith('/smtp/email') && /^(New DropToApp account|DropToApp login:)/.test(body.subject))
    notices.push({ to: body.to[0].email, subject: body.subject, text: body.textContent });
  // Only emails to users (not the notices to NOTIFY_EMAILS)
  else if (String(url).endsWith('/smtp/email'))
    mails.push({ to: body.to[0].email, subject: body.subject, text: body.textContent, html: body.htmlContent });
  return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
};

let db: Db;
let dist = '';
const servers: Server[] = [];
let app: ReturnType<typeof createApp>;
let base = '';

async function start(env: Record<string, string>) {
  const a = createApp(loadConfig({ DIST_DIR: dist, BREVO_API_KEY: 'xkeysib-test', ...env } as NodeJS.ProcessEnv), db, { fetchImpl: fakeBrevo });
  const srv = createServer((req, res) => void a.handle(req, res));
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const addr = srv.address();
  return { app: a, url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` };
}

before(async () => {
  dist = mkdtempSync(join(tmpdir(), 'te-dist-'));
  writeFileSync(join(dist, 'index.html'), 'EDITOR');
  db = openDb(':memory:');
  ({ app, url: base } = await start({ SITE_URL: 'https://droptoapp.example' }));
});

after(() => {
  servers.forEach((s) => s.close());
  db.close();
  rmSync(dist, { recursive: true, force: true });
});

let ip = 0;
const post = (path: string, body: unknown, cookie = '', url = base) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': `10.1.0.${++ip}`, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

async function register(email: string, password = 'old-password-1') {
  const res = await post('/api/register', { email, password, name: 'Ada' });
  assert.equal(res.status, 201);
  return cookieOf(res);
}
async function requestLink(email: string, url = base) {
  const before = mails.length;
  const res = await post('/api/password/forgot', { email }, '', url);
  await app.idle();
  return { res, mail: mails.length > before ? mails[mails.length - 1] : undefined };
}
const tokenIn = (mail: Mail) => new URL(mail.text.match(/https?:\/\/\S+reset-password\?token=\S+/)![0]).searchParams.get('token')!;

test('forgot password: an email with a single-use link, a new password, logged out elsewhere', async () => {
  const oldSession = await register('ada@example.com');
  const { res, mail } = await requestLink('  ADA@example.com ');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.ok(mail, 'email sent');
  assert.equal(mail.to, 'ada@example.com');
  assert.equal(mail.subject, 'Reset your DropToApp password');
  assert.match(mail.text, /^Hi Ada,/);
  assert.match(mail.text, /https:\/\/droptoapp\.example\/reset-password\?token=[\w-]{43}\b/, 'link from SITE_URL');
  assert.match(mail.text, /expires in 60 minutes/);
  assert.match(mail.html, /href="https:\/\/droptoapp\.example\/reset-password\?token=/);
  const token = tokenIn(mail);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE token_hash = ?').get(token) as { n: number }).n, 0, 'only a hash is stored');

  assert.deepEqual(await (await post('/api/password/check', { token })).json(), { valid: true });
  // A too-short password is refused without using up the link
  const short = await post('/api/password/reset', { token, password: 'short' });
  assert.equal(short.status, 400);
  assert.deepEqual(await (await post('/api/password/check', { token })).json(), { valid: true });

  const changed = mails.length;
  const ok = await post('/api/password/reset', { token, password: 'new-password-2' });
  assert.equal(ok.status, 200);
  const session = cookieOf(ok);
  assert.match(session, /^te_session=/, 'logged in');
  assert.equal((await fetch(base + '/api/me', { headers: { cookie: session } })).status, 200);
  assert.equal((await fetch(base + '/api/me', { headers: { cookie: oldSession } })).status, 401, 'other sessions logged out');
  await app.idle();
  assert.equal(mails.length, changed + 1);
  assert.equal(mails[mails.length - 1].subject, 'Your DropToApp password was changed');
  const notice = notices[notices.length - 1];
  assert.equal(notice.subject, 'DropToApp login: ada@example.com', 'logging in after a reset is reported too');
  assert.match(notice.text, /How: After resetting the password/);
  assert.match(mails[mails.length - 1].text, /https:\/\/droptoapp\.example\/login\?mode=forgot/);

  // Single use
  const again = await post('/api/password/reset', { token, password: 'third-password-3' });
  assert.equal(again.status, 400);
  assert.match(((await again.json()) as { error: string }).error, /expired or was already used/);
  assert.deepEqual(await (await post('/api/password/check', { token })).json(), { valid: false });
  // Old password no longer works, new one does
  assert.equal((await post('/api/login', { email: 'ada@example.com', password: 'old-password-1' })).status, 401);
  assert.equal((await post('/api/login', { email: 'ada@example.com', password: 'new-password-2' })).status, 200);
});

test('the answer does not reveal whether an account exists', async () => {
  await register('bob@example.com');
  const known = await requestLink('bob@example.com');
  const unknown = await requestLink('nobody@example.com');
  assert.equal(known.res.status, unknown.res.status);
  assert.deepEqual(await known.res.json(), await unknown.res.json());
  assert.ok(known.mail);
  assert.equal(unknown.mail, undefined, 'no email for unknown addresses');
  assert.equal((await post('/api/password/forgot', { email: 'not an email' })).status, 400);
});

test('only the newest link works, and links expire', async () => {
  await register('cy@example.com');
  const first = tokenIn((await requestLink('cy@example.com')).mail!);
  const second = tokenIn((await requestLink('cy@example.com')).mail!);
  assert.equal((await post('/api/password/reset', { token: first, password: 'password-xyz' })).status, 400, 'older link replaced');
  db.prepare('UPDATE password_resets SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await post('/api/password/reset', { token: second, password: 'password-xyz' })).status, 400, 'expired');
  for (const bad of [undefined, '', 'x', 'a'.repeat(500), 12345])
    assert.equal((await post('/api/password/reset', { token: bad, password: 'password-xyz' })).status, 400);
});

test('reset emails per address are limited', async () => {
  await register('dee@example.com');
  for (let i = 0; i < 2; i++) await requestLink('dee@example.com'); // plus the one below = 3 an hour
  assert.equal((await requestLink('dee@example.com')).res.status, 200);
  const fourth = await requestLink('dee@example.com');
  assert.equal(fourth.res.status, 429);
  assert.equal(fourth.mail, undefined);
});

/** A request with a chosen Host header (fetch doesn't allow setting it). */
function forgotWithHost(url: string, host: string, email: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url + '/api/password/forgot', { method: 'POST', headers: { host, 'content-type': 'application/json' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ email }));
  });
}

test('without SITE_URL, links are never built from a foreign Host header', async () => {
  const { app: noSite, url } = await start({});
  await register('eve@example.com');
  const sent = mails.length;
  assert.equal(await forgotWithHost(url, 'evil.example', 'eve@example.com'), 200);
  await noSite.idle();
  assert.equal(mails.length, sent, 'no email with a link to evil.example');
  // Developing on localhost still works
  assert.equal(await forgotWithHost(url, `localhost:${new URL(url).port}`, 'eve@example.com'), 200);
  await noSite.idle();
  assert.match(mails[mails.length - 1].text, new RegExp(`http://localhost:${new URL(url).port}/reset-password\\?token=`));
});

test('the reset page is private and not indexed', async () => {
  const res = await fetch(base + '/reset-password?token=abc');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.match(await res.text(), /Choose a new password/);
  assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \/reset-password/);
  const login = await (await fetch(base + '/login')).text();
  assert.match(login, /Forgot your password\?/);
});
