import { useEffect, useMemo, useReducer, useState } from 'react';
import { generateApp } from '../model/codegen';
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
import type { User } from './auth';
import { openTextFile, saveTextFile, storage } from './platform';
import { PropertiesPanel } from './PropertiesPanel';

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

export function App({ user }: { user: User }) {
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

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [state.selectedId]);

  const flash = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(null), 2500);
  };

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
            <button onClick={() => dispatch({ type: 'load', project: emptyProject() })} title="Start an empty design (undo brings the old one back)">
              New
            </button>
            <button onClick={() => dispatch({ type: 'load', project: starterProject() })} title="Load the Old Faithful example">
              Example
            </button>
            <button onClick={open} title="Open a saved design (.json) or an existing app.R">
              Open…
            </button>
            <button onClick={save}>Save</button>
          </div>
          <div className="tool-group">
            <button disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} title="Undo (Ctrl+Z)">
              ↶ Undo
            </button>
            <button disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} title="Redo (Ctrl+Y)">
              ↷ Redo
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
          {view !== 'code' ? <Canvas width={DEVICE_WIDTH[device]} /> : null}
          {view !== 'design' ? <CodeView generated={generated} issues={issues} /> : null}
        </main>

        <aside className="right">
          <div className="panel-title">Properties</div>
          <PropertiesPanel issues={issues} />
        </aside>

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
