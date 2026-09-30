/** The logged-in user, as returned by the server (server/app.ts). */
export interface User {
  id: number;
  email: string;
  name: string;
  newsletter: boolean;
}

/** Send the browser to the login page, coming back here afterwards. */
export function goToLogin() {
  const here = location.pathname + location.search;
  location.replace(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`);
}

/** The current user, or null when not logged in (the caller should then go to the login page). */
export async function fetchCurrentUser(): Promise<User | null> {
  const res = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Could not check your login (HTTP ${res.status}).`);
  return ((await res.json()) as { user: User }).user;
}

export async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
  } finally {
    location.replace('/login');
  }
}
