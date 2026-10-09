import type { Config } from './config';

export interface BrevoResult {
  /** Delivery/subscription outcome for logging or persistence. */
  status: string;
  ok: boolean;
}

async function errorStatus(res: Response): Promise<string> {
  let detail = '';
  try {
    const j = (await res.json()) as { code?: string; message?: string };
    detail = [j.code, j.message].filter(Boolean).join(': ');
  } catch {
    /* not JSON */
  }
  return `error: HTTP ${res.status}${detail ? ` ${detail}` : ''}`.slice(0, 500);
}

/** Send one administrative notification; independent of newsletter consent. Never throws. */
export async function sendAccountNotification(
  cfg: Config['brevo'],
  account: { id: number; email: string; name: string; newsletter: boolean; createdAt: string },
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoResult> {
  if (!cfg.apiKey) return { ok: false, status: 'skipped: BREVO_API_KEY not set' };
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: cfg.senderEmail, name: 'DropToApp' },
        to: [{ email: 'info@droptoapp.com' }],
        subject: 'New DropToApp account created',
        textContent: [
          'A new DropToApp account was created.',
          '',
          `Name: ${account.name || '(not provided)'}`,
          `Email: ${account.email}`,
          `Account ID: ${account.id}`,
          `Created at (UTC): ${account.createdAt}`,
          `Newsletter: ${account.newsletter ? 'Opted in' : 'Not opted in'}`,
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 201) return { ok: true, status: 'accepted' };
    return { ok: false, status: await errorStatus(res) };
  } catch (e) {
    return { ok: false, status: `error: ${(e as Error).message}`.slice(0, 500) };
  }
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
    return { ok: false, status: await errorStatus(res) };
  } catch (e) {
    return { ok: false, status: `error: ${(e as Error).message}`.slice(0, 500) };
  }
}
