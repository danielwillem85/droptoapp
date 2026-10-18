import { useMemo, useState } from 'react';
import { packagesUsed, shinyliveUrl } from '../model/shinylive';

/**
 * Runs the app for real, in the browser: shinylive starts webR (R compiled to WebAssembly), installs the
 * packages the app uses and runs Shiny, all on the user's machine. The app.R travels in the URL #fragment,
 * which is never sent to a server.
 *
 * A run uses the code as it was when it started; after edits, Restart picks up the latest version.
 */
export function RunPanel({
  code,
  codeError,
  width,
  shinyliveBase,
  hidden = false,
}: {
  code: string;
  /** Line of a syntax error in the current code, if any: it can't be run until fixed. */
  codeError: { line: number; message: string } | null;
  width: number | null;
  shinyliveBase: string;
  hidden?: boolean;
}) {
  const [run, setRun] = useState(() => ({ code, id: 1 }));
  const [loaded, setLoaded] = useState(false);
  const stale = code !== run.code;

  const frameUrl = useMemo(() => shinyliveUrl(run.code, { base: shinyliveBase, header: false }), [run.code, shinyliveBase]);
  const tabUrl = useMemo(() => shinyliveUrl(code, { base: shinyliveBase }), [code, shinyliveBase]);
  const editorUrl = useMemo(() => shinyliveUrl(code, { base: shinyliveBase, mode: 'editor' }), [code, shinyliveBase]);
  const packages = useMemo(() => packagesUsed(run.code), [run.code]);

  const restart = () => {
    setLoaded(false);
    setRun((r) => ({ code, id: r.id + 1 }));
  };
  const blocked = codeError ? `Fix the syntax error on line ${codeError.line} first.` : '';

  return (
    <div className="run-area" hidden={hidden}>
      <div className="run-bar">
        <span className="run-live" aria-hidden="true" />
        <b>Live app</b>
        <span className="run-sub">running in your browser with webR</span>
        <span className="spacer" />
        {stale ? <span className="run-stale">Code changed since this run</span> : null}
        <button
          className={stale ? 'primary' : ''}
          disabled={!!codeError}
          onClick={restart}
          title={blocked || 'Run the latest version of app.R (Ctrl+Shift+Enter)'}
        >
          ↻ Restart
        </button>
        <a className="run-link" href={tabUrl} target="_blank" rel="noopener noreferrer" title="Open the running app in its own browser tab">
          New tab ↗
        </a>
        <a
          className="run-link"
          href={editorUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in shinylive's own editor, with an R console: handy for reading R errors"
        >
          R console ↗
        </a>
      </div>

      <div className="run-scroll">
        <div className="browser-frame run-frame" style={{ maxWidth: width ?? undefined }}>
          <div className="frame-bar">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            <span className="frame-tab">Shiny app</span>
            <span className="frame-layout">{packages.length ? packages.join(' · ') : 'shiny'}</span>
          </div>
          <div className="run-viewport">
            {!loaded ? (
              <div className="run-loading" role="status">
                <div className="run-spinner" aria-hidden="true" />
                Starting R in your browser…
              </div>
            ) : null}
            <iframe
              key={run.id}
              src={frameUrl}
              title="Running Shiny app"
              referrerPolicy="no-referrer"
              allow="clipboard-write; fullscreen"
              onLoad={() => setLoaded(true)}
            />
          </div>
        </div>
      </div>

      <div className="run-note">
        The first start downloads R and your app's packages, which can take a minute; later starts are faster. Blank or
        stuck? Open it in a{' '}
        <a href={tabUrl} target="_blank" rel="noopener noreferrer">
          new tab
        </a>
        .
      </div>
    </div>
  );
}
