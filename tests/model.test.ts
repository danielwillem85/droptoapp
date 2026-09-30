import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApp, generateUI } from '../src/model/codegen';
import { parseWidths, rCall, rStr } from '../src/model/rcode';
import { tokenizeR } from '../src/model/rHighlight';
import { emptyProject, starterProject } from '../src/model/templates';
import { createNode, findNode, findParent, insertNode, moveNode, usedShinyIds } from '../src/model/tree';
import { validate } from '../src/model/validate';
import { initialState, reducer } from '../src/state/store';
import { COMPONENTS, paletteItems, PALETTE_CATEGORIES } from '../src/model/components';
import type { UINode } from '../src/model/types';

const main = (root: UINode) => root.children.find((c) => c.type === 'main')!;
const sidebar = (root: UINode) => root.children.find((c) => c.type === 'sidebar')!;

/** Minimal structural check of R code: balanced brackets outside strings/comments. */
function assertBalancedR(code: string) {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const t of tokenizeR(code)) {
    if (t.kind === 'string') {
      assert.ok(t.text.length >= 2 && t.text.endsWith(t.text[0]), `unterminated string: ${t.text}`);
      continue;
    }
    if (t.kind === 'comment') continue;
    for (const ch of t.text) {
      if ('([{'.includes(ch)) stack.push(ch);
      else if (ch in pairs) assert.equal(stack.pop(), pairs[ch], `unbalanced ${ch} in:\n${code}`);
    }
  }
  assert.equal(stack.length, 0, `unclosed brackets in:\n${code}`);
}

test('rStr escapes quotes, backslashes and newlines', () => {
  assert.equal(rStr('say "hi"\\\n'), '"say \\"hi\\"\\\\\\n"');
});

test('rCall stays on one line when short and wraps when long', () => {
  assert.equal(rCall('f', ['1', undefined, '2']), 'f(1, 2)');
  const long = rCall('sliderInput', ['"a_long_input_id"', '"A very long label for this slider"', 'min = 1', 'max = 100']);
  assert.match(long, /^sliderInput\(\n {2}"a_long_input_id",\n/);
});

test('parseWidths accepts several notations', () => {
  assert.deepEqual(parseWidths('4, 8'), [4, 8]);
  assert.deepEqual(parseWidths('c(3 9)'), [3, 9]);
  assert.deepEqual(parseWidths('abc, 13'), []);
});

test('starter project generates the expected app', () => {
  const { app } = generateApp(starterProject().root);
  assert.match(app, /library\(shiny\)\nlibrary\(bslib\)/);
  assert.match(app, /ui <- page_sidebar\(\n {2}title = "Old Faithful Geyser Data",\n {2}sidebar = sidebar\(/);
  assert.match(app, /sliderInput\("bins", "Number of bins:", min = 1, max = 50, value = 30\)/);
  assert.match(app, /card\(\n {4}full_screen = TRUE,\n {4}card_header\("Histogram"\),\n {4}plotOutput\("distPlot"\)\n {2}\)/);
  assert.match(app, /output\$distPlot <- renderPlot\(\{\n {4}x <- faithful\[\[input\$var\]\]/);
  assert.match(app, /# Inputs: input\$bins, input\$var/);
  assert.match(app, /shinyApp\(ui, server\)\n$/);
  assertBalancedR(app);
  assert.deepEqual(validate(starterProject().root), []);
});

test('every palette component generates balanced R code', () => {
  for (const cat of PALETTE_CATEGORIES) {
    for (const def of paletteItems(cat)) {
      let root = emptyProject().root;
      if (def.type === 'nav_panel') {
        const tabs = createNode('navset_card_tab', root);
        root = insertNode(root, main(root).id, 0, tabs);
        root = insertNode(root, tabs.id, 0, createNode('nav_panel', root));
      } else {
        root = insertNode(root, main(root).id, 0, createNode(def.type, root));
      }
      assert.equal(main(root).children.length, 1, `${def.type} was not inserted`);
      const { app } = generateApp(root);
      assertBalancedR(app);
      if (def.renderFn || def.server) assert.match(app, def.type === 'actionButton' ? /observeEvent\(input\$button1/ : /output\$\w+ <- render/);
      assert.deepEqual(validate(root).filter((i) => i.severity === 'error'), [], def.type);
    }
  }
});

test('theme and non-sidebar layouts', () => {
  let root = emptyProject().root;
  root = { ...root, props: { ...root.props, layout: 'page_fillable', theme: 'flatly' } };
  root = insertNode(root, sidebar(root).id, 0, createNode('sliderInput', root));
  const ui = generateUI(root);
  assert.equal(ui, 'ui <- page_fillable(\n  title = "My Shiny app",\n  theme = bs_theme(bootswatch = "flatly")\n)');
  assert.equal(validate(root)[0].severity, 'warning');
  assert.doesNotMatch(generateApp(root).server, /slider1/);
});

test('columns with widths and tabsets', () => {
  let root = emptyProject().root;
  const cols = { ...createNode('layout_columns', root), props: { col_widths: '4, 8' } };
  root = insertNode(root, main(root).id, 0, cols);
  root = insertNode(root, cols.id, 0, createNode('textOutput', root));
  const tabs = createNode('navset_card_tab', root);
  root = insertNode(root, main(root).id, 1, tabs);
  const ui = generateUI(root);
  assert.match(ui, /layout_columns\(col_widths = c\(4, 8\), textOutput\("txt1"\)\)/);
  assert.match(ui, /navset_card_tab\(nav_panel\("Tab 1"\), nav_panel\("Tab 2"\)\)/);
});

test('containment rules are enforced', () => {
  let root = emptyProject().root;
  const tabs = createNode('navset_card_tab', root);
  root = insertNode(root, main(root).id, 0, tabs);
  const before = root;
  root = insertNode(root, tabs.id, 0, createNode('sliderInput', root)); // slider can't go in a tabset directly
  assert.equal(root, before);
  root = insertNode(root, tabs.id, 0, createNode('value_box', root)); // nor a value box
  assert.equal(root, before);
  // a tab panel outside a tabset gets a new Tabset card around it
  const panel = createNode('nav_panel', root);
  root = insertNode(root, main(root).id, 1, panel);
  const wrapper = main(root).children[1];
  assert.equal(wrapper.type, 'navset_card_tab');
  assert.deepEqual(wrapper.children.map((c) => c.id), [panel.id]);
});

test('moveNode reorders, reparents and refuses cycles', () => {
  let root = emptyProject().root;
  const a = createNode('heading', root);
  const b = createNode('paragraph', root);
  const card = createNode('card', root);
  root = insertNode(root, main(root).id, 0, a);
  root = insertNode(root, main(root).id, 1, b);
  root = insertNode(root, main(root).id, 2, card);
  root = moveNode(root, a.id, main(root).id, 2); // a after b
  assert.deepEqual(main(root).children.map((c) => c.id), [b.id, a.id, card.id]);
  root = moveNode(root, b.id, card.id, 0); // into card
  assert.equal(findParent(root, b.id)!.parent.id, card.id);
  const same = moveNode(root, card.id, card.id, 0); // into itself
  assert.equal(same, root);
});

test('new ids are unique and duplicates get fresh ids', () => {
  let s = initialState(emptyProject());
  const m = main(s.root).id;
  s = reducer(s, { type: 'add', componentType: 'sliderInput', parentId: m, index: 0 });
  s = reducer(s, { type: 'add', componentType: 'sliderInput', parentId: m, index: 1 });
  assert.deepEqual([...usedShinyIds(s.root)], ['slider1', 'slider2']);
  s = reducer(s, { type: 'duplicate', id: s.selectedId! });
  assert.deepEqual([...usedShinyIds(s.root)].sort(), ['slider1', 'slider2', 'slider3']);
});

test('undo/redo and edit coalescing', () => {
  let s = initialState(emptyProject());
  const m = main(s.root).id;
  s = reducer(s, { type: 'add', componentType: 'textInput', parentId: m, index: 0 });
  const id = s.selectedId!;
  for (const label of ['N', 'Na', 'Nam', 'Name']) s = reducer(s, { type: 'updateProps', id, patch: { label } });
  assert.equal(s.past.length, 2); // add + one coalesced edit
  s = reducer(s, { type: 'undo' });
  assert.equal(findNode(s.root, id)!.props.label, 'Text');
  s = reducer(s, { type: 'undo' });
  assert.equal(main(s.root).children.length, 0);
  s = reducer(s, { type: 'redo' });
  s = reducer(s, { type: 'redo' });
  assert.equal(findNode(s.root, id)!.props.label, 'Name');
});

test('validation catches bad and duplicate ids', () => {
  let root = emptyProject().root;
  const a = { ...createNode('textOutput', root), props: { id: 'out', code: '' } };
  const b = { ...createNode('plotOutput', root), props: { id: 'out', code: '' } };
  const c = { ...createNode('textInput', root), props: { id: '1bad', label: 'x' } };
  root = insertNode(root, main(root).id, 0, a);
  root = insertNode(root, main(root).id, 1, b);
  root = insertNode(root, main(root).id, 2, c);
  const msgs = validate(root).map((i) => i.message).join('\n');
  assert.match(msgs, /Duplicate ID "out"/);
  assert.match(msgs, /"1bad" is not a valid ID/);
});

test('tokenizer recognises the main token kinds', () => {
  const kinds = tokenizeR('x <- f("a", 1) # hi').map((t) => t.kind);
  assert.deepEqual(kinds, ['plain', 'op', 'plain', 'fn', 'plain', 'string', 'plain', 'number', 'plain', 'comment']);
  assert.ok(COMPONENTS.page);
});
