import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Settings from the environment (and `.env`, if present). */
export interface Config {
  port: number;
  host: string;
  databasePath: string;
  /** Folder with the built editor (`npm run build`). Only served to logged-in users. */
  distDir: string;
  /** Send the session cookie over HTTPS only. Turn on in production. */
  cookieSecure: boolean;
  /** Behind nginx: take the client IP (for rate limiting) from X-Real-IP. */
  trustProxy: boolean;
  sessionDays: number;
  /**
   * Public address of the site, like https://droptoapp.com (no trailing slash). Used for the canonical link,
   * social preview images and sitemap.xml. When empty, it is worked out from each request's Host header.
   */
  siteUrl: string;
  /** Whether the newsletter box on the registration form starts ticked. */
  newsletterCheckedByDefault: boolean;
  brevo: {
    apiKey: string;
    listId: number | null;
    apiUrl: string;
  };
}

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export function loadConfig(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): Config {
  const listId = Number(env.BREVO_LIST_ID);
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '127.0.0.1',
    databasePath: resolve(root, env.DATABASE_PATH || 'data/droptoapp.db'),
    distDir: resolve(root, env.DIST_DIR || 'dist'),
    cookieSecure: bool(env.COOKIE_SECURE, false),
    trustProxy: bool(env.TRUST_PROXY, false),
    sessionDays: Number(env.SESSION_DAYS) || 30,
    siteUrl: (env.SITE_URL || '').trim().replace(/\/+$/, ''),
    newsletterCheckedByDefault: bool(env.NEWSLETTER_CHECKED_BY_DEFAULT, false),
    brevo: {
      apiKey: env.BREVO_API_KEY || '',
      listId: Number.isInteger(listId) && listId > 0 ? listId : null,
      apiUrl: (env.BREVO_API_URL || 'https://api.brevo.com/v3').replace(/\/+$/, ''),
    },
  };
}

/** Load `.env` into process.env (existing variables win). */
export function loadDotEnv(file = resolve(process.cwd(), '.env')) {
  if (existsSync(file)) process.loadEnvFile(file);
}
