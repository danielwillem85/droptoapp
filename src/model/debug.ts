/**
 * Debugging with browser().
 *
 * In R (RStudio, the console), browser() pauses the app and opens an interactive prompt. In the
 * browser (Run, via shinylive/webR) R cannot pause your app and wait for typed commands, so for
 * Run every browser() call is rewritten to call a small debugger that comes with the code:
 * when the line is reached, the running app shows a dialog with the local variables and the
 * inputs at that moment, and an R prompt that evaluates code in that environment.
 *
 * Only the code sent to Run changes. app.R itself (export, download, the code view) keeps the
 * real browser(), so it works as usual in RStudio.
 */
import { rStr } from './rcode';
import { lineCol, parseR } from './rparse';
import type { RNode, Span } from './rparse';

export interface BrowserCall extends Span {
  /** 1-based line of the call. */
  line: number;
  /** The text between the parentheses (the call's arguments), as written. */
  args: string;
  /** Whether the call has any arguments (comments and spaces don't count). */
  hasArgs: boolean;
}

function parseOrNull(code: string): RNode[] | null {
  try {
    return parseR(code);
  } catch {
    return null;
  }
}

/** Call `visit` on every node of the tree, parents first. */
function walkR(n: RNode, visit: (n: RNode) => void) {
  visit(n);
  const kids: (RNode | undefined)[] = [];
  switch (n.k) {
    case 'call':
      kids.push(n.fn, ...n.args.map((a) => a.value));
      break;
    case 'index':
      kids.push(n.obj, ...n.args.map((a) => a.value));
      break;
    case 'binary':
      kids.push(n.lhs, n.rhs);
      break;
    case 'unary':
      kids.push(n.arg);
      break;
    case 'paren':
      kids.push(n.expr);
      break;
    case 'block':
      kids.push(...n.body);
      break;
    case 'function':
      kids.push(...n.params.map((a) => a.value), n.body);
      break;
    case 'if':
      kids.push(n.cond, n.then, n.else);
      break;
    case 'for':
      kids.push(n.seq, n.body);
      break;
    case 'while':
      kids.push(n.cond, n.body);
      break;
    case 'repeat':
      kids.push(n.body);
      break;
  }
  for (const k of kids) if (k) walkR(k, visit);
}

const isBrowserCall = (n: RNode): n is RNode & { k: 'call' } =>
  n.k === 'call' && n.fn.k === 'ident' && (n.fn.name === 'browser' || n.fn.name === 'base::browser');

/** The browser() calls in some R code, in source order. None when the code does not parse. */
export function findBrowserCalls(code: string): BrowserCall[] {
  const stmts = parseOrNull(code);
  if (!stmts) return [];
  const calls: BrowserCall[] = [];
  for (const st of stmts)
    walkR(st, (n) => {
      if (!isBrowserCall(n) || n.k !== 'call') return;
      const open = code.indexOf('(', n.fn.e);
      const hasArgs = n.args.some((a) => a.name || a.value);
      calls.push({ s: n.s, e: n.e, line: lineCol(code, n.s).line, args: code.slice(open + 1, n.e - 1), hasArgs });
    });
  return calls.sort((a, b) => a.s - b.s);
}

/** Lines with a browser() call (for the gutter of the code view). */
export function browserLines(code: string): number[] {
  return [...new Set(findBrowserCalls(code).map((c) => c.line))];
}

/** A few lines of code around `line`, with the line itself marked, for the debugger dialog. */
function excerpt(code: string, line: number): string {
  const lines = code.split('\n');
  const from = Math.max(1, line - 2);
  const to = Math.min(lines.length, line + 2);
  const width = String(to).length;
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${i === line ? '→' : ' '} ${String(i).padStart(width)} | ${lines[i - 1]}`);
  return out.join('\n');
}

/**
 * The code to send to Run: every browser() call goes to the debugger, which is defined at the
 * top, and the server function sets it up when a session starts. Returns the code unchanged
 * when there are no browser() calls (or it does not parse).
 */
export function instrumentForRun(code: string): { code: string; lines: number[] } {
  const calls = findBrowserCalls(code);
  if (!calls.length) return { code, lines: [] };
  const edits: { s: number; e: number; text: string }[] = calls.map((c) => {
    const extra = `.line = ${c.line}L, .source = ${rStr(excerpt(code, c.line))}`;
    // Keep the user's arguments as written. A comment among them would swallow the rest of its
    // line, so then the added arguments start on a new line.
    const args = !c.hasArgs ? '' : /#/.test(c.args) ? `${c.args}\n, ` : `${c.args.trim()}, `;
    return { s: c.s, e: c.e, text: `.dta_browser(${args}${extra})` };
  });
  // Set the debugger up when a session starts: first thing in server <- function(...) { ... }.
  const server = serverBody(code);
  if (server) edits.push({ s: server.s + 1, e: server.s + 1, text: '\n  .dta_debug_init()' });
  let out = code;
  for (const ed of edits.sort((a, b) => b.s - a.s)) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
  return { code: `${DEBUGGER_R}\n${out}`, lines: [...new Set(calls.map((c) => c.line))] };
}

/** The `{ ... }` body of `server <- function(...) { ... }`, if written that way. */
function serverBody(code: string): Span | null {
  for (const st of parseOrNull(code) ?? []) {
    if (
      st.k === 'binary' &&
      (st.op === '<-' || st.op === '=') &&
      st.lhs.k === 'ident' &&
      st.lhs.name === 'server' &&
      st.rhs.k === 'function' &&
      st.rhs.body.k === 'block'
    )
      return st.rhs.body;
  }
  return null;
}

/**
 * Toggle a breakpoint before `line` (1-based), like clicking the margin in RStudio: removes the
 * line when it is a browser() call on its own, otherwise inserts browser() above it with the same
 * indentation. Only where it makes sense: inside a function (such as server or a render block)
 * and where the code still parses. Returns the new code, or null when it can't go there.
 */
export function toggleBreakpoint(code: string, line: number): string | null {
  const lines = code.split('\n');
  if (line < 1 || line > lines.length) return null;
  const text = lines[line - 1];
  if (/^\s*(base::)?browser\(\s*\)\s*$/.test(text)) {
    const next = [...lines.slice(0, line - 1), ...lines.slice(line)].join('\n');
    return parseOrNull(next) ? next : null;
  }
  if (!text.trim() || /^\s*#/.test(text)) return null;
  const indent = /^\s*/.exec(text)![0];
  const next = [...lines.slice(0, line - 1), `${indent}browser()`, ...lines.slice(line - 1)].join('\n');
  const stmts = parseOrNull(next);
  if (!stmts) return null;
  // The new call must be a statement inside a function body, where it can stop the app.
  const at = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + indent.length;
  let inFunction = false;
  for (const st of stmts)
    walkR(st, (n) => {
      if (n.k === 'function' && n.body.s < at && at < n.body.e) inFunction = true;
    });
  const added = findBrowserCalls(next).some((c) => c.s === at);
  return inFunction && added ? next : null;
}

/**
 * The debugger, in R. Added to the top of the code for Run only. It uses only shiny
 * (namespaced), so it works whatever the app loads. Names start with .dta_ to stay out of the way.
 */
export const DEBUGGER_R = String.raw`# ---- Added by DropToApp for Run: browser() opens this debugger in the running app ----
.dta_debug_init <- function(session = shiny::getDefaultReactiveDomain()) {
  if (is.null(session) || !is.null(session$userData$dta_debug)) return(invisible(NULL))
  state <- new.env()
  state$off <- FALSE
  state$hits <- 0L
  state$values <- list()
  state$frame <- globalenv()
  state$result <- shiny::reactiveVal("")
  session$userData$dta_debug <- state
  input <- session$input
  output <- session$output
  output$dta_debug_result <- shiny::renderText(state$result())
  shiny::observeEvent(input$dta_debug_run, {
    code <- input$dta_debug_expr
    if (!is.null(code) && nzchar(trimws(code))) {
      env <- list2env(state$values, parent = state$frame)
      out <- tryCatch(
        utils::capture.output({
          res <- withVisible(eval(parse(text = code), envir = env))
          if (res$visible) print(res$value)
        }),
        error = function(e) paste("Error:", conditionMessage(e))
      )
      state$result(paste(c(paste(">", code), out), collapse = "\n"))
    }
  }, domain = session)
  shiny::observeEvent(input$dta_debug_off, {
    state$off <- TRUE
    shiny::removeModal(session)
  }, domain = session)
  invisible(NULL)
}
.dta_show <- function(x) {
  if (inherits(x, "dta_error")) return(paste0("<could not read: ", unclass(x), ">"))
  out <- tryCatch(
    utils::capture.output(utils::str(x, max.level = 1, vec.len = 4, list.len = 15, give.attr = FALSE)),
    error = function(e) conditionMessage(e)
  )
  if (length(out) > 20) out <- c(out[1:20], "...")
  paste(out, collapse = "\n")
}
.dta_values <- function(frame) {
  vals <- list()
  for (n in ls(frame)) {
    vals[n] <- list(tryCatch(get(n, envir = frame), error = function(e) structure(conditionMessage(e), class = "dta_error")))
  }
  vals
}
.dta_debug_dialog <- function(state, where, text, source, session) {
  vals <- state$values
  rows <- lapply(names(vals), function(n) {
    shiny::tags$tr(
      shiny::tags$td(shiny::tags$code(n)),
      shiny::tags$td(class(vals[[n]])[1]),
      shiny::tags$td(shiny::tags$pre(style = "margin: 0; max-height: 9em; overflow: auto;", .dta_show(vals[[n]])))
    )
  })
  inputs <- shiny::isolate(shiny::reactiveValuesToList(session$input))
  if (length(inputs)) inputs <- inputs[!startsWith(names(inputs), "dta_debug_")]
  variables <- if (length(rows)) {
    shiny::tags$table(
      class = "table table-sm",
      shiny::tags$thead(shiny::tags$tr(shiny::tags$th("Name"), shiny::tags$th("Class"), shiny::tags$th("Value"))),
      shiny::tags$tbody(rows)
    )
  } else {
    shiny::tags$p(class = "text-muted", "No local variables here.")
  }
  times <- if (state$hits > 1) paste0(" (reached ", state$hits, " times)") else ""
  shiny::modalDialog(
    title = paste0("Debugger: ", where, times),
    size = "l",
    easyClose = TRUE,
    if (is.character(text) && length(text) == 1 && nzchar(text)) shiny::tags$p(shiny::tags$strong(text)),
    if (nzchar(source)) shiny::tags$pre(source),
    shiny::tags$p(class = "text-muted small", "In the browser the app keeps running, so this shows the values at the moment this line was reached. Evaluate R below to look further, as at the Browse[1]> prompt."),
    shiny::tags$h6("Local variables"),
    variables,
    shiny::tags$h6("Inputs"),
    shiny::tags$pre(style = "max-height: 10em; overflow: auto;", .dta_show(inputs)),
    shiny::textAreaInput("dta_debug_expr", "Evaluate R", rows = 2, width = "100%", placeholder = "e.g. summary(x)"),
    shiny::actionButton("dta_debug_run", "Evaluate", class = "btn-primary btn-sm"),
    shiny::verbatimTextOutput("dta_debug_result"),
    footer = shiny::tagList(
      shiny::actionButton("dta_debug_off", "Don't stop again"),
      shiny::modalButton("Continue")
    )
  )
}
.dta_browser <- function(text = "", condition = NULL, expr = TRUE, skipCalls = 0L, .line = NA_integer_, .source = "") {
  if (!isTRUE(expr)) return(invisible(NULL))
  frame <- parent.frame()
  session <- shiny::getDefaultReactiveDomain()
  where <- if (is.na(.line)) "browser()" else paste0("browser() on line ", .line)
  if (is.null(session)) {
    message(where, ": the debugger only works in code that runs inside the server function.")
    return(invisible(NULL))
  }
  .dta_debug_init(session)
  state <- session$userData$dta_debug
  if (isTRUE(state$off)) return(invisible(NULL))
  state$hits <- state$hits + 1L
  state$frame <- frame
  state$values <- .dta_values(frame)
  state$result("")
  shiny::showModal(.dta_debug_dialog(state, where, text, .source, session), session = session)
  invisible(NULL)
}
# ---- End of the DropToApp debugger; your app.R follows ----
`;
