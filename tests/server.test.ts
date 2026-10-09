import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, safeNext } from '../server/app';
import { hashPassword, verifyPassword } from '../server/auth';
import { sendAccountNotification, subscribeToNewsletter } from '../server/brevo';
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

test('visitors who are not logged in only get the landing and login page', async () => {
  let res = await get('/');
  assert.equal(res.status, 200, 'the home page is the landing page, so search engines can index it');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('vary'), 'Cookie');
  const home = await res.text();
  assert.match(home, /<h1>/);
  assert.match(home, /id="login-form"|<form/);
  assert.doesNotMatch(home, /EDITOR/, 'the editor is not served');
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
  assert.equal(brevoCalls.length, 2);
  const contact = brevoCalls.find(call => call.url.endsWith('/contacts'))!;
  assert.equal(contact.url, 'https://brevo.test/v3/contacts');
  assert.equal(contact.headers['api-key'], 'xkeysib-test');
  assert.deepEqual(contact.body, { email: 'ada@example.com', listIds: [7], updateEnabled: true, attributes: { FIRSTNAME: 'Ada' } });
  const notification = brevoCalls.find(call => call.url.endsWith('/smtp/email'))!;
  assert.equal(notification.headers['api-key'], 'xkeysib-test');
  assert.deepEqual(notification.body.to, [{ email: 'info@droptoapp.com' }]);
  assert.deepEqual(notification.body.sender, { email: 'info@droptoapp.com', name: 'DropToApp' });
  assert.equal(notification.body.subject, 'New DropToApp account created');
  assert.match(String(notification.body.textContent), /Name: Ada\nEmail: ada@example.com/);
  assert.match(String(notification.body.textContent), /Newsletter: Opted in/);
  assert.doesNotMatch(JSON.stringify(notification.body), /lovelace1815|password_hash|te_session/);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('ada@example.com') as Record<string, unknown>;
  assert.equal(row.newsletter, 1);
  assert.ok(row.newsletter_at, 'time of the choice is recorded');
  assert.equal(row.brevo_status, 'subscribed');
  assert.notEqual(row.password_hash, 'lovelace1815');
  assert.ok(String(notification.body.textContent).includes(`Created at (UTC): ${row.created_at}`));

  // the session works: the editor is served, /api/me knows the user, /login redirects
  const cookie = cookieOf(res);
  assert.match(await (await get('/', cookie)).text(), /EDITOR/);
  assert.equal((await get('/assets/app-123.js', cookie, '*/*')).status, 200);
  assert.equal((await get('/deep/link', cookie)).status, 200, 'client-side routes get index.html');
  assert.equal(((await (await get('/api/me', cookie, 'application/json')).json()) as { user: { email: string } }).user.email, 'ada@example.com');
  assert.equal((await get('/login?next=/x', cookie)).headers.get('location'), '/x');
});

test('without newsletter consent, only the owner notification is sent', async () => {
  brevoCalls.length = 0;
  const res = await post('/api/register', { email: 'grace@example.com', password: 'hopper1906', newsletter: false });
  assert.equal(res.status, 201);
  await app.idle();
  assert.equal(brevoCalls.length, 1);
  assert.equal(brevoCalls[0].url, 'https://brevo.test/v3/smtp/email');
  assert.deepEqual(brevoCalls[0].body.to, [{ email: 'info@droptoapp.com' }]);
  assert.match(String(brevoCalls[0].body.textContent), /Email: grace@example.com/);
  assert.match(String(brevoCalls[0].body.textContent), /Newsletter: Not opted in/);
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
  brevoCalls.length = 0;
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
  await app.idle();
  assert.equal(brevoCalls.length, 0, 'invalid and duplicate registrations do not send notifications');
});

test('login, wrong password, logout', async () => {
  brevoCalls.length = 0;
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
  res = await get('/', cookie);
  assert.doesNotMatch(await res.text(), /EDITOR/, 'the old cookie no longer works');
  await app.idle();
  assert.equal(brevoCalls.length, 0, 'existing-account logins do not send notifications');
});

test('the landing page is ready for search engines and link previews', async () => {
  const html = await (await get('/', '', 'text/html')).text();
  assert.match(html, /<title>[^<]*R Shiny[^<]*<\/title>/);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]{80,170}"/);
  // Without SITE_URL the address comes from the request
  assert.ok(html.includes(`<link rel="canonical" href="${base}/" />`));
  assert.ok(html.includes(`<meta property="og:image" content="${base}/static/og-image.png" />`));
  assert.doesNotMatch(html, /\{\{/, 'no placeholders left');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(
    ld.map((d) => d['@type']),
    ['SoftwareApplication', 'FAQPage'],
  );
  // Every FAQ answer in the structured data is also visible on the page
  for (const q of ld[1].mainEntity) assert.ok(html.includes(`<summary>${q.name}</summary>`), q.name);

  let res = await get('/robots.txt', '', '*/*');
  assert.equal(res.status, 200);
  const robots = await res.text();
  assert.match(robots, /Disallow: \/api\//);
  assert.ok(robots.includes(`Sitemap: ${base}/sitemap.xml`));
  res = await get('/sitemap.xml', '', '*/*');
  assert.match(res.headers.get('content-type') ?? '', /xml/);
  assert.ok((await res.text()).includes(`<loc>${base}/</loc>`));

  res = await get('/static/og-image.png', '', 'image/*');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  res = await get('/static/editor-screenshot.webp', '', 'image/*');
  assert.equal(res.headers.get('content-type'), 'image/webp');
  for (const bad of ['/static/%2e%2e%2fapp.ts', '/static/..%2fapp.ts', '/static/missing.png', '/static/'])
    assert.equal((await get(bad, '', '*/*')).status, 404, bad);
});

test('SITE_URL sets the public address', async () => {
  const cfg = loadConfig({ DIST_DIR: dist, SITE_URL: 'https://droptoapp.com/' } as NodeJS.ProcessEnv);
  assert.equal(cfg.siteUrl, 'https://droptoapp.com');
  const other = createApp(cfg, db);
  const srv = createServer((req, res) => void other.handle(req, res));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const addr = srv.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const html = await (await fetch(url + '/')).text();
    assert.ok(html.includes('<link rel="canonical" href="https://droptoapp.com/" />'));
    assert.ok((await (await fetch(url + '/robots.txt')).text()).includes('Sitemap: https://droptoapp.com/sitemap.xml'));
  } finally {
    srv.close();
  }
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
  const r = await subscribeToNewsletter(loadConfig({}).brevo, { email: 'a@b.co' }, (async () => {
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

const notificationAccount = {
  id: 42, email: 'new@example.com', name: 'New User', newsletter: false, createdAt: '2026-10-08T12:00:00.000Z',
};

test('account notification needs no list ID and uses the configured sender', async () => {
  const cfg = loadConfig({ BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: ' verified@example.com ' });
  assert.equal(cfg.brevo.listId, null);
  const result = await sendAccountNotification(cfg.brevo, notificationAccount, async (input, init) => {
    assert.equal(String(input), 'https://api.brevo.com/v3/smtp/email');
    assert.equal(init?.method, 'POST');
    assert.ok(init?.signal instanceof AbortSignal, 'provider calls have a timeout signal');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.sender, { email: 'verified@example.com', name: 'DropToApp' });
    assert.deepEqual(body.to, [{ email: 'info@droptoapp.com' }]);
    assert.match(body.textContent, /Account ID: 42/);
    return new Response(JSON.stringify({ messageId: 'test-message' }), { status: 201 });
  });
  assert.deepEqual(result, { ok: true, status: 'accepted' });
});

test('account notification skips missing credentials and catches provider/network errors', async () => {
  const absent = await sendAccountNotification(loadConfig({}).brevo, notificationAccount, async () => {
    assert.fail('no network request without an API key');
  });
  assert.deepEqual(absent, { ok: false, status: 'skipped: BREVO_API_KEY not set' });
  const cfg = loadConfig({ BREVO_API_KEY: 'test-key' });
  for (const [fetchImpl, expected] of [
    [async () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Invalid key' }), { status: 401 }), /HTTP 401 unauthorized: Invalid key/],
    [async () => new Response('Unavailable', { status: 503 }), /HTTP 503/],
    [async () => { throw new Error('Connection failed'); }, /Connection failed/],
    [async () => { throw new DOMException('Timed out', 'TimeoutError'); }, /Timed out/],
  ] satisfies [typeof fetch, RegExp][]) {
    const result = await sendAccountNotification(cfg.brevo, notificationAccount, fetchImpl);
    assert.equal(result.ok, false);
    assert.match(result.status, expected);
  }
});

test('slow or failing notification delivery does not delay account creation or login', async (t) => {
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  const localDb = openDb(':memory:');
  let finishEmail!: (res: Response) => void;
  const delivery = new Promise<Response>(resolve => { finishEmail = resolve; });
  let calls = 0;
  const localApp = createApp(loadConfig({ BREVO_API_KEY: 'test-key' }), localDb, {
    fetchImpl: async () => { calls++; return delivery; },
  });
  const localServer = createServer((req, res) => void localApp.handle(req, res));
  await new Promise<void>(resolve => localServer.listen(0, '127.0.0.1', resolve));
  const address = localServer.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const res = await fetch(url + '/api/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'slow@example.com', password: 'valid-password', newsletter: false }),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(res.status, 201, 'registration finishes while email is still pending');
    assert.equal(calls, 1);
    const cookie = cookieOf(res);
    assert.equal((await fetch(url + '/api/me', { headers: { cookie } })).status, 200);
    finishEmail(new Response('Provider unavailable', { status: 503 }));
    await localApp.idle();
    assert.ok(warnings.some(message => message.includes('[account-notification] user 1: error: HTTP 503')));
    assert.equal((await fetch(url + '/api/me', { headers: { cookie } })).status, 200, 'failure leaves the account usable');
  } finally {
    finishEmail(new Response(null, { status: 201 }));
    await localApp.idle();
    localServer.closeAllConnections();
    await new Promise<void>(resolve => localServer.close(() => resolve()));
    localDb.close();
  }
});
