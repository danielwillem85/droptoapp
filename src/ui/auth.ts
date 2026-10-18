/** The logged-in user, as returned by the server (server/app.ts). */
export interface User {
  id: number;
  email: string;
  name: string;
  newsletter: boolean;
}

/** Server settings the editor needs (from the server's .env). */
export interface Settings {
  /** shinylive site the Run button uses. */
  shinyliveUrl: string;
}

/** Send the browser to the login page, coming back here afterwards. */
export function goToLogin() {
  const here = location.pathname + location.search;
  location.replace(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`);
}

/** The current user and settings, or null when not logged in (the caller should then go to the login page). */
export async function fetchSession(): Promise<{ user: User; settings: Settings } | null> {
  const res = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Could not check your login (HTTP ${res.status}).`);
  const data = (await res.json()) as { user: User; settings?: Partial<Settings> };
  return { user: data.user, settings: { shinyliveUrl: data.settings?.shinyliveUrl ?? '' } };
}

export async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
  } finally {
    location.replace('/login');
  }
}
