import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateUI } from '../src/model/codegen';
import { emptyProject, starterProject } from '../src/model/templates';
import { findNode, findParent, walk } from '../src/model/tree';
import type { UINode } from '../src/model/types';
import { clickAddTarget, initialState, reducer } from '../src/state/store';

const main = (root: UINode) => root.children.find((c) => c.type === 'main')!;
const all = (root: UINode, type: string) => {
  const out: UINode[] = [];
  walk(root, (n) => {
    if (n.type === type) out.push(n);
  });
  return out;
};

test('a tab panel dropped in the main area starts a new Tabset card', () => {
  let s = initialState(emptyProject());
  s = reducer(s, { type: 'add', componentType: 'nav_panel', parentId: main(s.root).id, index: 0 });
  const tabs = main(s.root).children[0];
  assert.equal(tabs.type, 'navset_card_tab');
  assert.equal(tabs.children.length, 1);
  assert.equal(s.selectedId, tabs.children[0].id, 'the new tab is selected');
  assert.match(generateUI(s.root), /navset_card_tab\(nav_panel\("Tab 1"\)\)/);
});

test('clicking Tab panel: next to the current tab, else a new tabset in the main area', () => {
  let s = initialState(emptyProject());
  // nothing selected -> end of the main area, wrapped
  let t = clickAddTarget(s.root, null, 'nav_panel')!;
  assert.equal(t.parentId, main(s.root).id);
  s = reducer(s, { type: 'add', componentType: 'nav_panel', ...t });
  const tabs = main(s.root).children[0];
  // with a component inside a tab selected -> new tab right after that tab, in the same tabset
  s = reducer(s, { type: 'add', componentType: 'plotOutput', parentId: tabs.children[0].id, index: 0 });
  t = clickAddTarget(s.root, s.selectedId, 'nav_panel')!;
  assert.deepEqual(t, { parentId: tabs.id, index: 1 });
  s = reducer(s, { type: 'add', componentType: 'nav_panel', ...t });
  assert.deepEqual(
    findNode(s.root, tabs.id)!.children.map((c) => c.props.title),
    ['Tab 1', 'Tab 2'],
    'new tabs are numbered',
  );
  assert.equal(all(s.root, 'navset_card_tab').length, 1, 'no nested tabset was created');
});

test('tabs can be dragged out of a tabset, and placed beside other components', () => {
  let s = initialState(starterProject());
  s = reducer(s, { type: 'add', componentType: 'navset_card_tab', parentId: main(s.root).id, index: 0 });
  const tabs = main(s.root).children[0];
  const tab2 = tabs.children[1];
  // move Tab 2 to the end of the main area -> it gets its own tabset
  s = reducer(s, { type: 'move', id: tab2.id, parentId: main(s.root).id, index: main(s.root).children.length });
  const parent = findParent(s.root, tab2.id)!.parent;
  assert.equal(parent.type, 'navset_card_tab');
  assert.notEqual(parent.id, tabs.id);
  assert.equal(findNode(s.root, tabs.id)!.children.length, 1);
  // drop a new tab panel beside the histogram card -> grid with a tabset in the new cell
  const card = main(s.root).children.find((c) => c.type === 'card')!;
  s = reducer(s, { type: 'placeBeside', targetId: card.id, side: 'right', componentType: 'nav_panel' });
  const grid = findParent(s.root, card.id)!.parent;
  const cell = findParent(s.root, grid.id)!.parent;
  assert.equal(grid.type, 'cell');
  assert.equal(cell.type, 'layout_columns');
  assert.equal(cell.children[1].children[0].type, 'navset_card_tab');
  assert.equal(cell.children[1].children[0].children[0].type, 'nav_panel');
});
