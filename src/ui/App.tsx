import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { generateApp } from '../model/codegen';
import { templateBySlug, templateProject } from '../model/gallery';
import type { AppTemplate } from '../model/gallery';
import { emptyProject, isProject, starterProject } from '../model/templates';
import { walk } from '../model/tree';
import type { Project } from '../model/types';
import { validate } from '../model/validate';
import { initialState, reducer } from '../state/store';
import { Canvas } from './Canvas';
import { CodeView } from './CodeView';
import { EditorContext } from './context';
import { Outline } from './Outline';
import { Palette } from './Palette';
import { logout } from './auth';
import type { Settings, User } from './auth';
import { openTextFile, saveTextFile, storage } from './platform';
import { PropertiesPanel } from './PropertiesPanel';
import { RunPanel } from './RunPanel';
import { TemplateGallery } from './TemplateGallery';

const AUTOSAVE_PREFIX = 'droptoapp:autosave';
/** Keys used before the rename (per user, and from before accounts existed). */
const LEGACY_AUTOSAVE_PREFIX = 'truth-editor:autosave';
type View = 'design' | 'split' | 'code';
type Device = 'desktop' | 'tablet' | 'phone';
const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, phone: 400 };

function loadAutosave(key: string): Project | null {
  const raw = storage.load(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function App({ user, settings }: { user: User; settings: Settings }) {
  // Autosave per account, so people sharing a browser don't see each other's designs.
  // Designs autosaved by earlier versions (under the old name) are picked up once.
  const autosaveKey = `${AUTOSAVE_PREFIX}:${user.id}`;
  const [state, dispatch] = useReducer(reducer, null, () => initialState(
      loadAutosave(autosaveKey) ??
        loadAutosave(`${LEGACY_AUTOSAVE_PREFIX}:${user.id}`) ??
        loadAutosave(LEGACY_AUTOSAVE_PREFIX) ??
        starterProject(),
    ));
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

  // Autosave (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      const project: Project = { format: 'droptoapp/v1', root: state.root, code: state.codeDraft ?? undefined };
      storage.save(autosaveKey, JSON.stringify(project));
    }, 300);
    return () => clearTimeout(t);
  }, [state.root, state.codeDraft]);

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

  const openTemplate = (t: AppTemplate) => {
    setShowTemplates(false);
    dispatch({ type: 'load', project: templateProject(t) });
    flash(`Opened the ${t.title} template. Undo brings back your previous design.`, 5000);
  };

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

  const open = async () => {
    const file = await openTextFile('.R,.r,.json');
    if (!file) return;
    if (/\.r$/i.test(file.name)) {
      // An R script: the code becomes the source of truth and the design is rebuilt from it.
      dispatch({ type: 'load', project: { ...emptyProject(), code: file.text } });
      flash(`Opened ${file.name}`);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(file.text);
      if (!isProject(parsed)) throw new Error('not a DropToApp project');
      dispatch({ type: 'load', project: parsed });
      flash(`Opened ${file.name}`);
    } catch {
      flash(`${file.name} is not a DropToApp project or R script`);
    }
  };

  const save = () => {
    const project: Project = { format: 'droptoapp/v1', root: state.root, code: state.codeDraft ?? undefined };
    const name = String(state.root.props.title || 'shiny-app').replace(/[^\w-]+/g, '-').toLowerCase();
    saveTextFile(`${name}.shinydesign.json`, JSON.stringify(project, null, 2), 'application/json');
  };

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      <div className={`app view-${view}`}>
        <header className="toolbar">
          <div className="brand">
            <span className="logo">◆</span> DropToApp <span className="brand-sub">Shiny UI designer</span>
          </div>
          <div className="tool-group">
            <button disabled={draftLocked} onClick={() => dispatch({ type: 'load', project: emptyProject() })} title={draftLocked ? draftLockHint : 'Start an empty design (undo brings the old one back)'}>
              New
            </button>
            <button disabled={draftLocked} onClick={() => setShowTemplates(true)} title={draftLocked ? draftLockHint : 'Start from a complete example app'}>
              Templates…
            </button>
            <button disabled={draftLocked} onClick={open} title={draftLocked ? draftLockHint : 'Open a saved design (.json) or an existing app.R'}>
              Open…
            </button>
            <button onClick={save}>Save</button>
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

        <footer className="statusbar">
          <span>
            {count} component{count === 1 ? '' : 's'}
          </span>
          <span className={errors ? 'status-error' : warnings ? 'status-warning' : 'status-ok'}>
            {errors || warnings ? `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}` : 'No problems'}
          </span>
          <span className="spacer" />
          {message ? <span className="status-message">{message}</span> : null}
          <span className="hint">Drag from the left or click to add · Edit app.R directly in the code view · Ctrl+Z undo</span>
        </footer>
      </div>
    </EditorContext.Provider>
  );
}
