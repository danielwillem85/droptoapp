import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, projectJson, projectsApi, toCloud } from './projects';
import type { CloudProject, ProjectSummary } from './projects';

/**
 * 'saved'     the design is saved in the account
 * 'pending'   saving shortly (changes come in while typing)
 * 'saving'    a save is on its way
 * 'offline'   no connection: kept in this browser, tried again every few seconds
 * 'conflict'  the project was changed in another window or on another computer
 * 'loggedOut' the session ended: kept in this browser until you log in again
 */
export type CloudStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'loggedOut';

const DELAY = 1000;
const RETRY = 5_000;
/** Browsers limit requests sent while a page closes (keepalive) to 64 KB. */
const KEEPALIVE_LIMIT = 60_000;

/**
 * Keep the open project saved in the account. `value` is the design as JSON; `cloud` says which
 * project it is (null: not created yet, e.g. after starting offline, so the first save creates it).
 */
export function useCloudSave({
  cloud,
  setCloud,
  value,
  newName,
  initiallySynced,
}: {
  cloud: CloudProject | null;
  setCloud: (c: CloudProject) => void;
  value: string;
  /** Name for the project when it has to be created. */
  newName: () => string;
  initiallySynced: boolean;
}) {
  const [status, setStatus] = useState<CloudStatus>(initiallySynced ? 'saved' : 'pending');
  /** For 'conflict': the version in the account. */
  const [theirs, setTheirs] = useState<ProjectSummary | null>(null);
  const cloudRef = useRef(cloud);
  const valueRef = useRef(value);
  /** The design as last confirmed by the server. */
  const acked = useRef<string | null>(initiallySynced ? value : null);
  const blocked = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const newNameRef = useRef(newName);
  newNameRef.current = newName;
  cloudRef.current = cloud;

  const send = useCallback(async (force = false): Promise<boolean> => {
    clearTimeout(timer.current);
    while (inflight.current) await inflight.current;
    const v = valueRef.current;
    if (v === acked.current) {
      setStatus('saved');
      return true;
    }
    if (blocked.current && !force) return false;
    setStatus('saving');
    const attempt = (async (): Promise<boolean> => {
      try {
        const c = cloudRef.current;
        let saved: ProjectSummary;
        try {
          saved = c ? await projectsApi.save(c.id, v, c.version, force) : await projectsApi.create(newNameRef.current(), v);
        } catch (e) {
          if (!(e instanceof ApiError) || !c) throw e;
          if (e.status === 404) {
            // Deleted in another window: keep the work as a new project.
            saved = await projectsApi.create(c.name, v);
          } else if (e.status === 409) {
            // Not a real conflict when the account already has exactly this design, e.g. when the
            // save sent while the page was closing did arrive.
            const remote = await projectsApi.get(c.id);
            if (projectJson(remote.project) !== v) throw e;
            saved = remote;
          } else throw e;
        }
        acked.current = v;
        blocked.current = false;
        setTheirs(null);
        cloudRef.current = toCloud(saved);
        setCloud(cloudRef.current);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.data.current) {
          blocked.current = true;
          setTheirs(e.data.current as ProjectSummary);
          setStatus('conflict');
        } else if (e instanceof ApiError && e.status === 401) {
          setStatus('loggedOut');
          timer.current = setTimeout(() => void send(), RETRY * 3);
        } else {
          setStatus('offline');
          timer.current = setTimeout(() => void send(), RETRY);
        }
        return false;
      }
    })();
    inflight.current = attempt;
    const ok = await attempt;
    inflight.current = null;
    if (ok) {
      if (valueRef.current !== acked.current) {
        setStatus('pending');
        timer.current = setTimeout(() => void send(), DELAY);
      } else setStatus('saved');
    }
    return ok;
  }, [setCloud]);

  useEffect(() => {
    valueRef.current = value;
    if (value === acked.current) {
      setStatus((s) => (s === 'pending' ? 'saved' : s));
      return;
    }
    if (blocked.current) return;
    setStatus((s) => (s === 'offline' || s === 'loggedOut' ? s : 'pending'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(), DELAY);
  }, [value, send]);

  // Closing or reloading the page: send the last change if it is small enough to go along.
  // (If it doesn't arrive, this browser's copy has it and it is sent next time.)
  useEffect(() => {
    const onHide = () => {
      const c = cloudRef.current;
      const v = valueRef.current;
      if (!c || v === acked.current || blocked.current || inflight.current || v.length > KEEPALIVE_LIMIT) return;
      void projectsApi.save(c.id, v, c.version, false, true).catch(() => {});
    };
    // Back online: try right away instead of waiting for the next retry.
    const onOnline = () => {
      if (valueRef.current !== acked.current && !blocked.current) void send();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('online', onOnline);
      clearTimeout(timer.current);
    };
  }, [send]);

  return {
    status,
    /** The version in the account, when it was changed elsewhere. */
    theirs,
    /** Save now (e.g. before switching to another project). True when everything is saved. */
    flush: useCallback(() => send(false), [send]),
    /** Conflict: overwrite the account's version with this one. */
    keepMine: useCallback(() => send(true), [send]),
    /** The editor is about to show `json`, a design that is already saved in the account (just opened or created). */
    adopt: useCallback((json: string) => {
      clearTimeout(timer.current);
      acked.current = json;
      blocked.current = false;
      setTheirs(null);
      setStatus('saved');
    }, []),
  };
}
