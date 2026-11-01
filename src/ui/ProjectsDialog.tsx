import { useEffect, useRef, useState } from 'react';
import { ApiError, projectsApi } from './projects';
import type { CloudProject, ProjectSummary } from './projects';

/** "3 minutes ago", "yesterday", "12 Mar 2026". */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * My projects: every design saved in the account. Opening, creating and duplicating go through
 * the editor (which first saves the current design); renaming and deleting happen here.
 */
export function ProjectsDialog({
  current,
  busy,
  onOpen,
  onNew,
  onTemplates,
  onDuplicate,
  onRenamed,
  onDelete,
  onClose,
}: {
  current: CloudProject | null;
  /** Something is going on in the editor (saving, opening): buttons wait. */
  busy: boolean;
  onOpen: (p: ProjectSummary) => void;
  onNew: () => void;
  onTemplates: () => void;
  onDuplicate: (p: ProjectSummary) => void;
  onRenamed: (p: ProjectSummary) => void;
  /** Deletes it (the editor first stops saving it when it is the open project, then opens another). */
  onDelete: (p: ProjectSummary) => Promise<void>;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = () => {
    setError(null);
    projectsApi
      .list()
      .then(setProjects)
      .catch((e: Error) => setError(e instanceof ApiError && e.status === 0 ? 'No connection to the server. Try again in a moment.' : e.message));
  };
  useEffect(load, []);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !renaming && !confirmDelete) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, renaming, confirmDelete]);

  const rename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const old = projects?.find((p) => p.id === renaming.id);
    if (!name || name === old?.name) return setRenaming(null);
    setWorking(true);
    try {
      const updated = await projectsApi.rename(renaming.id, name);
      setProjects((ps) => ps?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
      onRenamed(updated);
      setRenaming(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const remove = async (p: ProjectSummary) => {
    setWorking(true);
    try {
      await onDelete(p);
      setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
      setConfirmDelete(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  const disabled = busy || working;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal projects" role="dialog" aria-modal="true" aria-labelledby="projects-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="projects-title">My projects</h2>
            <p>Saved in your account, so they are there on any computer you log in on.</p>
          </div>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="projects-bar">
          <button className="primary" disabled={disabled} onClick={onNew}>
            + New project
          </button>
          <button disabled={disabled} onClick={onTemplates}>
            From a template…
          </button>
          <span className="spacer" />
          {projects && projects.length > 6 ? (
            <input className="projects-search" placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
          ) : null}
        </div>
        {error ? (
          <div className="projects-error" role="alert">
            {error} <button onClick={load}>Try again</button>
          </div>
        ) : null}
        {projects === null && !error ? <p className="projects-empty">Loading…</p> : null}
        {projects && !shown.length ? <p className="projects-empty">{q ? 'No projects match.' : 'No projects yet.'}</p> : null}
        <ul className="projects-list">
          {shown.map((p) => {
            const isCurrent = p.id === current?.id;
            return (
              <li key={p.id} className={isCurrent ? 'is-current' : ''}>
                {renaming?.id === p.id ? (
                  <form
                    className="projects-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <input
                      autoFocus
                      maxLength={120}
                      value={renaming.name}
                      aria-label="Project name"
                      onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    />
                    <button className="primary" disabled={working}>
                      Save
                    </button>
                    <button type="button" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : confirmDelete === p.id ? (
                  <div className="projects-confirm">
                    <span>
                      Delete <b>{p.name}</b>? This can't be undone.
                    </span>
                    <button className="danger-solid" disabled={working} onClick={() => void remove(p)}>
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <button className="projects-name" disabled={disabled || isCurrent} onClick={() => onOpen(p)} title={isCurrent ? 'Open now' : `Open ${p.name}`}>
                      <span className="name">{p.name}</span>
                      <span className="when">
                        {isCurrent ? 'Open now · ' : ''}edited {ago(p.updatedAt)}
                      </span>
                    </button>
                    <span className="projects-actions">
                      {!isCurrent ? (
                        <button disabled={disabled} onClick={() => onOpen(p)}>
                          Open
                        </button>
                      ) : null}
                      <button disabled={disabled} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                        Rename
                      </button>
                      <button disabled={disabled} onClick={() => onDuplicate(p)}>
                        Duplicate
                      </button>
                      <button className="danger" disabled={disabled} onClick={() => setConfirmDelete(p.id)}>
                        Delete
                      </button>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
