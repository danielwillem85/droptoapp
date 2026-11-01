/**
 * Designs saved in the user's account. Every query is scoped to the owner: another user's project
 * id behaves exactly like one that does not exist.
 */
import { randomBytes } from 'node:crypto';
import { isProject } from '../src/model/templates';
import type { Project } from '../src/model/types';
import type { Db } from './db';

export const MAX_PROJECTS_PER_USER = 500;
export const MAX_PROJECT_BYTES = 1024 * 1024;
export const MAX_NAME_LENGTH = 120;

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord extends ProjectSummary {
  project: Project;
}

interface Row {
  id: string;
  name: string;
  data: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const summary = (r: Omit<Row, 'data'>): ProjectSummary => ({
  id: r.id,
  name: r.name,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class ProjectError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new ProjectError(400, 'Please give the project a name.');
  return name.slice(0, MAX_NAME_LENGTH);
}

/** The design from a request, checked, as the JSON stored in the database. */
export function cleanProject(v: unknown): string {
  if (!isProject(v)) throw new ProjectError(400, 'This is not a DropToApp design.');
  const data = JSON.stringify({ format: 'droptoapp/v1', root: v.root, ...(v.code !== undefined ? { code: v.code } : {}) });
  if (Buffer.byteLength(data) > MAX_PROJECT_BYTES) throw new ProjectError(413, 'This design is too large to save (over 1 MB).');
  return data;
}

export function listProjects(db: Db, userId: number): ProjectSummary[] {
  const rows = db
    .prepare('SELECT id, name, version, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC')
    .all(userId) as unknown as Omit<Row, 'data'>[];
  return rows.map(summary);
}

function row(db: Db, userId: number, id: string): Row {
  const r = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as unknown as Row | undefined;
  if (!r) throw new ProjectError(404, 'This project does not exist (any more).');
  return r;
}

export function getProject(db: Db, userId: number, id: string): ProjectRecord {
  const r = row(db, userId, id);
  return { ...summary(r), project: JSON.parse(r.data) as Project };
}

export function createProject(db: Db, userId: number, name: unknown, project: unknown): ProjectSummary {
  const clean = cleanName(name);
  const data = cleanProject(project);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(userId) as { n: number };
  if (n >= MAX_PROJECTS_PER_USER)
    throw new ProjectError(409, `You have ${MAX_PROJECTS_PER_USER} projects, the maximum. Delete some to make room.`);
  const id = randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO projects (id, user_id, name, data) VALUES (?, ?, ?, ?)').run(id, userId, clean, data);
  return summary(row(db, userId, id));
}

/**
 * Change a project. With `project`, the content is replaced, but only when `baseVersion` is the
 * current version (otherwise it was changed in another window or on another computer: 409),
 * unless `force` is set. A name change alone never conflicts.
 */
export function updateProject(
  db: Db,
  userId: number,
  id: string,
  body: { name?: unknown; project?: unknown; baseVersion?: unknown; force?: unknown },
): ProjectSummary {
  const current = row(db, userId, id);
  const name = body.name === undefined ? current.name : cleanName(body.name);
  if (body.project === undefined) {
    db.prepare(`UPDATE projects SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(name, id);
    return summary(row(db, userId, id));
  }
  const data = cleanProject(body.project);
  if (body.force !== true && body.baseVersion !== current.version)
    throw new ProjectError(409, 'This project was changed in another window or on another computer.', { current: summary(current) });
  // The version check is in the WHERE clause too, so two saves at the same moment can't both win.
  const info = db
    .prepare(
      `UPDATE projects SET name = ?, data = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND version = ?`,
    )
    .run(name, data, id, current.version);
  if (info.changes !== 1) throw new ProjectError(409, 'This project was changed in another window or on another computer.');
  return summary(row(db, userId, id));
}

export function deleteProject(db: Db, userId: number, id: string): void {
  row(db, userId, id);
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
}
