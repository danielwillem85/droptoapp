/**
 * app.R  ->  design.
 *
 * Parses a Shiny app and rebuilds the UINode tree the designer works with.
 * Anything without a visual equivalent is preserved rather than dropped:
 *
 *  - unknown UI calls become "R code" components (kept verbatim),
 *  - argument values that aren't literals are kept as R expressions (node.raw),
 *  - arguments without a field are kept as "other arguments" (node.extra),
 *  - top-level code other than ui/server goes to the page's "setup code",
 *  - server code that isn't a render*()/observeEvent() for a component on the
 *    canvas goes to the page's "other server code".
 */
import { BY_R_FN, COMPONENTS, PAGE_LAYOUTS, THEMES, canAccept } from './components';
import type { ArgSpec, ComponentDef } from './components';
import { HEADER_COMMENT, INPUTS_COMMENT_PREFIX } from './codegen';
import { parseWidths } from './rcode';
import { dedent, fnName, parseR, RParseError, lineCol, text } from './rparse';
import type { RArg, RNode, Span } from './rparse';
import { newNodeId, walk } from './tree';
import type { ComponentType, Project, Props, PropValue, UINode } from './types';

export class ImportError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(message);
  }
}

const PAGE_FORMALS: Record<string, string[]> = {
  page_sidebar: ['...', 'sidebar', 'title', 'fillable', 'fillable_mobile', 'theme', 'window_title', 'lang'],
  page_fillable: ['...', 'padding', 'gap', 'fillable_mobile', 'title', 'theme', 'lang'],
  page_fluid: ['...', 'title', 'theme', 'lang'],
};

export function importApp(src: string): Project {
  let stmts: RNode[];
  try {
    stmts = parseR(src);
  } catch (e) {
    if (e instanceof RParseError) throw new ImportError(e.message, e.line, e.col);
    throw e;
  }
  const ctx = new Importer(src);
  let uiExpr: RNode | null = null;
  let serverExpr: RNode | null = null;
  const handled: Span[] = [];

  for (const st of stmts) {
    const target = assignmentTarget(st);
    if (target === 'ui' && st.k === 'binary') {
      uiExpr = st.rhs;
      handled.push(st);
    } else if (target === 'server' && st.k === 'binary') {
      serverExpr = st.rhs;
      handled.push(st);
    } else if (st.k === 'call' && ['library', 'require'].includes(fnName(st) ?? '') && isLib(st, ['shiny', 'bslib'])) {
      handled.push(st);
    } else if (st.k === 'call' && (fnName(st) === 'shinyApp' || fnName(st) === 'shinyApp')) {
      handled.push(st);
    }
  }
  if (!uiExpr) throw new ImportError('app.R needs a `ui <- page_sidebar(...)` assignment (or page_fillable / page_fluid).', 1, 1);
  if (!serverExpr) throw new ImportError('app.R needs a `server <- function(input, output, session) { ... }` assignment.', 1, 1);

  const root = ctx.page(uiExpr);
  root.props.setup = cleanRemainder(cut(src, 0, src.length, handled), [HEADER_COMMENT]);
  root.props.serverCode = ctx.server(serverExpr, root);
  return { format: 'truth-editor/v1', root };
}

function assignmentTarget(st: RNode): string | null {
  if (st.k === 'binary' && (st.op === '<-' || st.op === '=' || st.op === '<<-') && st.lhs.k === 'ident') return st.lhs.name;
  return null;
}

function isLib(call: RNode, names: string[]): boolean {
  if (call.k !== 'call' || call.args.length !== 1) return false;
  const v = call.args[0].value;
  return !!v && ((v.k === 'ident' && names.includes(v.name)) || (v.k === 'str' && names.includes(v.value)));
}

/** src[start, end) with the given spans removed. */
function cut(src: string, start: number, end: number, spans: Span[]): string {
  const sorted = [...spans].sort((a, b) => a.s - b.s);
  let out = '';
  let pos = start;
  for (const sp of sorted) {
    if (sp.e <= pos || sp.s >= end) continue;
    out += src.slice(pos, Math.max(pos, sp.s));
    pos = Math.max(pos, sp.e);
  }
  return out + src.slice(pos, end);
}

/** Tidy leftover code: drop generated comments, trailing spaces, extra blank lines and indentation. */
function cleanRemainder(code: string, dropLinesStartingWith: string[]): string {
  const lines = code
    .split('\n')
    .map((l) => l.replace(/[ \t;]+$/, ''))
    .filter((l) => !dropLinesStartingWith.some((p) => l.trim().startsWith(p)));
  return dedent(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

// ------------------------------------------------------------------ argument matching

interface Matched {
  byFormal: Map<string, RArg>;
  /** Arguments that go to `...` (positional ones and named ones that match no formal). */
  dots: RArg[];
}

/** R-style argument matching: exact names first, then positional into the formals before `...`. */
function matchArgs(args: RArg[], formals: string[]): Matched {
  const byFormal = new Map<string, RArg>();
  const dots: RArg[] = [];
  const positional: RArg[] = [];
  const hasDots = formals.includes('...');
  for (const a of args) {
    if (!a.name && !a.value) continue; // empty argument
    if (a.name && formals.includes(a.name) && a.name !== '...' && !byFormal.has(a.name)) byFormal.set(a.name, a);
    else if (a.name) dots.push(a); // named but unknown: in R this goes to ... (or is an error without it)
    else positional.push(a);
  }
  const dotsIndex = hasDots ? formals.indexOf('...') : formals.length;
  const open = formals.slice(0, dotsIndex).filter((f) => !byFormal.has(f));
  for (const a of positional) {
    const f = open.shift();
    if (f) byFormal.set(f, a);
    else dots.push(a);
  }
  // keep source order for dots
  dots.sort((a, b) => a.s - b.s);
  return { byFormal, dots };
}

function absentValue(spec: ArgSpec): PropValue {
  if (spec.absent !== undefined) return spec.absent;
  return spec.kind === 'bool' ? false : spec.kind === 'strings' ? [] : '';
}

/** Try to read an argument value as a literal of the expected kind. */
function literal(kind: ArgSpec['kind'], v: RNode): PropValue | undefined {
  const num = (n: RNode): number | undefined =>
    n.k === 'num' && !n.raw.endsWith('i') ? n.value : n.k === 'unary' && n.op === '-' && n.arg.k === 'num' ? -n.arg.value : undefined;
  switch (kind) {
    case 'string':
      if (v.k === 'str') return v.value;
      if (v.k === 'const' && v.name === 'NULL') return '';
      return undefined;
    case 'number':
      return num(v);
    case 'bool':
      return v.k === 'const' && (v.name === 'TRUE' || v.name === 'FALSE') ? v.name === 'TRUE' : undefined;
    case 'strings': {
      if (v.k === 'str') return [v.value];
      if (v.k === 'call' && fnName(v) === 'c' && v.args.every((a) => !a.name && a.value?.k === 'str'))
        return v.args.map((a) => (a.value as { value: string }).value);
      return undefined;
    }
    case 'widths': {
      const items = v.k === 'call' && fnName(v) === 'c' ? v.args.map((a) => (a.name || !a.value ? undefined : num(a.value))) : [num(v)];
      if (items.some((x) => x === undefined)) return undefined;
      const s = items.join(', ');
      return parseWidths(s).length === items.length ? s : undefined;
    }
  }
}

// ------------------------------------------------------------------ importer

class Importer {
  constructor(private src: string) {}

  private t(span: Span) {
    return text(this.src, span);
  }

  private fail(msg: string, at: Span): never {
    const { line, col } = lineCol(this.src, at.s);
    throw new ImportError(msg, line, col);
  }

  private node(type: ComponentType, props: Props, children: UINode[] = []): UINode {
    return { id: newNodeId(), type, props, children };
  }

  private rcode(expr: RNode): UINode {
    return this.node('rcode', { code: dedentExpr(this.src, expr) });
  }

  page(expr: RNode): UINode {
    const layout = fnName(expr);
    if (expr.k !== 'call' || !layout || !(PAGE_LAYOUTS as readonly string[]).includes(layout))
      this.fail('The ui must be built with page_sidebar(), page_fillable() or page_fluid().', expr);
    const { byFormal, dots } = matchArgs(expr.args, PAGE_FORMALS[layout]);
    const props: Props = { title: '', layout, theme: 'default', setup: '', serverCode: '' };
    const raw: Record<string, string> = {};
    const extras: string[] = [];

    const title = byFormal.get('title');
    if (title?.value) {
      const lit = literal('string', title.value);
      if (lit !== undefined) props.title = lit;
      else raw.title = this.t(title.value);
    }

    const theme = byFormal.get('theme');
    if (theme?.value) {
      const v = theme.value;
      const onlyBootswatch =
        v.k === 'call' &&
        fnName(v) === 'bs_theme' &&
        (v.args.length === 0 ||
          (v.args.length === 1 &&
            v.args[0].name === 'bootswatch' &&
            v.args[0].value?.k === 'str' &&
            (THEMES as readonly string[]).includes(v.args[0].value.value)));
      if (onlyBootswatch) props.theme = v.args.length ? (v.args[0].value as { value: string }).value : 'default';
      else raw.theme = this.t(v);
    }

    let sidebar = this.node('sidebar', { title: '', width: 250, position: 'left' });
    const sb = byFormal.get('sidebar');
    if (sb?.value) {
      if (sb.value.k === 'call' && fnName(sb.value) === 'sidebar') sidebar = this.generic(COMPONENTS.sidebar, sb.value);
      else raw.sidebar = this.t(sb.value);
    }

    for (const [formal, arg] of byFormal) {
      if (!['title', 'theme', 'sidebar'].includes(formal) && arg.value) extras.push(`${formal} = ${this.t(arg.value)}`);
    }
    const main = this.node('main', {});
    for (const a of dots) {
      if (a.name) extras.push(this.t(a));
      else if (a.value) main.children.push(this.child(a.value, 'main'));
    }
    const root = this.node('page', props, [sidebar, main]);
    if (Object.keys(raw).length) root.raw = raw;
    if (extras.length) root.extra = extras.join(',\n');
    return root;
  }

  /** A UI expression inside a container. */
  child(expr: RNode, parent: ComponentType): UINode {
    const node = this.childUnchecked(expr);
    return canAccept(parent, node.type) ? node : this.rcode(expr);
  }

  private childUnchecked(expr: RNode): UINode {
    if (expr.k !== 'call') return this.rcode(expr);
    const name = fnName(expr) ?? '';
    const onlyString = expr.args.length === 1 && !expr.args[0].name && expr.args[0].value?.k === 'str';
    if (/^h[1-6]$/.test(name)) {
      return onlyString ? this.node('heading', { text: (expr.args[0].value as { value: string }).value, level: name }) : this.rcode(expr);
    }
    if (name === 'p') return onlyString ? this.node('paragraph', { text: (expr.args[0].value as { value: string }).value }) : this.rcode(expr);
    if (name === 'hr') return expr.args.length === 0 ? this.node('divider', {}) : this.rcode(expr);
    const def = BY_R_FN[name];
    return def ? this.generic(def, expr) : this.rcode(expr);
  }

  /** A component described by arg specs (see components.ts). */
  generic(def: ComponentDef, call: RNode & { k: 'call' }): UINode {
    const { byFormal, dots } = matchArgs(call.args, def.formals ?? ['...']);
    const props: Props = {};
    const raw: Record<string, string> = {};
    const extras: string[] = [];
    const used = new Set<RArg>();

    for (const spec of def.args ?? []) {
      // Arguments like actionButton(class = ...) live in `...`, so also look there by name.
      let arg = byFormal.get(spec.arg);
      if (!arg) {
        arg = dots.find((d) => d.name === spec.arg && !used.has(d));
      }
      if (!arg?.value) {
        props[spec.prop] = absentValue(spec);
        continue;
      }
      used.add(arg);
      const lit = literal(spec.kind, arg.value);
      if (lit !== undefined) props[spec.prop] = lit;
      else {
        raw[spec.prop] = dedentExpr(this.src, arg.value);
        props[spec.prop] = absentValue(spec);
      }
    }
    const specArgs = new Set((def.args ?? []).map((a) => a.arg));
    for (const [formal, arg] of byFormal) {
      if (!specArgs.has(formal) && arg.value) extras.push(`${formal} = ${this.t(arg.value)}`);
    }

    const children: UINode[] = [];
    for (const a of dots) {
      if (used.has(a)) continue;
      if (a.name || !a.value || !def.accepts) {
        extras.push(this.t(a));
        continue;
      }
      // card(card_header("Title"), ...) -> header property
      if (
        def.type === 'card' &&
        props.header === undefined &&
        a.value.k === 'call' &&
        fnName(a.value) === 'card_header' &&
        a.value.args.length === 1 &&
        !a.value.args[0].name &&
        a.value.args[0].value?.k === 'str'
      ) {
        props.header = a.value.args[0].value.value;
        continue;
      }
      children.push(this.child(a.value, def.type));
    }

    // Fields without an R argument (server code, card header) start empty.
    for (const f of def.fields) if (props[f.key] === undefined) props[f.key] = f.kind === 'boolean' ? false : '';
    const node = this.node(def.type, props, children);
    if (Object.keys(raw).length) node.raw = raw;
    if (extras.length) node.extra = extras.join(',\n');
    return node;
  }

  /** Match server code to components; return the code that is left over. */
  server(expr: RNode, root: UINode): string {
    if (expr.k !== 'function') this.fail('server must be a function(input, output, session) { ... }.', expr);
    const body = expr.body;
    const stmts = body.k === 'block' ? body.body : [body];
    const outputs = new Map<string, UINode>();
    const buttons = new Map<string, UINode>();
    walk(root, (n) => {
      const def = COMPONENTS[n.type];
      if (def.renderFn && typeof n.props.id === 'string' && !outputs.has(n.props.id)) outputs.set(n.props.id, n);
      if (n.type === 'actionButton' && typeof n.props.id === 'string' && !buttons.has(n.props.id)) buttons.set(n.props.id, n);
    });

    const claimed: Span[] = [];
    for (const st of stmts) {
      // output$id <- renderX({ ... })
      if (st.k === 'binary' && (st.op === '<-' || st.op === '=') && st.lhs.k === 'binary' && st.lhs.op === '$') {
        const { lhs } = st.lhs;
        const id = st.lhs.rhs.k === 'ident' ? st.lhs.rhs.name : st.lhs.rhs.k === 'str' ? st.lhs.rhs.value : null;
        const node = id ? outputs.get(id) : undefined;
        const rhs = st.rhs;
        if (lhs.k === 'ident' && lhs.name === 'output' && node && rhs.k === 'call' && fnName(rhs) === COMPONENTS[node.type].renderFn) {
          const only = rhs.args.length === 1 && !rhs.args[0].name ? rhs.args[0].value : undefined;
          if (only) {
            node.props.code = this.bodyText(only);
            outputs.delete(id!);
            claimed.push(st);
          }
        }
        continue;
      }
      // observeEvent(input$id, { ... })
      if (st.k === 'call' && fnName(st) === 'observeEvent' && st.args.length === 2 && st.args.every((a) => !a.name && a.value)) {
        const ev = st.args[0].value!;
        if (ev.k === 'binary' && ev.op === '$' && ev.lhs.k === 'ident' && ev.lhs.name === 'input' && ev.rhs.k === 'ident') {
          const node = buttons.get(ev.rhs.name);
          if (node) {
            node.props.code = this.bodyText(st.args[1].value!);
            buttons.delete(ev.rhs.name);
            claimed.push(st);
          }
        }
      }
    }
    if (body.k !== 'block') return claimed.length ? '' : this.t(body);
    return cleanRemainder(cut(this.src, body.s + 1, body.e - 1, claimed), [INPUTS_COMMENT_PREFIX]);
  }

  private bodyText(expr: RNode): string {
    if (expr.k === 'block') return dedent(this.src.slice(expr.s + 1, expr.e - 1));
    return dedentExpr(this.src, expr);
  }
}

/** Source text of an expression, with continuation lines dedented relative to the first. */
function dedentExpr(src: string, expr: RNode): string {
  const lineStart = src.lastIndexOf('\n', expr.s - 1) + 1;
  const firstIndent = src.slice(lineStart, expr.s).match(/^\s*/)![0].length;
  const lines = src.slice(expr.s, expr.e).split('\n');
  return lines
    .map((l, i) => (i === 0 ? l : l.slice(Math.min(firstIndent, l.match(/^\s*/)![0].length))))
    .join('\n');
}
