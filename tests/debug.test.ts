import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApp } from '../src/model/codegen';
import { DEBUGGER_R, browserLines, findBrowserCalls, instrumentForRun, toggleBreakpoint } from '../src/model/debug';
import { importApp } from '../src/model/fromR';
import { parseR } from '../src/model/rparse';
import { starterProject } from '../src/model/templates';
import { walk } from '../src/model/tree';
import { validate } from '../src/model/validate';

const faithful = () => generateApp(starterProject().root).app;
const lineOf = (code: string, text: string) => code.split('\n').findIndex((l) => l.includes(text)) + 1;

test('browser() calls are found by parsing, not by searching text', () => {
  const code = `# call browser() when debugging
f <- function(x) {
  msg <- "browser() in a string"
  browser()
  if (x > 1) base::browser(text = "big x", expr = x > 10)
  x
}
browserify <- function() NULL
browserify()`;
  const calls = findBrowserCalls(code);
  assert.deepEqual(calls.map((c) => c.line), [4, 5]);
  assert.equal(calls[1].args, 'text = "big x", expr = x > 10');
  assert.deepEqual(calls.map((c) => c.hasArgs), [false, true]);
  assert.deepEqual(browserLines(code), [4, 5]);
  assert.deepEqual(findBrowserCalls('f( <- '), [], 'code that does not parse has none');
});

test('the debugger is valid R', () => {
  const stmts = parseR(DEBUGGER_R);
  const defined = stmts.flatMap((s) => (s.k === 'binary' && s.lhs.k === 'ident' ? [s.lhs.name] : []));
  assert.deepEqual(defined, ['.dta_debug_init', '.dta_show', '.dta_values', '.dta_debug_dialog', '.dta_browser']);
  // browser()'s own arguments are accepted, so existing calls keep working
  assert.match(DEBUGGER_R, /\.dta_browser <- function\(text = "", condition = NULL, expr = TRUE, skipCalls = 0L,/);
});

test('for Run, browser() goes to the debugger; app.R itself is unchanged', () => {
  const base = faithful();
  assert.deepEqual(instrumentForRun(base), { code: base, lines: [] }, 'no browser(), nothing added');

  const line = lineOf(base, 'bins <- seq(');
  const code = toggleBreakpoint(base, line)!;
  assert.ok(code, 'a breakpoint can go inside renderPlot');
  assert.equal(code.split('\n')[line - 1], '    browser()');
  const { code: run, lines } = instrumentForRun(code);
  assert.deepEqual(lines, [line]);
  assert.ok(run.startsWith(DEBUGGER_R));
  const app = run.slice(DEBUGGER_R.length + 1);
  // The call carries its line number and the code around it
  assert.match(app, new RegExp(`\\.dta_browser\\(\\.line = ${line}L, \\.source = "  ${line - 2} \\| `));
  assert.match(app, new RegExp(`→ ${line} \\|     browser\\(\\)`));
  // The server sets the debugger up first thing
  assert.match(app, /server <- function\(input, output, session\) \{\n {2}\.dta_debug_init\(\)\n/);
  assert.deepEqual(findBrowserCalls(run), [], 'no real browser() call left (the excerpt is only text)');
  parseR(run); // still valid R
  // The design (and app.R) still has the real browser()
  const plot = (() => {
    let p = '';
    walk(importApp(code).root, (n) => {
      if (n.type === 'plotOutput') p = String(n.props.code);
    });
    return p;
  })();
  assert.match(plot, /^x <- faithful\[\[input\$var\]\]\nbrowser\(\)\nbins/);
});

test("browser()'s arguments are passed on, also with comments in between", () => {
  const code = `server <- function(input, output, session) {
  observe({
    browser(expr = input$n > 5)
    browser( # stop here
    )
    browser("checkpoint", # why
      expr = TRUE)
  })
}`;
  const run = instrumentForRun(code).code.slice(DEBUGGER_R.length + 1);
  assert.match(run, /\.dta_browser\(expr = input\$n > 5, \.line = 3L,/);
  assert.match(run, /\.dta_browser\(\.line = 4L,/, 'only a comment: no arguments');
  assert.match(run, /\.dta_browser\("checkpoint", # why\n {6}expr = TRUE\n, \.line = 6L,/);
  parseR(run);
});

test('breakpoints toggle only where browser() can stop the app', () => {
  const base = faithful();
  const at = (text: string) => toggleBreakpoint(base, lineOf(base, text));
  assert.equal(at('library(shiny)'), null, 'top level: not in a function');
  assert.equal(at('sliderInput('), null, 'inside the UI: would break the call');
  assert.equal(at("xlab = input$var"), null, 'continuation line of an expression');
  assert.ok(at('output$distPlot <- renderPlot'), 'start of a statement in the server');
  assert.equal(toggleBreakpoint(base, 0), null);
  assert.equal(toggleBreakpoint(base, 9999), null);
  // Toggling twice gives the original code back
  const line = lineOf(base, 'output$distPlot <- renderPlot');
  const once = toggleBreakpoint(base, line)!;
  assert.equal(toggleBreakpoint(once, line), base);
});

test('browser() left in the code is flagged before deploying', () => {
  const code = toggleBreakpoint(faithful(), lineOf(faithful(), 'bins <- seq('))!;
  const issues = validate(importApp(code).root);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'warning');
  assert.match(issues[0].message, /^Plot: the server code calls browser\(\) for debugging\. Remove it before you deploy the app\.$/);
});
