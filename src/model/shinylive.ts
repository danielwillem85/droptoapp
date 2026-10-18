import { compressToEncodedURIComponent } from './lzstring';

/**
 * Running an app in the browser with shinylive (https://shinylive.io): Shiny for R on webR, R compiled to
 * WebAssembly. The app's files travel in the URL's #fragment, which browsers never send to a server, so the
 * code stays on the user's machine; shinylive runs it there and installs the packages it uses from the webR
 * package repository.
 */

export const DEFAULT_SHINYLIVE_URL = 'https://shinylive.io';

export interface ShinyliveFile {
  name: string;
  content: string;
}

export type ShinyliveMode = 'app' | 'editor';

/** The `#code=` value shinylive expects: the files as JSON, sorted by name, lz-string compressed. */
export function encodeFiles(files: ShinyliveFile[]): string {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  return compressToEncodedURIComponent(JSON.stringify(sorted.map(({ name, content }) => ({ name, content }))));
}

/** Normalise a configured shinylive address: no trailing slash, http(s) or a same-site path only. */
export function shinyliveBase(configured: string | null | undefined): string {
  const v = (configured ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+(\/\S*)?$/i.test(v) || /^\/[^\s/]\S*$/.test(v)) return v;
  return DEFAULT_SHINYLIVE_URL;
}

/**
 * Link that runs `app.R` with shinylive.
 * - `app` shows only the running app (with `header: false`, also without shinylive's header bar);
 * - `editor` opens shinylive's own code editor next to the app.
 */
export function shinyliveUrl(
  appR: string,
  opts: { base?: string | null; mode?: ShinyliveMode; header?: boolean } = {},
): string {
  const base = shinyliveBase(opts.base);
  const mode = opts.mode ?? 'app';
  const header = opts.header ?? true;
  const code = encodeFiles([{ name: 'app.R', content: appR }]);
  return `${base}/r/${mode}/#${mode === 'app' && !header ? 'h=0&' : ''}code=${code}`;
}

/**
 * Packages the app loads. In the browser they come from the webR repository (repo.r-wasm.org), which has
 * most of CRAN but not packages that need system libraries or a network connection.
 */
export function packagesUsed(appR: string): string[] {
  const found = new Set<string>();
  const strip = appR.replace(/#[^\n]*/g, '');
  for (const m of strip.matchAll(/\b(?:library|require|requireNamespace)\(\s*["']?([A-Za-z][\w.]*)["']?/g)) found.add(m[1]);
  for (const m of strip.matchAll(/\b([A-Za-z][\w.]*):::?[A-Za-z.]/g)) found.add(m[1]);
  found.delete('base');
  return [...found].sort();
}
