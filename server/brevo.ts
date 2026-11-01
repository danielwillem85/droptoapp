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

/** Send one administrative notification (to NOTIFY_EMAILS); independent of newsletter consent. Never throws. */
export async function sendAccountNotification(
  cfg: Config['brevo'],
  account: { id: number; email: string; name: string; newsletter: boolean; createdAt: string },
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoResult> {
  if (!cfg.apiKey) return { ok: false, status: 'skipped: BREVO_API_KEY not set' };
  if (!cfg.notifyEmails.length) return { ok: false, status: 'skipped: NOTIFY_EMAILS is empty' };
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: cfg.senderEmail, name: 'DropToApp' },
        to: cfg.notifyEmails.map((email) => ({ email })),
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

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A transactional email through Brevo (POST /v3/smtp/email). Never throws. */
async function sendEmail(
  cfg: Config['brevo'],
  mail: { to: { email: string; name?: string }; subject: string; text: string; html: string },
  fetchImpl: typeof fetch,
): Promise<BrevoResult> {
  if (!cfg.apiKey) return { ok: false, status: 'skipped: BREVO_API_KEY not set' };
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: cfg.senderEmail, name: 'DropToApp' },
        to: [mail.to.name ? mail.to : { email: mail.to.email }],
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
        // Tagged so these emails are easy to find in Brevo's transactional logs.
        tags: ['account'],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 201) return { ok: true, status: 'accepted' };
    return { ok: false, status: await errorStatus(res) };
  } catch (e) {
    return { ok: false, status: `error: ${(e as Error).message}`.slice(0, 500) };
  }
}

function emailHtml(name: string, paragraphs: string[], button?: { label: string; url: string }): string {
  const p = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font:15px/1.55 -apple-system,'Segoe UI',Arial,sans-serif;color:#1f2328">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e1e4e8;border-radius:10px;padding:28px">
<p style="margin:0 0 20px;font-weight:700;font-size:18px"><span style="color:#2563eb">&#9670;</span> DropToApp</p>
${p(`Hi${name ? ` ${escapeHtml(name)}` : ''},`)}
${paragraphs.map(p).join('\n')}
${button ? `<p style="margin:22px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#5d6673">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(button.url)}</span></p>` : ''}
</div></body></html>`;
}

/** The "Forgot your password?" email with the single-use link. */
export function sendPasswordResetEmail(
  cfg: Config['brevo'],
  user: { email: string; name: string },
  link: string,
  minutes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoResult> {
  const intro = 'Someone (hopefully you) asked to reset the password of your DropToApp account.';
  const valid = `The link works once and expires in ${minutes} minutes.`;
  const ignore = "If you didn't ask for this, you can ignore this email: your password stays the same.";
  return sendEmail(
    cfg,
    {
      to: { email: user.email, name: user.name || undefined },
      subject: 'Reset your DropToApp password',
      text: [`Hi${user.name ? ` ${user.name}` : ''},`, '', intro, 'Choose a new password here:', '', link, '', valid, '', ignore, '', 'DropToApp'].join('\n'),
      html: emailHtml(user.name, [intro, valid, ignore], { label: 'Choose a new password', url: link }),
    },
    fetchImpl,
  );
}

/** Sent after a password change, so an unexpected change gets noticed. */
export function sendPasswordChangedEmail(
  cfg: Config['brevo'],
  user: { email: string; name: string },
  resetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoResult> {
  const lines = [
    'The password of your DropToApp account was just changed, and you were logged out on your other devices.',
    "If that was you, there's nothing else to do.",
    `If it wasn't, reset your password right away at ${resetUrl} and reply to this email.`,
  ];
  return sendEmail(
    cfg,
    {
      to: { email: user.email, name: user.name || undefined },
      subject: 'Your DropToApp password was changed',
      text: [`Hi${user.name ? ` ${user.name}` : ''},`, '', ...lines, '', 'DropToApp'].join('\n'),
      html: emailHtml(user.name, lines.map(escapeHtml)),
    },
    fetchImpl,
  );
}

/** Tell NOTIFY_EMAILS that someone logged in. Never throws. */
export async function sendLoginNotification(
  cfg: Config['brevo'],
  login: { id: number; email: string; name: string; how: string; ip: string; browser: string; at: string },
  fetchImpl: typeof fetch = fetch,
): Promise<BrevoResult> {
  if (!cfg.apiKey) return { ok: false, status: 'skipped: BREVO_API_KEY not set' };
  if (!cfg.notifyEmails.length) return { ok: false, status: 'skipped: NOTIFY_EMAILS is empty' };
  try {
    const res = await fetchImpl(`${cfg.apiUrl}/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: cfg.senderEmail, name: 'DropToApp' },
        to: cfg.notifyEmails.map((email) => ({ email })),
        subject: `DropToApp login: ${login.email}`,
        textContent: [
          'Someone logged in to DropToApp.',
          '',
          `Name: ${login.name || '(not provided)'}`,
          `Email: ${login.email}`,
          `Account ID: ${login.id}`,
          `How: ${login.how}`,
          `Time (UTC): ${login.at}`,
          `IP address: ${login.ip}`,
          `Browser: ${login.browser || '(unknown)'}`,
        ].join('\n'),
        tags: ['login'],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 201) return { ok: true, status: 'accepted' };
    return { ok: false, status: await errorStatus(res) };
  } catch (e) {
    return { ok: false, status: `error: ${(e as Error).message}`.slice(0, 500) };
  }
}
