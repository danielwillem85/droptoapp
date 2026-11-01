import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { storage } from './platform';

/** 'saved': stored in this browser · 'pending': a save is about to happen · 'failed': the browser refused. */
export type SaveStatus = 'saved' | 'pending' | 'failed';

/**
 * Keep `value` saved in browser storage under `key`.
 *
 * Saves shortly after each change (so fast typing is one write), and right away when the page is
 * hidden, closed or reloaded, so the latest edit is not lost. Reports whether the last save worked;
 * when it failed, it tries again on the next change and leaving the page asks for confirmation.
 * (Nothing can save during a browser or computer crash, so a very recent edit can still be lost then.)
 */
export function useAutosave(
  key: string,
  value: string,
  { delay = 300, safeElsewhere = () => false }: { delay?: number; /** The work is also saved elsewhere (the account): no need to warn on leaving. */ safeElsewhere?: () => boolean } = {},
): { status: SaveStatus; retry: () => void } {
  const safeRef = useRef(safeElsewhere);
  safeRef.current = safeElsewhere;
  const [status, setStatus] = useState<SaveStatus>('saved');
  // What is in storage, and what should be. When the design was loaded from somewhere else (an older
  // key, or the starter design), it is saved under `key` on the first round.
  const [stored] = useState(() => storage.load(key));
  const saved = useRef<{ key: string; value: string | null }>({ key, value: stored });
  const latest = useRef({ key, value });
  const failed = useRef(false);

  const flush = useCallback(() => {
    const { key, value } = latest.current;
    if (!failed.current && saved.current.key === key && saved.current.value === value) return;
    const ok = storage.save(key, value);
    failed.current = !ok;
    if (ok) saved.current = { key, value };
    setStatus(ok ? 'saved' : 'failed');
  }, []);

  // Layout effect: the ref is up to date before the browser can paint or unload the page.
  useLayoutEffect(() => {
    latest.current = { key, value };
    if (saved.current.key === key && saved.current.value === value) return;
    if (!failed.current) setStatus('pending');
    const timer = setTimeout(flush, delay);
    return () => clearTimeout(timer);
  }, [key, value, delay, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      flush();
      // Unsaved work the browser would not store: ask before leaving.
      if (failed.current && !safeRef.current()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onLeave);
      document.removeEventListener('visibilitychange', onHide);
      flush(); // e.g. logging out
    };
  }, [flush]);

  return { status, retry: flush };
}
