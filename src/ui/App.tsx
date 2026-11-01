import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { generateApp } from '../model/codegen';
import { templateBySlug, templateProject } from '../model/gallery';
import type { AppTemplate } from '../model/gallery';
import { emptyProject, isProject } from '../model/templates';
import { walk } from '../model/tree';
import type { Project } from '../model/types';
import { validate } from '../model/validate';
import { initialState, reducer, stateJson } from '../state/store';
import { Canvas } from './Canvas';
import { CodeView } from './CodeView';
import { EditorContext } from './context';
import { Outline } from './Outline';
import { Palette } from './Palette';
import { logout } from './auth';
import type { Settings, User } from './auth';
import { openTextFile, saveTextFile, storage } from './platform';
import { useAutosave } from './autosave';
import { useCloudSave } from './cloudSave';
import { AUTOSAVE_PREFIX, projectName, projectsApi, toCloud } from './projects';
import type { CloudProject, ProjectSummary, Startup } from './projects';
import { ProjectsDialog } from './ProjectsDialog';
import { PropertiesPanel } from './PropertiesPanel';
import { RunPanel } from './RunPanel';
import { TemplateGallery } from './TemplateGallery';

type View = 'design' | 'split' | 'code';
type Device = 'desktop' | 'tablet' | 'phone';
const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, phone: 400 };

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/**
 * Size of the whole editor (CSS zoom), so more fits on the screen. Remembered per browser.
 * 85% by default: the canvas shows the Shiny app at a scale that gives an overview of the page.
 */
const ZOOM_KEY = 'droptoapp:zoom';
const ZOOM_STEPS = [0.7, 0.75, 0.8, 0.85, 0.9, 1, 1.1, 1.25];
const DEFAULT_ZOOM = 0.85;
function initialZoom(): number {
  const z = Number(storage.load(ZOOM_KEY));
  return ZOOM_STEPS.includes(z) ? z : DEFAULT_ZOOM;
}

const STATUS_TEXT = {
  saved: 'Saved to your account',
  pending: 'Saving…',
  saving: 'Saving…',
  offline: 'Offline: kept in this browser',
  conflict: 'Not saved: changed elsewhere',
  loggedOut: 'Logged out: kept in this browser',
} as const;

export function App({ user, settings, startup }: { user: User; settings: Settings; startup: Startup }) {
  // The open project (see projects.ts for which one that is at the start). A copy is also kept in
  // this browser, per account, so work survives a lost connection.
  const autosaveKey = `${AUTOSAVE_PREFIX}:${user.id}`;
  const [state, dispatch] = useReducer(reducer, null, () => initialState(startup.project));
  const [cloud, setCloud] = useState<CloudProject | null>(startup.cloud);
  const [showProjects, setShowProjects] = useState(false);
  const [zoom, setZoomState] = useState(initialZoom);
  const setZoom = (z: number) => {
    setZoomState(z);
    storage.save(ZOOM_KEY, String(z));
  };
  const zoomStep = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.indexOf(zoom);
    setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))]);
  };
  /** Saving, opening or creating a project: buttons that start another one wait. */
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [view, setView] = useState<View>('split');
  const [device, setDevice] = useState<Device>('desktop');
  const [message, setMessage] = useState<string | null>(null);
  /** The app is running live (Run button); `runKey` changes force a fresh start. */
  const [running, setRunning] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [showTemplates, setShowTemplates] = useState(false);
  const draftLocked = !!state.codeError;
  const draftLockHint = 'Fix or discard the code edits first. You can still save or export your draft.';

  const generated = useMemo(() => generateApp(state.root).app, [state.root]);
  // What the user sees and exports: their hand-edited app.R if there is one.
  const code = state.codeDraft ?? generated;
  const issues = useMemo(() => validate(state.root), [state.root]);
  const count = useMemo(() => {
    let n = 0;
    walk(state.root, () => (n += 1));
    return n - 3; // page, sidebar and main are always there
  }, [state.root]);

  // Saved to the account about a second after each change ...
  const designJson = useMemo(() => stateJson(state), [state.root, state.codeDraft]);
  const cloudSave = useCloudSave({
    cloud,
    setCloud,
    value: designJson,
    newName: () => projectName(String(state.root.props.title ?? '')),
    initiallySynced: startup.synced && !!startup.cloud,
  });
  const cloudOk = cloudSave.status === 'saved' || cloudSave.status === 'pending' || cloudSave.status === 'saving';
  // ... and to this browser at once, with which project it is and whether the account has it.
  const autosaveValue = `${designJson.slice(0, -1)},"cloud":${JSON.stringify(cloud)},"synced":${cloudSave.status === 'saved'}}`;
  const autosave = useAutosave(autosaveKey, autosaveValue, { safeElsewhere: () => cloudSave.status === 'saved' });

  useEffect(() => {
    document.title = cloud ? `${cloud.name} · DropToApp` : 'DropToApp';
  }, [cloud?.name]);

  const startRun = () => {
    if (state.codeError) return;
    if (view === 'code') setView('split');
    setRunKey((k) => k + 1);
    setRunning(true);
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Shift+Enter (as in RStudio): run the app, or restart it with the latest code. Works while typing.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        startRun();
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) dispatch({ type: 'undo' });
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) dispatch({ type: 'redo' });
      else if (mod && key === 'd' && state.selectedId) dispatch({ type: 'duplicate', id: state.selectedId });
      else if ((key === 'delete' || key === 'backspace') && state.selectedId) dispatch({ type: 'remove', id: state.selectedId });
      else if (e.altKey && (key === 'arrowup' || key === 'arrowleft') && state.selectedId)
        dispatch({ type: 'nudge', id: state.selectedId, delta: -1 });
      else if (e.altKey && (key === 'arrowdown' || key === 'arrowright') && state.selectedId)
        dispatch({ type: 'nudge', id: state.selectedId, delta: 1 });
      else if (key === 'escape') dispatch({ type: 'select', id: null });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selectedId, state.codeError, view]);

  const flash = (m: string, ms = 2500) => {
    setMessage(m);
    setTimeout(() => setMessage(null), ms);
  };

  useEffect(() => {
    if (startup.notice) flash(startup.notice, 6000);
  }, []);

  // ------------------------------------------------------------ projects

  /** Save the open project before switching to another one. False (with a message) when that failed. */
  const leaveCurrent = async (): Promise<boolean> => {
    if (await cloudSave.flush()) return true;
    flash(
      cloudSave.status === 'conflict'
        ? 'First choose what to do with the changes made elsewhere (see the message below).'
        : "Your changes couldn't be saved to your account yet (no connection?). Try again in a moment.",
      6000,
    );
    return false;
  };

  /** Show a project that is already saved in the account. */
  const show = (project: Project, meta: CloudProject) => {
    const next = initialState(project);
    cloudSave.adopt(stateJson(next));
    setCloud(meta);
    dispatch({ type: 'replace', state: next });
    setRunning(false);
  };

  /** Run a project action: one at a time, and report failures. */
  const task = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      flash(`Something went wrong: ${(e as Error).message}`, 6000);
    } finally {
      setBusy(false);
    }
  };

  /** Save `project` as a new project in the account and open it. */
  const createAndOpen = (project: Project, baseName: string, message: (name: string) => string, saveFirst = true) =>
    task(async () => {
      if (saveFirst && !(await leaveCurrent())) return;
      const next = initialState(project);
      const json = stateJson(next);
      const taken = await projectsApi.list().then((ps) => ps.map((p) => p.name), () => []);
      const created = await projectsApi.create(projectName(baseName, taken), json);
      cloudSave.adopt(json);
      setCloud(toCloud(created));
      dispatch({ type: 'replace', state: next });
      setRunning(false);
      setShowProjects(false);
      flash(message(created.name), 5000);
    });

  const openProject = (p: Pick<ProjectSummary, 'id'>, saveFirst = true) =>
    task(async () => {
      if (saveFirst && !(await leaveCurrent())) return;
      const remote = await projectsApi.get(p.id);
      show(remote.project, toCloud(remote));
      setShowProjects(false);
      flash(`Opened ${remote.name}`);
    });

  const duplicateProject = (p: ProjectSummary) =>
    task(async () => {
      if (!(await leaveCurrent())) return;
      const source = await projectsApi.get(p.id);
      const taken = await projectsApi.list().then((ps) => ps.map((x) => x.name));
      const copy = await projectsApi.create(projectName(`${source.name} (copy)`, taken), JSON.stringify(source.project));
      show(source.project, toCloud(copy));
      setShowProjects(false);
      flash(`Opened ${copy.name}, a copy of ${source.name}`);
    });

  const deleteProject = async (p: ProjectSummary): Promise<void> => {
    const isCurrent = p.id === cloud?.id;
    if (isCurrent) {
      await cloudSave.flush(); // nothing on its way that would bring the project back
      cloudSave.adopt(designJson);
    }
    await projectsApi.remove(p.id);
    if (!isCurrent) return;
    // The open project is gone: open the next one, or start a new one.
    const remaining = await projectsApi.list().catch(() => []);
    if (remaining.length) await openProject(remaining[0], false);
    else await createAndOpen(emptyProject(), 'Untitled design', (n) => `Started a new project, ${n}`, false);
  };

  const newProject = () => createAndOpen(emptyProject(), 'Untitled design', (n) => `Started ${n}. Your previous design is in My projects.`);

  const openTemplate = (t: AppTemplate) => {
    setShowTemplates(false);
    void createAndOpen(templateProject(t), t.title, (n) => `Opened the ${t.title} template as ${n}. Your previous design is in My projects.`);
  };

  /** Changed elsewhere: keep both by saving this version as a new project. */
  const keepBoth = () =>
    task(async () => {
      const name = projectName(`${cloud?.name ?? 'Untitled design'} (my version)`, await projectsApi.list().then((ps) => ps.map((p) => p.name)));
      const created = await projectsApi.create(name, designJson);
      cloudSave.adopt(designJson);
      setCloud(toCloud(created));
      flash(`Saved your version as ${created.name}. The other version is still in My projects.`, 6000);
    });

  // /?template=<slug> (the "Open in the editor" links on the template pages) opens that template once.
  const templateParamHandled = useRef(false);
  useEffect(() => {
    if (templateParamHandled.current) return;
    templateParamHandled.current = true;
    const params = new URLSearchParams(location.search);
    const t = templateBySlug(params.get('template'));
    if (!params.has('template')) return;
    params.delete('template');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (t && !state.codeError) openTemplate(t);
  }, []);

  /** Open a file from the computer (an app.R or a downloaded design) as a new project. */
  const open = async () => {
    const file = await openTextFile('.R,.r,.json');
    if (!file) return;
    const base = file.name.replace(/(\.shinydesign)?\.(json|r)$/i, '');
    const done = (n: string) => `Opened ${file.name} as ${n}. Your previous design is in My projects.`;
    if (/\.r$/i.test(file.name)) {
      // An R script: the code becomes the source of truth and the design is rebuilt from it.
      await createAndOpen({ ...emptyProject(), code: file.text }, base === 'app' ? 'Imported app' : base, done);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text);
    } catch {
      parsed = null;
    }
    if (!isProject(parsed)) return flash(`${file.name} is not a DropToApp project or R script`);
    await createAndOpen(parsed, base, done);
  };

  /** Download the design as a file (a backup, or to share). */
  const save = () => {
    const project: Project = { format: 'droptoapp/v1', root: state.root, code: state.codeDraft ?? undefined };
    const name = String(state.root.props.title || 'shiny-app').replace(/[^\w-]+/g, '-').toLowerCase();
    saveTextFile(`${name}.shinydesign.json`, JSON.stringify(project, null, 2), 'application/json');
  };

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      <div className={`app view-${view}`} style={{ zoom }}>
        <header className="toolbar">
          <div className="brand">
            <span className="logo">◆</span>
            <span className="brand-text"> DropToApp</span>
          </div>
          <button
            className="project-button"
            onClick={() => setShowProjects(true)}
            title={`${cloud ? `${cloud.name}\n` : ''}My projects: open, rename or delete your saved designs`}
          >
            <span className="project-name">{cloud?.name ?? 'Not saved yet'}</span>
            <span className="project-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          <div className="tool-group">
            <button disabled={draftLocked || busy} onClick={newProject} title={draftLocked ? draftLockHint : 'Start a new, empty project'}>
              New
            </button>
            <button disabled={draftLocked || busy} onClick={() => setShowTemplates(true)} title={draftLocked ? draftLockHint : 'Start a new project from a complete example app'}>
              Templates…
            </button>
            <button disabled={draftLocked || busy} onClick={open} title={draftLocked ? draftLockHint : 'Open an app.R or a downloaded design (.json) from your computer as a new project'}>
              Open…
            </button>
            <button
              onClick={save}
              aria-label="Download"
              title="Download this design as a file (.shinydesign.json). Projects are saved in your account automatically."
            >
              ⤓<span className="btn-label"> Download</span>
            </button>
          </div>
          <div className="tool-group">
            <button disabled={draftLocked || !state.past.length} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo" title={draftLocked ? draftLockHint : 'Undo (Ctrl+Z)'}>
              ↶<span className="btn-label"> Undo</span>
            </button>
            <button disabled={draftLocked || !state.future.length} onClick={() => dispatch({ type: 'redo' })} aria-label="Redo" title={draftLocked ? draftLockHint : 'Redo (Ctrl+Y)'}>
              ↷<span className="btn-label"> Redo</span>
            </button>
          </div>
          <span className="spacer" />
          <div className="segmented" role="group" aria-label="Preview width">
            {(['desktop', 'tablet', 'phone'] as Device[]).map((d) => (
              <button key={d} className={device === d ? 'is-on' : ''} onClick={() => setDevice(d)}>
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="View">
            {(['design', 'split', 'code'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          {running ? (
            <button className="run-button is-running" onClick={() => setRunning(false)} title="Stop the app and go back to the design">
              ■ Stop
            </button>
          ) : (
            <button
              className="run-button"
              disabled={!!state.codeError}
              onClick={startRun}
              title={state.codeError ? 'Fix the syntax error in app.R first' : 'Run the app for real, in your browser (Ctrl+Shift+Enter)'}
            >
              ▶ Run
            </button>
          )}
          <button className="primary" onClick={() => saveTextFile('app.R', code)}>
            Export app.R
          </button>
          <div className="account" title={user.email}>
            <span className="account-name">{user.name || user.email}</span>
            <button
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                await cloudSave.flush();
                await logout();
              }}
            >
              Log out
            </button>
          </div>
        </header>

        <aside className="left">
          <div className="panel-title">Components</div>
          <Palette />
          <div className="panel-title">Outline</div>
          <Outline />
        </aside>

        <main className="center">
          {running ? (
            // Stays mounted (hidden) in the code-only view, so switching views doesn't restart R.
            <RunPanel
              key={runKey}
              hidden={view === 'code'}
              code={code}
              codeError={state.codeError}
              width={DEVICE_WIDTH[device]}
              shinyliveBase={settings.shinyliveUrl}
            />
          ) : null}
          {view !== 'code' && !running ? <Canvas width={DEVICE_WIDTH[device]} /> : null}
          {view !== 'design' ? <CodeView generated={generated} issues={issues} /> : null}
        </main>

        <aside className="right">
          <div className="panel-title">Properties</div>
          <PropertiesPanel issues={issues} />
        </aside>

        {showTemplates ? <TemplateGallery onPick={openTemplate} onClose={() => setShowTemplates(false)} /> : null}

        {showProjects ? (
          <ProjectsDialog
            current={cloud}
            busy={busy || draftLocked}
            onOpen={(p) => void openProject(p)}
            onNew={() => void newProject()}
            onTemplates={() => {
              setShowProjects(false);
              setShowTemplates(true);
            }}
            onDuplicate={(p) => void duplicateProject(p)}
            onRenamed={(p) => {
              if (p.id === cloud?.id) setCloud((c) => (c ? { ...c, name: p.name } : c));
            }}
            onDelete={deleteProject}
            onClose={() => setShowProjects(false)}
          />
        ) : null}

        {cloudSave.status === 'conflict' ? (
          <div className="save-banner" role="alert">
            <span>
              <b>This project was changed in another window or on another computer</b>
              {cloudSave.theirs ? ` (${new Date(cloudSave.theirs.updatedAt).toLocaleString()})` : ''}. Your changes here are
              not saved to your account yet.
            </span>
            <button className="primary" disabled={busy} onClick={() => void keepBoth()} title="Save this version as a new project; the other one stays as it is">
              Keep both
            </button>
            <button disabled={busy} onClick={() => void cloudSave.keepMine()} title="Replace the other version with this one">
              Keep mine
            </button>
            <button disabled={busy} onClick={() => cloud && void openProject(cloud, false)} title="Throw away the changes here and open the other version">
              Use the other
            </button>
          </div>
        ) : cloudSave.status === 'loggedOut' ? (
          <div className="save-banner" role="alert">
            <span>
              <b>You were logged out.</b> Your changes are kept in this browser and saved to your account when you log in again.
            </span>
            <a className="button-link" href={`/login?next=${encodeURIComponent(location.pathname)}`}>
              Log in
            </a>
          </div>
        ) : null}

        {autosave.status === 'failed' && !cloudOk ? (
          <div className="save-failed" role="alert">
            <span>
              <b>Your changes are not being saved.</b> This browser refused to store the design (its storage may be
              full or blocked). Everything is still open here: download a copy to keep it safe.
            </span>
            <button className="primary" onClick={save}>
              Save a copy
            </button>
            <button onClick={autosave.retry}>Try again</button>
          </div>
        ) : null}

        <footer className="statusbar">
          <span>
            {count} component{count === 1 ? '' : 's'}
          </span>
          <span className={errors ? 'status-error' : warnings ? 'status-warning' : 'status-ok'}>
            {errors || warnings ? `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}` : 'No problems'}
          </span>
          <span className="spacer" />
          {message ? <span className="status-message">{message}</span> : null}
          <button
            className={`save-status is-${cloudSave.status}`}
            onClick={() => setShowProjects(true)}
            title={
              cloudSave.status === 'offline'
                ? 'No connection to the server. Your changes are kept in this browser and saved to your account automatically when the connection is back.'
                : 'Your project is saved in your account automatically. Click for My projects.'
            }
          >
            {STATUS_TEXT[cloudSave.status]}
          </button>
          <span className="hint">Drag from the left or click to add · Edit app.R directly in the code view · Ctrl+Z undo</span>
          <span className="zoom-control" role="group" aria-label="Editor size">
            <button onClick={() => zoomStep(-1)} disabled={zoom === ZOOM_STEPS[0]} aria-label="Smaller" title="Smaller: more fits on the screen">
              −
            </button>
            <button
              className="zoom-value"
              onClick={() => setZoom(DEFAULT_ZOOM)}
              title={`Editor size. Click to go back to ${Math.round(DEFAULT_ZOOM * 100)}%.`}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => zoomStep(1)} disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Larger" title="Larger: easier to read">
              +
            </button>
          </span>
        </footer>
      </div>
    </EditorContext.Provider>
  );
}
