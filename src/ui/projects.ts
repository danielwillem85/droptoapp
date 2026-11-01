/**
 * Projects saved in the account: the API client, and what the editor opens when it starts.
 *
 * Every design is a project in the account. The browser keeps a copy too (autosave), so work
 * survives a lost connection; the next time it is online the copy is sent to the account.
 */
import { isProject, starterProject } from '../model/templates';
import type { Project } from '../model/types';
import { storage } from './platform';

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The project open in the editor: which one, and the version of it the editor started from. */
export interface CloudProject {
  id: string;
  name: string;
  version: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: string, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body,
      keepalive,
    });
  } catch {
    throw new ApiError(0, 'No connection to the server.');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `HTTP ${res.status}`), data);
  return data as T;
}

/** `project` is passed as JSON text (as the editor already has it), so it isn't serialised twice. */
const withProject = (fields: Record<string, unknown>, projectJson?: string) => {
  const head = JSON.stringify(fields);
  return projectJson === undefined ? head : `${head.slice(0, -1)}${head.length > 2 ? ',' : ''}"project":${projectJson}}`;
};

export const projectsApi = {
  list: () => call<{ projects: ProjectSummary[] }>('GET', '/api/projects').then((r) => r.projects),
  get: (id: string) => call<ProjectSummary & { project: Project }>('GET', `/api/projects/${encodeURIComponent(id)}`),
  create: (name: string, projectJson: string) =>
    call<{ project: ProjectSummary }>('POST', '/api/projects', withProject({ name }, projectJson)).then((r) => r.project),
  save: (id: string, projectJson: string, baseVersion: number, force = false, keepalive = false) =>
    call<{ project: ProjectSummary }>(
      'PUT',
      `/api/projects/${encodeURIComponent(id)}`,
      withProject({ baseVersion, ...(force ? { force: true } : {}) }, projectJson),
      keepalive,
    ).then((r) => r.project),
  rename: (id: string, name: string) =>
    call<{ project: ProjectSummary }>('PUT', `/api/projects/${encodeURIComponent(id)}`, JSON.stringify({ name })).then((r) => r.project),
  remove: (id: string) => call<{ ok: true }>('DELETE', `/api/projects/${encodeURIComponent(id)}`),
};

export const toCloud = (s: ProjectSummary): CloudProject => ({ id: s.id, name: s.name, version: s.version });

/** The design as stored: the same JSON for the account, the browser copy and comparisons. */
export function projectJson(project: Project): string {
  return JSON.stringify({ format: 'droptoapp/v1', root: project.root, ...(project.code !== undefined ? { code: project.code } : {}) });
}

/** A name for a new project: the app's title, made unique among the given names ("Sales 2"). */
export function projectName(base: string, taken: Iterable<string> = []): string {
  const clean = base.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled design';
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(clean.toLowerCase())) return clean;
  let i = 2;
  while (used.has(`${clean} ${i}`.toLowerCase())) i++;
  return `${clean} ${i}`;
}

export const titleOf = (p: Project) => String(p.root.props.title ?? '');

// ---------------------------------------------------------------- the browser copy

export const AUTOSAVE_PREFIX = 'droptoapp:autosave';
/** Keys used before the rename (per user, and from before accounts existed). */
const LEGACY_AUTOSAVE_PREFIX = 'truth-editor:autosave';

export interface LocalCopy {
  project: Project;
  /** The account project it belongs to (absent for designs from before projects existed). */
  cloud: CloudProject | null;
  /** Whether this exact design is saved in the account. */
  synced: boolean;
}

/** What the browser copy looks like in storage. */
export function localCopyJson(project: Project, cloud: CloudProject | null, synced: boolean): string {
  return JSON.stringify({ ...JSON.parse(projectJson(project)), cloud, synced });
}

function readLocal(key: string): LocalCopy | null {
  const raw = storage.load(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Project & { cloud?: CloudProject | null; synced?: boolean };
    if (!isProject(parsed)) return null;
    const cloud =
      parsed.cloud && typeof parsed.cloud.id === 'string' && typeof parsed.cloud.version === 'number' ? parsed.cloud : null;
    const project: Project = { format: 'droptoapp/v1', root: parsed.root, ...(parsed.code !== undefined ? { code: parsed.code } : {}) };
    return { project, cloud, synced: cloud ? parsed.synced === true : false };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- starting the editor

export interface Startup extends LocalCopy {
  /** Shown once in the status bar, e.g. "Your design is now saved in your account". */
  notice?: string;
}

/**
 * Decide what the editor opens:
 *  1. the project this browser was working on (the account's version if it is newer and this
 *     browser has no unsaved changes; this browser's version otherwise);
 *  2. a design in this browser from before projects existed, which becomes a project;
 *  3. the project edited most recently, e.g. on another computer;
 *  4. a new project with the example app.
 * Without a connection, it opens this browser's copy and saves it to the account later.
 */
export async function resolveStartup(userId: number): Promise<Startup> {
  const key = `${AUTOSAVE_PREFIX}:${userId}`;
  const local = readLocal(key) ?? readLocal(`${LEGACY_AUTOSAVE_PREFIX}:${userId}`) ?? readLocal(LEGACY_AUTOSAVE_PREFIX);
  try {
    if (local?.cloud) {
      try {
        const remote = await projectsApi.get(local.cloud.id);
        const cloud = toCloud(remote);
        const same = projectJson(remote.project) === projectJson(local.project);
        if (same) return { project: local.project, cloud, synced: true };
        if (local.synced) return { project: remote.project, cloud, synced: true }; // changed elsewhere since
        // Unsaved changes here: keep them; saving will notice if the account also changed meanwhile.
        return { project: local.project, cloud: { ...local.cloud, name: remote.name }, synced: false };
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        // Deleted elsewhere: unsaved work here becomes a new project, otherwise open another one.
        if (!local.synced) {
          const created = await projectsApi.create(projectName(local.cloud.name), projectJson(local.project));
          return { project: local.project, cloud: toCloud(created), synced: true, notice: 'This project was deleted elsewhere; your changes were saved as a new project.' };
        }
      }
    }
    const existing = await projectsApi.list();
    if (local && !local.cloud) {
      const created = await projectsApi.create(
        projectName(titleOf(local.project), existing.map((p) => p.name)),
        projectJson(local.project),
      );
      return { project: local.project, cloud: toCloud(created), synced: true, notice: 'Your design is now saved in your account.' };
    }
    if (existing.length) {
      const latest = await projectsApi.get(existing[0].id);
      return { project: latest.project, cloud: toCloud(latest), synced: true };
    }
    const starter = starterProject();
    const created = await projectsApi.create(projectName(titleOf(starter)), projectJson(starter));
    return { project: starter, cloud: toCloud(created), synced: true };
  } catch {
    // Offline (or the server had a problem): work on this browser's copy; it is saved to the account later.
    if (local) return { ...local, notice: 'Working offline: your changes are kept in this browser and saved to your account when the connection is back.' };
    return { project: starterProject(), cloud: null, synced: false };
  }
}
