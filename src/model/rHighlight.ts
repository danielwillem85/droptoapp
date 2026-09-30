export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'fn' | 'op' | 'plain';
export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'function', 'if', 'else', 'for', 'while', 'repeat', 'in', 'next', 'break', 'return',
  'TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'library',
]);

const RULES: [TokenKind, RegExp][] = [
  ['comment', /^#[^\n]*/],
  ['string', /^"(?:[^"\\]|\\.)*"?|^'(?:[^'\\]|\\.)*'?/],
  ['number', /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?L?/],
  ['op', /^(?:<-|->|<=|>=|==|!=|\|>|%[^%\n]*%|[-+*/^=<>!&|$@~:])/],
];

/** A tiny tokenizer for R — good enough for syntax colouring generated code. */
export function tokenizeR(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === 'plain') last.text += text;
    else out.push({ kind, text });
  };
  while (i < src.length) {
    const rest = src.slice(i);
    let matched = false;
    for (const [kind, re] of RULES) {
      const m = re.exec(rest);
      if (m && m[0].length) {
        push(kind, m[0]);
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ident = /^[A-Za-z.][A-Za-z0-9._]*/.exec(rest);
    if (ident) {
      const word = ident[0];
      const after = rest.slice(word.length);
      if (KEYWORDS.has(word)) push('keyword', word);
      else if (/^\s*\(/.test(after)) push('fn', word);
      else push('plain', word);
      i += word.length;
      continue;
    }
    push('plain', src[i]);
    i += 1;
  }
  return out;
}
