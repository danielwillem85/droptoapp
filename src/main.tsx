import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { fetchSession, goToLogin } from './ui/auth';
import type { Settings, User } from './ui/auth';
import './ui/styles.css';

/** Fade out the loading screen from index.html. Safe to call more than once. */
function hideBootScreen() {
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('is-done')) return;
  boot.classList.add('is-done');
  setTimeout(() => boot.remove(), 300); // after the CSS fade
}

/** Hides the loading screen once the app has actually been painted. */
function BootScreenDismisser() {
  useEffect(() => {
    // Two frames: the first lets the browser lay out and paint the app.
    const id = requestAnimationFrame(() => requestAnimationFrame(hideBootScreen));
    return () => cancelAnimationFrame(id);
  }, []);
  return null;
}

/**
 * Only logged-in users get the editor. In production the server already refuses
 * to send it to anyone else; this check also covers `npm run dev` and sessions
 * that expire while the page is open.
 */
function AuthGate() {
  const [session, setSession] = useState<{ user: User; settings: Settings } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((s) => {
        if (cancelled) return;
        if (s) setSession(s);
        else goToLogin();
      })
      .catch(() => window.__bootFailed?.());
    return () => {
      cancelled = true;
    };
  }, []);
  if (!session) return null; // the loading screen stays up meanwhile
  return (
    <>
      <App user={session.user} settings={session.settings} />
      <BootScreenDismisser />
    </>
  );
}

declare global {
  interface Window {
    __bootFailed?: () => void;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
