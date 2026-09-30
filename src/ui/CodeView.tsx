import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { COMPONENTS } from '../model/components';
import { tokenizeR } from '../model/rHighlight';
import { findNode } from '../model/tree';
import type { Issue } from '../model/validate';
import { useEditor } from './context';
import { copyText, saveTextFile } from './platform';

const LINE_HEIGHT = 19; // px, must match .editor line-height in styles.css
const PADDING_TOP = 10;

/**
 * The app.R editor. Typing here updates the design live (see the 'setCode'
 * action); while the code doesn't parse, the design keeps its last valid state.
 */
export function CodeView({ generated, issues }: { generated: string; issues: Issue[] }) {
  const { state, dispatch } = useEditor();
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const code = state.codeDraft ?? generated;
  const error = state.codeError;
  const tokens = useMemo(() => tokenizeR(code), [code]);
  const lineCount = code.split('\n').length;

  // Line of the component selected on the canvas (inputs/outputs, found by id).
  const selectedLine = useMemo(() => {
    const node = state.selectedId ? findNode(state.root, state.selectedId) : null;
    const def = node ? COMPONENTS[node.type] : null;
    if (!node || !def?.rFn || typeof node.props.id !== 'string') return null;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`\\b${esc(def.rFn)}\\(\\s*"${esc(node.props.id)}"`).exec(code);
    return m ? code.slice(0, m.index).split('\n').length : null;
  }, [state.selectedId, state.root, code]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || selectedLine === null || document.activeElement === areaRef.current) return;
    const top = PADDING_TOP + (selectedLine - 1) * LINE_HEIGHT;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 2 * LINE_HEIGHT)
      el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' });
  }, [selectedLine]);

  const goToError = () => {
    const area = areaRef.current;
    if (!area || !error) return;
    const lines = code.split('\n');
    const offset = lines.slice(0, error.line - 1).reduce((n, l) => n + l.length + 1, 0) + Math.max(0, error.col - 1);
    area.focus();
    area.setSelectionRange(offset, offset);
    scrollRef.current?.scrollTo({ top: Math.max(0, (error.line - 4) * LINE_HEIGHT) });
  };

  const status = error
    ? { cls: 'is-error', text: 'Syntax error: design paused' }
    : state.codeDraft !== null && state.codeDraft !== generated
      ? { cls: 'is-edited', text: 'Edited by hand · design in sync' }
      : { cls: 'is-synced', text: 'In sync with the design' };

  return (
    <div className="code-view">
      <div className="code-toolbar">
        <span className="code-file">app.R</span>
        <span className={`code-status ${status.cls}`}>{status.text}</span>
        <span className="spacer" />
        {state.codeDraft !== null && !error && state.codeDraft !== generated ? (
          <button
            onClick={() => dispatch({ type: 'discardCode' })}
            title="Replace your formatting with the code generated from the design. Comments inside the UI are not kept."
          >
            Reformat
          </button>
        ) : null}
        <button
          onClick={async () => {
            setCopied(await copyText(code));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button className="primary" onClick={() => saveTextFile('app.R', code)}>
          Download app.R
        </button>
      </div>
      {error ? (
        <div className="code-error" role="alert">
          <span>
            <b>
              Line {error.line}, column {error.col}:
            </b>{' '}
            {error.message}. The design will update once the code is valid again.
          </span>
          <button onClick={goToError}>Go to error</button>
          <button onClick={() => dispatch({ type: 'discardCode' })} title="Throw away the code edits and show the code for the current design">
            Discard edits
          </button>
        </div>
      ) : issues.length ? (
        <ul className="code-issues">
          {issues.map((i, k) => (
            <li key={k} className={`is-${i.severity}`} onClick={() => dispatch({ type: 'select', id: i.nodeId })}>
              <b>{i.severity === 'error' ? 'Error' : 'Warning'}:</b> {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="code-scroll" ref={scrollRef}>
        <pre className="gutter" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i} className={error?.line === i + 1 ? 'is-error' : selectedLine === i + 1 ? 'is-selected' : undefined}>
              {i + 1}
              {'\n'}
            </span>
          ))}
        </pre>
        <div className="editor">
          {selectedLine !== null ? <div className="line-mark is-selected" style={{ top: PADDING_TOP + (selectedLine - 1) * LINE_HEIGHT }} /> : null}
          {error ? <div className="line-mark is-error" style={{ top: PADDING_TOP + (error.line - 1) * LINE_HEIGHT }} /> : null}
          <pre className="editor-hl" aria-hidden>
            <code>
              {tokens.map((t, i) =>
                t.kind === 'plain' ? (
                  t.text
                ) : (
                  <span key={i} className={`tok-${t.kind}`}>
                    {t.text}
                  </span>
                ),
              )}
              {'\n '}
            </code>
          </pre>
          <textarea
            ref={areaRef}
            className="editor-input"
            aria-label="app.R source code"
            value={code}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            onChange={(e) => dispatch({ type: 'setCode', code: e.target.value })}
            onKeyDown={onEditorKey}
          />
        </div>
      </div>
    </div>
  );
}

/** Tab inserts two spaces; Enter keeps the indentation (and indents after an opening bracket). */
function onEditorKey(e: KeyboardEvent<HTMLTextAreaElement>) {
  const el = e.currentTarget;
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    insert(el, '  ');
  } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const before = el.value.slice(0, el.selectionStart);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    const indent = /^\s*/.exec(line)![0] + (/[({[]\s*$/.test(line) ? '  ' : '');
    e.preventDefault();
    insert(el, '\n' + indent);
  }
}

/** Insert text at the caret, keeping the browser's native undo history. */
function insert(el: HTMLTextAreaElement, text: string) {
  // execCommand is deprecated but still the only way to keep textarea undo working.
  if (!document.execCommand('insertText', false, text)) {
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
