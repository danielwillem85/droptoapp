import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, safeNext } from '../server/app';
import { hashPassword, verifyPassword } from '../server/auth';
import { subscribeToNewsletter } from '../server/brevo';
import { loadConfig } from '../server/config';
import { openDb, type Db } from '../server/db';

// A fake Brevo that records the requests the server sends.
const brevoCalls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
let brevoStatus = 201;
const fakeFetch: typeof fetch = async (input, init) => {
  brevoCalls.push({
    url: String(input),
    headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    body: JSON.parse(String(init?.body)),
  });
  return new Response(brevoStatus === 201 || brevoStatus === 204 ? null : JSON.stringify({ code: 'invalid_parameter', message: 'nope' }), {
    status: brevoStatus,
  });
};

let server: Server;
let base = '';
let db: Db;
let app: ReturnType<typeof createApp>;
let dist = '';

before(async () => {
  dist = mkdtempSync(join(tmpdir(), 'te-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>editor</title>EDITOR');
  writeFileSync(join(dist, 'assets', 'app-123.js'), 'console.log("editor code")');
  const cfg = loadConfig({
    DIST_DIR: dist,
    BREVO_API_KEY: 'xkeysib-test',
    BREVO_LIST_ID: '7',
    BREVO_API_URL: 'https://brevo.test/v3',
  } as NodeJS.ProcessEnv);
  db = openDb(':memory:');
  app = createApp(cfg, db, { fetchImpl: fakeFetch });
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dist, { recursive: true, force: true });
});

const post = (path: string, body: unknown, cookie = '') =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
const get = (path: string, cookie = '', accept = 'text/html') =>
  fetch(base + path, { headers: { accept, ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

test('passwords are hashed with scrypt and verified', async () => {
  const h = await hashPassword('correct horse');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
});

test('visitors who are not logged in only get the login page', async () => {
  let res = await get('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  res = await get('/some/page?x=1');
  assert.equal(res.headers.get('location'), '/login?next=%2Fsome%2Fpage%3Fx%3D1');
  res = await get('/assets/app-123.js', '', '*/*');
  assert.equal(res.status, 401, 'editor code is not served');
  assert.doesNotMatch(await res.text(), /editor code/);
  res = await get('/login');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Create account/);
  assert.match(html, /name="newsletter"  \/>/, 'newsletter box is not ticked by default');
  assert.match(html, /<dialog id="newsletter-dialog"/, 'the "are you sure" question is on the page');
  assert.equal((await get('/api/me', '', 'application/json')).status, 401);
});

test('registering with the newsletter creates the user, logs in, and adds them to the Brevo list', async () => {
  brevoCalls.length = 0;
  const res = await post('/api/register', { email: ' Ada@Example.com ', password: 'lovelace1815', name: 'Ada', newsletter: true });
  assert.equal(res.status, 201);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^te_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Expires=/);
  const { user } = (await res.json()) as { user: { email: string; newsletter: boolean } };
  assert.deepEqual(user, { id: 1, email: 'ada@example.com', name: 'Ada', newsletter: true });

  await app.idle();
  assert.equal(brevoCalls.length, 1);
  assert.equal(brevoCalls[0].url, 'https://brevo.test/v3/contacts');
  assert.equal(brevoCalls[0].headers['api-key'], 'xkeysib-test');
  assert.deepEqual(brevoCalls[0].body, { email: 'ada@example.com', listIds: [7], updateEnabled: true, attributes: { FIRSTNAME: 'Ada' } });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('ada@example.com') as Record<string, unknown>;
  assert.equal(row.newsletter, 1);
  assert.ok(row.newsletter_at, 'time of the choice is recorded');
  assert.equal(row.brevo_status, 'subscribed');
  assert.notEqual(row.password_hash, 'lovelace1815');

  // the session works: the editor is served, /api/me knows the user, /login redirects
  const cookie = cookieOf(res);
  assert.match(await (await get('/', cookie)).text(), /EDITOR/);
  assert.equal((await get('/assets/app-123.js', cookie, '*/*')).status, 200);
  assert.equal((await get('/deep/link', cookie)).status, 200, 'client-side routes get index.html');
  assert.equal(((await (await get('/api/me', cookie, 'application/json')).json()) as { user: { email: string } }).user.email, 'ada@example.com');
  assert.equal((await get('/login?next=/x', cookie)).headers.get('location'), '/x');
});

test('without the newsletter box ticked, Brevo is not called', async () => {
  brevoCalls.length = 0;
  const res = await post('/api/register', { email: 'grace@example.com', password: 'hopper1906', newsletter: false });
  assert.equal(res.status, 201);
  await app.idle();
  assert.equal(brevoCalls.length, 0);
  const row = db.prepare('SELECT newsletter, newsletter_at, brevo_status FROM users WHERE email = ?').get('grace@example.com') as Record<string, unknown>;
  assert.deepEqual({ ...row }, { newsletter: 0, newsletter_at: null, brevo_status: null });
});

test('a Brevo failure does not block registration and is recorded', async () => {
  brevoStatus = 400;
  const res = await post('/api/register', { email: 'linus@example.com', password: 'torvalds1969', newsletter: true });
  assert.equal(res.status, 201);
  await app.idle();
  const row = db.prepare('SELECT brevo_status FROM users WHERE email = ?').get('linus@example.com') as { brevo_status: string };
  assert.equal(row.brevo_status, 'error: HTTP 400 invalid_parameter: nope');
  brevoStatus = 201;
});

test('registration is validated', async () => {
  const cases: [unknown, number, RegExp][] = [
    [{ email: 'not-an-email', password: 'longenough' }, 400, /valid email/],
    [{ email: 'a@b.co', password: 'short' }, 400, /at least 8/],
    [{ email: 'ADA@example.com', password: 'another-password' }, 409, /already exists/],
  ];
  for (const [body, status, message] of cases) {
    const res = await post('/api/register', body);
    assert.equal(res.status, status);
    assert.match(((await res.json()) as { error: string }).error, message);
  }
  const form = await fetch(base + '/api/register', { method: 'POST', body: 'email=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415, 'only JSON is accepted (blocks cross-site form posts)');
});

test('login, wrong password, logout', async () => {
  let res = await post('/api/login', { email: 'ada@example.com', password: 'wrong-password' });
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { error: string }).error, 'Invalid email or password.');
  res = await post('/api/login', { email: 'nobody@example.com', password: 'whatever12' });
  assert.equal(res.status, 401, 'unknown email gets the same answer');

  res = await post('/api/login', { email: 'ADA@example.com', password: 'lovelace1815' });
  assert.equal(res.status, 200);
  const cookie = cookieOf(res);
  assert.equal((await get('/', cookie)).status, 200);

  res = await post('/api/logout', {}, cookie);
  assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await get('/', cookie)).status, 302, 'the old cookie no longer works');
});

test('repeated failed logins are rate limited', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await post('/api/login', { email: 'grace@example.com', password: 'bad-guess-' + i })).status;
  assert.equal(last, 429);
});

test('redirect targets stay on this site', () => {
  assert.equal(safeNext('/editor?x=1'), '/editor?x=1');
  assert.equal(safeNext('//evil.com'), '/');
  assert.equal(safeNext('https://evil.com'), '/');
  assert.equal(safeNext('/\\evil.com'), '/');
  assert.equal(safeNext('/login?next=/login'), '/');
  assert.equal(safeNext(null), '/');
});

test('Brevo is skipped (not called) when .env has no key or list', async () => {
  let called = false;
  const r = await subscribeToNewsletter({ apiKey: '', listId: null, apiUrl: 'https://x' }, { email: 'a@b.co' }, (async () => {
    called = true;
    return new Response(null, { status: 201 });
  }) as typeof fetch);
  assert.equal(called, false);
  assert.match(r.status, /^skipped/);
});

test('NEWSLETTER_CHECKED_BY_DEFAULT: off unless set', () => {
  assert.equal(loadConfig({} as NodeJS.ProcessEnv).newsletterCheckedByDefault, false);
  assert.equal(loadConfig({ NEWSLETTER_CHECKED_BY_DEFAULT: 'true' } as NodeJS.ProcessEnv).newsletterCheckedByDefault, true);
});
