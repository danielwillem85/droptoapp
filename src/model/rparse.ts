/**
 * A parser for (most of) the R language, written for DropToApp.
 *
 * It produces a small AST where every node carries its source offsets, so the
 * importer can copy the user's original text (server bodies, helper code) as-is.
 * It covers the syntax that shows up in Shiny apps: calls with named/empty
 * arguments, all operators with R's precedence, `function`/`\(x)`, `if`/`else`,
 * loops, blocks, indexing, `pkg::fn`, backtick names and raw strings.
 */

export interface Span {
  s: number; // start offset (inclusive)
  e: number; // end offset (exclusive)
}

export type RNode =
  | ({ k: 'num'; value: number; raw: string } & Span)
  | ({ k: 'str'; value: string } & Span)
  | ({ k: 'ident'; name: string } & Span) // includes pkg::name and backtick names
  | ({ k: 'const'; name: string } & Span) // TRUE, FALSE, NULL, NA, Inf, NaN, NA_*_
  | ({ k: 'call'; fn: RNode; args: RArg[] } & Span)
  | ({ k: 'index'; obj: RNode; args: RArg[]; double: boolean } & Span)
  | ({ k: 'binary'; op: string; lhs: RNode; rhs: RNode } & Span)
  | ({ k: 'unary'; op: string; arg: RNode } & Span)
  | ({ k: 'paren'; expr: RNode } & Span)
  | ({ k: 'block'; body: RNode[] } & Span)
  | ({ k: 'function'; params: RArg[]; body: RNode } & Span)
  | ({ k: 'if'; cond: RNode; then: RNode; else?: RNode } & Span)
  | ({ k: 'for'; variable: string; seq: RNode; body: RNode } & Span)
  | ({ k: 'while'; cond: RNode; body: RNode } & Span)
  | ({ k: 'repeat'; body: RNode } & Span)
  | ({ k: 'break' | 'next' } & Span);

export interface RArg extends Span {
  name?: string;
  value?: RNode; // undefined for empty arguments, e.g. x[, 1]
}

export class RParseError extends Error {
  constructor(
    message: string,
    public offset: number,
    public line = 0,
    public col = 0,
  ) {
    super(message);
  }
}

export function lineCol(src: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}

// ------------------------------------------------------------------ tokenizer

type TokType = 'num' | 'str' | 'ident' | 'op' | 'nl' | 'eof';
interface Tok extends Span {
  type: TokType;
  value: string;
  backtick?: boolean;
}

const CONSTANTS = new Set([
  'TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'NA_integer_', 'NA_real_', 'NA_character_', 'NA_complex_',
]);
const RESERVED = new Set(['function', 'if', 'else', 'for', 'while', 'repeat', 'in', 'break', 'next']);

const OPERATORS = [
  '<<-', '->>', ':::', '|>', '::', ':=', '<-', '->', '<=', '>=', '==', '!=', '&&', '||',
  '+', '-', '*', '/', '^', '~', '?', '!', '&', '|', '<', '>', '=', '$', '@', ':',
  '(', ')', '{', '}', '[', ']', ',', ';', '\\',
];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const err = (msg: string, at: number) => {
    throw new RParseError(msg, at);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      toks.push({ type: 'nl', value: '\n', s: i, e: i + 1 });
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === ' ') {
      i++;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // raw strings: r"(...)", R"[...]", r"---{...}---"
    const raw = /^[rR](["'])(-*)([([{])/.exec(src.slice(i, i + 40));
    if (raw) {
      const [whole, quote, dashes, open] = raw;
      const close = { '(': ')', '[': ']', '{': '}' }[open as '(' | '[' | '{'] + dashes + quote;
      const end = src.indexOf(close, i + whole.length);
      if (end < 0) err('unterminated raw string', i);
      toks.push({ type: 'str', value: src.slice(i + whole.length, end), s: i, e: end + close.length });
      i = end + close.length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", '`': '`' };
          if (n === 'u' || n === 'x' || n === 'U') {
            const m = /^[uxU]\{?([0-9a-fA-F]{1,8})\}?/.exec(src.slice(j + 1, j + 12));
            if (m) {
              value += String.fromCodePoint(parseInt(m[1], 16));
              j += 1 + m[0].length;
              continue;
            }
          }
          value += map[n] ?? n;
          j += 2;
          continue;
        }
        value += src[j];
        j++;
      }
      if (j >= src.length) err('unterminated string', i);
      toks.push({ type: 'str', value, s: i, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end < 0) err('unterminated backtick name', i);
      toks.push({ type: 'ident', value: src.slice(i + 1, end), s: i, e: end + 1, backtick: true });
      i = end + 1;
      continue;
    }
    const rest = src.slice(i, i + 200);
    const num = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[Li]?/.exec(rest);
    if (num && (/\d/.test(c) || (c === '.' && /^\.\d/.test(rest)))) {
      toks.push({ type: 'num', value: num[0], s: i, e: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const ident = /^(?:[A-Za-zÀ-￿.][A-Za-z0-9À-￿._]*)/.exec(rest);
    if (ident) {
      toks.push({ type: 'ident', value: ident[0], s: i, e: i + ident[0].length });
      i += ident[0].length;
      continue;
    }
    const special = /^%[^%\n]*%/.exec(rest);
    if (special) {
      toks.push({ type: 'op', value: special[0], s: i, e: i + special[0].length });
      i += special[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => rest.startsWith(o));
    if (op) {
      toks.push({ type: 'op', value: op, s: i, e: i + op.length });
      i += op.length;
      continue;
    }
    err(`unexpected character '${c}'`, i);
  }
  toks.push({ type: 'eof', value: '', s: src.length, e: src.length });
  return toks;
}

// ------------------------------------------------------------------ parser

// Binding powers, loosely following ?Syntax (higher binds tighter).
const INFIX: Record<string, { bp: number; right?: boolean }> = {
  '?': { bp: 1 },
  '=': { bp: 2, right: true },
  '<-': { bp: 3, right: true },
  '<<-': { bp: 3, right: true },
  ':=': { bp: 3, right: true },
  '->': { bp: 4 },
  '->>': { bp: 4 },
  '~': { bp: 5 },
  '||': { bp: 6 },
  '|': { bp: 6 },
  '&&': { bp: 7 },
  '&': { bp: 7 },
  '==': { bp: 9 },
  '!=': { bp: 9 },
  '<': { bp: 9 },
  '>': { bp: 9 },
  '<=': { bp: 9 },
  '>=': { bp: 9 },
  '+': { bp: 10 },
  '-': { bp: 10 },
  '*': { bp: 11 },
  '/': { bp: 11 },
  '|>': { bp: 12 },
  ':': { bp: 13 },
  '^': { bp: 15, right: true },
};
const POSTFIX_BP = 16;
const ARG_BP = 2; // inside call arguments '=' is a separator, not an assignment

class Parser {
  private i = 0;
  private ignoreNL = 0; // > 0 inside ( ) and [ ]
  private blockDepth = 0;

  constructor(
    private src: string,
    private toks: Tok[],
  ) {}

  // -------------------------------------------------------------- token helpers
  private peek(): Tok {
    if (this.ignoreNL > 0) while (this.toks[this.i].type === 'nl') this.i++;
    return this.toks[this.i];
  }
  private next(): Tok {
    const t = this.peek();
    this.i++;
    return t;
  }
  private skipNL() {
    while (this.toks[this.i].type === 'nl') this.i++;
  }
  private isOp(t: Tok, v: string) {
    return t.type === 'op' && t.value === v;
  }
  private expectOp(v: string, context: string): Tok {
    const t = this.peek();
    if (!this.isOp(t, v)) this.fail(t, `expected '${v}' ${context}`);
    return this.next();
  }
  private fail(t: Tok, msg?: string): never {
    const what = t.type === 'eof' ? 'end of input' : t.type === 'nl' ? 'end of line' : `'${t.value}'`;
    throw new RParseError(msg ? `${msg} but found ${what}` : `unexpected ${what}`, t.s);
  }

  // -------------------------------------------------------------- program
  program(): RNode[] {
    const out: RNode[] = [];
    for (;;) {
      this.skipSeparators();
      const t = this.peek();
      if (t.type === 'eof') return out;
      out.push(this.expr(0));
      this.endOfStatement();
    }
  }

  private skipSeparators() {
    for (;;) {
      const t = this.toks[this.i];
      if (t.type === 'nl' || this.isOp(t, ';')) this.i++;
      else return;
    }
  }

  private endOfStatement() {
    const t = this.toks[this.i];
    if (t.type === 'nl' || t.type === 'eof' || this.isOp(t, ';') || this.isOp(t, '}')) return;
    this.fail(t);
  }

  // -------------------------------------------------------------- expressions
  expr(minBP: number): RNode {
    let lhs = this.prefix();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op') break;
      // postfix: calls, indexing, $ and @
      if (t.value === '(' && POSTFIX_BP > minBP) {
        lhs = this.call(lhs);
        continue;
      }
      if (t.value === '[' && POSTFIX_BP > minBP) {
        lhs = this.index(lhs);
        continue;
      }
      if ((t.value === '$' || t.value === '@') && POSTFIX_BP > minBP) {
        this.next();
        const name = this.next();
        let rhs: RNode;
        if (name.type === 'ident') rhs = { k: 'ident', name: name.value, s: name.s, e: name.e };
        else if (name.type === 'str') rhs = { k: 'str', value: name.value, s: name.s, e: name.e };
        else this.fail(name, `expected a name after '${t.value}'`);
        lhs = { k: 'binary', op: t.value, lhs, rhs, s: lhs.s, e: rhs.e };
        continue;
      }
      const info = t.value.startsWith('%') && t.value.length > 1 ? { bp: 12 } : INFIX[t.value];
      if (!info || info.bp <= minBP) break;
      this.next();
      this.skipNL();
      const rhs = this.expr(info.right ? info.bp - 1 : info.bp);
      lhs = { k: 'binary', op: t.value, lhs, rhs, s: lhs.s, e: rhs.e };
    }
    return lhs;
  }

  private prefix(): RNode {
    const t = this.next();
    switch (t.type) {
      case 'num': {
        const clean = t.value.replace(/[Li]$/, '');
        return { k: 'num', value: Number(clean), raw: t.value, s: t.s, e: t.e };
      }
      case 'str':
        return { k: 'str', value: t.value, s: t.s, e: t.e };
      case 'ident':
        return this.identifier(t);
      case 'op':
        break;
      default:
        this.fail(t);
    }
    switch (t.value) {
      case '-':
      case '+': {
        const arg = this.expr(14);
        return { k: 'unary', op: t.value, arg, s: t.s, e: arg.e };
      }
      case '!': {
        const arg = this.expr(8);
        return { k: 'unary', op: '!', arg, s: t.s, e: arg.e };
      }
      case '~':
      case '?': {
        const arg = this.expr(t.value === '~' ? 5 : 1);
        return { k: 'unary', op: t.value, arg, s: t.s, e: arg.e };
      }
      case '(': {
        this.ignoreNL++;
        const expr = this.expr(0);
        const close = this.expectOp(')', 'to close (');
        this.ignoreNL--;
        return { k: 'paren', expr, s: t.s, e: close.e };
      }
      case '{':
        return this.block(t);
      case '\\':
        return this.functionDef(t);
    }
    this.fail(t);
  }

  private identifier(t: Tok): RNode {
    if (!t.backtick) {
      if (CONSTANTS.has(t.value)) return { k: 'const', name: t.value, s: t.s, e: t.e };
      if (t.value === 'function') return this.functionDef(t);
      if (t.value === 'if') return this.ifExpr(t);
      if (t.value === 'for') return this.forExpr(t);
      if (t.value === 'while') {
        this.expectOp('(', "after 'while'");
        this.ignoreNL++;
        const cond = this.expr(0);
        this.expectOp(')', "after the 'while' condition");
        this.ignoreNL--;
        this.skipNL();
        const body = this.expr(0);
        return { k: 'while', cond, body, s: t.s, e: body.e };
      }
      if (t.value === 'repeat') {
        this.skipNL();
        const body = this.expr(0);
        return { k: 'repeat', body, s: t.s, e: body.e };
      }
      if (t.value === 'break' || t.value === 'next') return { k: t.value, s: t.s, e: t.e };
      if (RESERVED.has(t.value)) this.fail(t);
    }
    // pkg::name / pkg:::name
    const after = this.toks[this.i];
    if (after.type === 'op' && (after.value === '::' || after.value === ':::')) {
      this.i++;
      const name = this.next();
      if (name.type !== 'ident' && name.type !== 'str') this.fail(name, `expected a name after '${after.value}'`);
      return { k: 'ident', name: `${t.value}${after.value}${name.value}`, s: t.s, e: name.e };
    }
    return { k: 'ident', name: t.value, s: t.s, e: t.e };
  }

  private block(open: Tok): RNode {
    const saved = this.ignoreNL;
    this.ignoreNL = 0;
    this.blockDepth++;
    const body: RNode[] = [];
    for (;;) {
      this.skipSeparators();
      const t = this.peek();
      if (this.isOp(t, '}')) {
        this.next();
        this.ignoreNL = saved;
        this.blockDepth--;
        return { k: 'block', body, s: open.s, e: t.e };
      }
      if (t.type === 'eof') throw new RParseError("missing '}' for the '{' opened here", open.s);
      body.push(this.expr(0));
      this.endOfStatement();
    }
  }

  private argList(close: string, what: string): { args: RArg[]; end: number } {
    this.ignoreNL++;
    const args: RArg[] = [];
    if (this.isOp(this.peek(), close)) {
      const t = this.next();
      this.ignoreNL--;
      return { args, end: t.e };
    }
    for (;;) {
      const t = this.peek();
      if (t.type === 'eof') throw new RParseError(`missing '${close}' to close ${what}`, t.s);
      // empty argument, e.g. x[, 1] or x[1, ]
      args.push(this.isOp(t, ',') || this.isOp(t, close) ? { s: t.s, e: t.s } : this.arg());
      const sep = this.peek();
      if (this.isOp(sep, ',')) {
        this.next();
        continue;
      }
      if (this.isOp(sep, close)) {
        this.next();
        this.ignoreNL--;
        return { args, end: sep.e };
      }
      if (sep.type === 'eof') throw new RParseError(`missing '${close}' to close ${what}`, sep.s);
      this.fail(sep, `expected ',' or '${close}' in ${what}`);
    }
  }

  private arg(): RArg {
    const t = this.peek();
    const nxt = this.lookahead();
    if ((t.type === 'ident' || t.type === 'str') && this.isOp(nxt, '=')) {
      this.next();
      this.next(); // '='
      const v = this.peek();
      if (this.isOp(v, ',') || this.isOp(v, ')') || this.isOp(v, ']')) return { name: t.value, s: t.s, e: nxt.e };
      const value = this.expr(ARG_BP);
      return { name: t.value, value, s: t.s, e: value.e };
    }
    const value = this.expr(ARG_BP);
    return { value, s: value.s, e: value.e };
  }

  /** The token after the current one, skipping newlines. */
  private lookahead(): Tok {
    let j = this.i + 1;
    while (j < this.toks.length - 1 && this.toks[j].type === 'nl') j++;
    return this.toks[j];
  }

  private call(fn: RNode): RNode {
    this.next(); // (
    const { args, end } = this.argList(')', `the call to ${this.src.slice(fn.s, fn.e)}()`);
    return { k: 'call', fn, args, s: fn.s, e: end };
  }

  private index(obj: RNode): RNode {
    const open = this.next(); // [
    const double = this.isOp(this.toks[this.i], '[') && this.toks[this.i].s === open.e;
    if (double) this.i++;
    const { args, end } = this.argList(']', double ? '[[' : '[');
    let e = end;
    if (double) {
      const second = this.toks[this.i];
      if (!this.isOp(second, ']')) this.fail(second, "expected ']]'");
      this.i++;
      e = second.e;
    }
    return { k: 'index', obj, args, double, s: obj.s, e };
  }

  private functionDef(t: Tok): RNode {
    this.expectOp('(', 'after function');
    const { args } = this.argList(')', 'the function arguments');
    this.skipNL();
    const body = this.expr(0);
    return { k: 'function', params: args, body, s: t.s, e: body.e };
  }

  private ifExpr(t: Tok): RNode {
    this.expectOp('(', "after 'if'");
    this.ignoreNL++;
    const cond = this.expr(0);
    this.expectOp(')', "after the 'if' condition");
    this.ignoreNL--;
    this.skipNL();
    const then = this.expr(0);
    // `else` may follow on a new line only inside { } or ( )
    const save = this.i;
    if (this.blockDepth > 0 || this.ignoreNL > 0) this.skipNL();
    const maybeElse = this.toks[this.i];
    if (maybeElse.type === 'ident' && maybeElse.value === 'else' && !maybeElse.backtick) {
      this.i++;
      this.skipNL();
      const other = this.expr(0);
      return { k: 'if', cond, then, else: other, s: t.s, e: other.e };
    }
    this.i = save;
    return { k: 'if', cond, then, s: t.s, e: then.e };
  }

  private forExpr(t: Tok): RNode {
    this.expectOp('(', "after 'for'");
    this.ignoreNL++;
    const v = this.next();
    if (v.type !== 'ident') this.fail(v, 'expected a loop variable');
    const kw = this.next();
    if (kw.type !== 'ident' || kw.value !== 'in') this.fail(kw, "expected 'in'");
    const seq = this.expr(0);
    this.expectOp(')', "after the 'for' sequence");
    this.ignoreNL--;
    this.skipNL();
    const body = this.expr(0);
    return { k: 'for', variable: v.value, seq, body, s: t.s, e: body.e };
  }
}

/** Parse R source into top-level expressions. Throws RParseError (with line/col). */
export function parseR(src: string): RNode[] {
  try {
    return new Parser(src, tokenize(src)).program();
  } catch (e) {
    if (e instanceof RParseError) {
      const { line, col } = lineCol(src, e.offset);
      throw new RParseError(e.message, e.offset, line, col);
    }
    throw e;
  }
}

/** Parse a single expression (used to validate raw argument text). */
export function parseRExpression(src: string): RNode {
  const nodes = parseR(src);
  if (nodes.length !== 1) throw new RParseError('expected a single expression', 0, 1, 1);
  return nodes[0];
}

// ------------------------------------------------------------------ helpers for consumers

export function fnName(node: RNode): string | null {
  if (node.k !== 'call') return null;
  if (node.fn.k === 'ident') return node.fn.name.replace(/^(shiny|bslib):::?/, '');
  if (node.fn.k === 'str') return node.fn.value;
  return null;
}

export function text(src: string, span: Span): string {
  return src.slice(span.s, span.e);
}

/** Remove common indentation and surrounding blank lines. */
export function dedent(code: string): string {
  const lines = code.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(Math.min(min, /^ */.exec(l)![0].length)).trimEnd()).join('\n');
}
