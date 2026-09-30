import type { Config } from './config';

export interface BrevoResult {
  /** Stored in users.brevo_status. */
  status: string;
  ok: boolean;
}

/**
 * Add a contact to the Brevo list from .env (POST /v3/contacts).
 * `updateEnabled` makes this work for addresses Brevo already knows too.
 * Never throws: the result is recorded on the user so failures can be retried.
 */
export async function subscribeToNewsletter(
  cfg: Config['brevo'],
  contact: { email: string; name?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoResult> {
  if (!cfg.apiKey || !cfg.listId) return { ok: false, status: 'skipped: BREVO_API_KEY or BREVO_LIST_ID not set' };
  const body: Record<string, unknown> = {
    email: contact.email,
    listIds: [cfg.listId],
    updateEnabled: true,
  };
  if (contact.name) body.attributes = { FIRSTNAME: contact.name };
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/contacts`, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    // 201 = contact created, 204 = existing contact updated
    if (res.status === 201 || res.status === 204) return { ok: true, status: 'subscribed' };
    let detail = '';
    try {
      const j = (await res.json()) as { code?: string; message?: string };
      detail = [j.code, j.message].filter(Boolean).join(': ');
    } catch {
      /* not JSON */
    }
    return { ok: false, status: `error: HTTP ${res.status}${detail ? ` ${detail}` : ''}`.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: `error: ${(e as Error).message}`.slice(0, 500) };
  }
}
