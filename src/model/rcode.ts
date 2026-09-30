/** Small helpers for emitting readable R source code. */

export function rStr(s: string): string {
  return (
    '"' +
    s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, '\\n')
      .replace(/\t/g, '\\t') +
    '"'
  );
}

export function rBool(b: boolean): string {
  return b ? 'TRUE' : 'FALSE';
}

/** Numbers are emitted as-is; empty / invalid values return undefined. */
export function rNum(v: unknown): string | undefined {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return String(n);
}

export function rStrVec(values: string[]): string {
  if (values.length === 1) return rStr(values[0]);
  return `c(${values.map(rStr).join(', ')})`;
}

export function rNumVec(values: number[]): string {
  if (values.length === 1) return String(values[0]);
  return `c(${values.join(', ')})`;
}

export function indent(code: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}

const MAX_INLINE = 72;

/**
 * Format a function call. Short calls stay on one line; longer ones put
 * every argument on its own indented line, the way styler would.
 */
export function rCall(fn: string, args: (string | undefined | null | false)[]): string {
  const clean = args.filter((a): a is string => typeof a === 'string' && a.length > 0);
  if (clean.length === 0) return `${fn}()`;
  const oneLine = `${fn}(${clean.join(', ')})`;
  if (oneLine.length <= MAX_INLINE && !clean.some((a) => a.includes('\n'))) return oneLine;
  return `${fn}(\n${clean.map((a) => indent(a)).join(',\n')}\n)`;
}

/** `name = value`, or undefined when value is undefined. */
export function named(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${name} = ${value}`;
}

/** Parse "4, 8" / "4 8" / "c(4, 8)" into [4, 8]. Invalid parts are dropped. */
export function parseWidths(s: string): number[] {
  return s
    .replace(/^\s*c\(|\)\s*$/g, '')
    .split(/[\s,]+/)
    .map((p) => Number(p))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
}

export const VALID_R_ID = /^[A-Za-z][A-Za-z0-9_.]*$/;
