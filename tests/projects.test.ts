import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { openDb, type Db } from '../server/db';
import { MAX_PROJECTS_PER_USER } from '../server/projects';
import { emptyProject, starterProject as freshStarter } from '../src/model/templates';

const STARTER = freshStarter();
const starterProject = () => STARTER;

let server: Server;
let base = '';
let db: Db;
let dist = '';

before(async () => {
  dist = mkdtempSync(join(tmpdir(), 'te-dist-'));
  writeFileSync(join(dist, 'index.html'), 'EDITOR');
  const app = createApp(loadConfig({ DIST_DIR: dist } as NodeJS.ProcessEnv), (db = openDb(':memory:')), {
    fetchImpl: async () => new Response(null, { status: 201 }),
  });
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

let n = 0;
async function newUser(): Promise<string> {
  const res = await fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': `10.0.0.${++n}` },
    body: JSON.stringify({ email: `user${n}-${Date.now()}@example.com`, password: 'password123' }),
  });
  assert.equal(res.status, 201);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

const call = async (cookie: string, method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as Record<string, any> };
};

test('create, list, open, rename, save and delete a project', async () => {
  const me = await newUser();
  assert.deepEqual((await call(me, 'GET', '/api/projects')).data, { projects: [] });

  const created = await call(me, 'POST', '/api/projects', { name: '  Old   Faithful ', project: starterProject() });
  assert.equal(created.status, 201);
  const p = created.data.project;
  assert.match(p.id, /^[\w-]{16}$/);
  assert.equal(p.name, 'Old Faithful', 'name tidied');
  assert.equal(p.version, 1);

  const opened = await call(me, 'GET', `/api/projects/${p.id}`);
  assert.deepEqual(opened.data.project.root, starterProject().root);

  // Save with hand-written code: stored exactly
  const code = '# mine\nui <- page_fluid()\nserver <- function(input, output) {}\nshinyApp(ui, server)\n';
  const saved = await call(me, 'PUT', `/api/projects/${p.id}`, { baseVersion: 1, project: { ...starterProject(), code } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.project.version, 2);
  assert.equal((await call(me, 'GET', `/api/projects/${p.id}`)).data.project.code, code);

  // Rename alone does not change the version (so it never conflicts with open editors)
  const renamed = await call(me, 'PUT', `/api/projects/${p.id}`, { name: 'Geyser' });
  assert.equal(renamed.data.project.name, 'Geyser');
  assert.equal(renamed.data.project.version, 2);

  // Most recently changed first
  const second = (await call(me, 'POST', '/api/projects', { name: 'Second', project: emptyProject() })).data.project;
  assert.deepEqual((await call(me, 'GET', '/api/projects')).data.projects.map((x: any) => x.name), ['Second', 'Geyser']);
  await call(me, 'PUT', `/api/projects/${p.id}`, { baseVersion: 2, project: starterProject() });
  assert.deepEqual((await call(me, 'GET', '/api/projects')).data.projects.map((x: any) => x.name), ['Geyser', 'Second']);
  assert.equal((await call(me, 'GET', '/api/projects')).data.projects[0].project, undefined, 'the list has no designs in it');

  assert.equal((await call(me, 'DELETE', `/api/projects/${second.id}`)).status, 200);
  assert.equal((await call(me, 'GET', `/api/projects/${second.id}`)).status, 404);
  assert.equal((await call(me, 'GET', '/api/projects')).data.projects.length, 1);
});

test('saving over changes made elsewhere is refused, unless forced', async () => {
  const me = await newUser();
  const p = (await call(me, 'POST', '/api/projects', { name: 'Shared', project: emptyProject() })).data.project;
  // Two windows open version 1; the first one saves
  assert.equal((await call(me, 'PUT', `/api/projects/${p.id}`, { baseVersion: 1, project: starterProject() })).status, 200);
  const stale = await call(me, 'PUT', `/api/projects/${p.id}`, { baseVersion: 1, project: emptyProject() });
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /changed in another window/);
  assert.equal(stale.data.current.version, 2);
  assert.deepEqual((await call(me, 'GET', `/api/projects/${p.id}`)).data.project.root, starterProject().root, 'nothing overwritten');
  const forced = await call(me, 'PUT', `/api/projects/${p.id}`, { baseVersion: 1, force: true, project: emptyProject() });
  assert.equal(forced.data.project.version, 3);
});

test("other people's projects are invisible", async () => {
  const alice = await newUser();
  const bob = await newUser();
  const p = (await call(alice, 'POST', '/api/projects', { name: 'Private', project: starterProject() })).data.project;
  assert.deepEqual((await call(bob, 'GET', '/api/projects')).data.projects, []);
  for (const [method, body] of [['GET'], ['PUT', { name: 'Hacked' }], ['PUT', { baseVersion: 1, project: emptyProject() }], ['DELETE']] as const) {
    const r = await call(bob, method, `/api/projects/${p.id}`, body);
    assert.equal(r.status, 404, `${method} by someone else`);
  }
  const mine = await call(alice, 'GET', `/api/projects/${p.id}`);
  assert.equal(mine.data.name, 'Private');
  assert.equal(mine.data.version, 1);
  // Not logged in
  for (const path of ['/api/projects', `/api/projects/${p.id}`]) assert.equal((await call('', 'GET', path)).status, 401);
});

test('invalid input is refused', async () => {
  const me = await newUser();
  assert.equal((await call(me, 'POST', '/api/projects', { name: 'x', project: { format: 'other', root: {} } })).status, 400);
  assert.equal((await call(me, 'POST', '/api/projects', { name: '   ', project: emptyProject() })).status, 400);
  const long = (await call(me, 'POST', '/api/projects', { name: 'n'.repeat(500), project: emptyProject() })).data.project;
  assert.equal(long.name.length, 120);
  // Large designs are fine up to 1 MB; bigger ones are refused
  const big = { ...emptyProject(), code: 'x'.repeat(900 * 1024) };
  assert.equal((await call(me, 'POST', '/api/projects', { name: 'Big', project: big })).status, 201);
  const huge = { ...emptyProject(), code: 'x'.repeat(1100 * 1024) };
  assert.equal((await call(me, 'POST', '/api/projects', { name: 'Huge', project: huge })).status, 413);
  // Only known fields of the design are stored
  const extra = (await call(me, 'POST', '/api/projects', { name: 'E', project: { ...emptyProject(), evil: '<script>' } })).data.project;
  assert.equal('evil' in (await call(me, 'GET', `/api/projects/${extra.id}`)).data.project, false);
  assert.equal((await call(me, 'GET', '/api/projects/x%2F..%2Fy')).status, 404);
  assert.equal((await call(me, 'PATCH', `/api/projects/${extra.id}`, {})).status, 405);
});

test('there is a limit on the number of projects', async () => {
  const me = await newUser();
  const userId = (db.prepare('SELECT user_id FROM sessions ORDER BY rowid DESC LIMIT 1').get() as { user_id: number }).user_id;
  const insert = db.prepare("INSERT INTO projects (id, user_id, name, data) VALUES (?, ?, 'p', '{}')");
  for (let i = 0; i < MAX_PROJECTS_PER_USER; i++) insert.run(`bulk${userId}-${i}`, userId);
  const r = await call(me, 'POST', '/api/projects', { name: 'One too many', project: emptyProject() });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /maximum/);
});

test("deleting an account deletes its projects", async () => {
  const me = await newUser();
  await call(me, 'POST', '/api/projects', { name: 'Gone', project: emptyProject() });
  const userId = (db.prepare('SELECT user_id FROM sessions ORDER BY rowid DESC LIMIT 1').get() as { user_id: number }).user_id;
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(userId) as { n: number }).n, 0);
});
