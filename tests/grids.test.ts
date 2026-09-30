import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApp, generateUI } from '../src/model/codegen';
import { isRowsGrid } from '../src/model/components';
import { importApp } from '../src/model/fromR';
import { emptyProject } from '../src/model/templates';
import { findNode } from '../src/model/tree';
import type { UINode } from '../src/model/types';
import { initialState, reducer } from '../src/state/store';
import type { EditorState } from '../src/state/store';

const main = (root: UINode) => root.children.find((c) => c.type === 'main')!;

function withMain(): { s: EditorState; mainId: string } {
  const s = initialState(emptyProject());
  return { s, mainId: main(s.root).id };
}

test('the 2-columns and 2-rows presets create grids of empty cells', () => {
  let { s, mainId } = withMain();
  s = reducer(s, { type: 'add', componentType: 'layout_columns', preset: 'grid_2cols', parentId: mainId, index: 0 });
  s = reducer(s, { type: 'add', componentType: 'layout_columns', preset: 'grid_2rows', parentId: mainId, index: 1 });
  const [cols, rows] = main(s.root).children;
  assert.deepEqual(cols.children.map((c) => c.type), ['cell', 'cell']);
  assert.equal(cols.props.col_widths, '6, 6');
  assert.equal(isRowsGrid(cols), false);
  assert.equal(rows.props.col_widths, '12, 12');
  assert.equal(isRowsGrid(rows), true);
  assert.match(generateUI(s.root), /layout_columns\(col_widths = c\(6, 6\), div\(\), div\(\)\)/);
  assert.match(generateUI(s.root), /layout_columns\(col_widths = c\(12, 12\), div\(\), div\(\)\)/);
});

test('grids nest: a 2-column grid in a row, a 2-row grid in a column cell', () => {
  let { s, mainId } = withMain();
  s = reducer(s, { type: 'add', componentType: 'layout_columns', preset: 'grid_2rows', parentId: mainId, index: 0 });
  const rowCell = main(s.root).children[0].children[0];
  s = reducer(s, { type: 'add', componentType: 'layout_columns', preset: 'grid_2cols', parentId: rowCell.id, index: 0 });
  const colCell = findNode(s.root, rowCell.id)!.children[0].children[1];
  s = reducer(s, { type: 'add', componentType: 'layout_columns', preset: 'grid_2rows', parentId: colCell.id, index: 0 });
  s = reducer(s, { type: 'add', componentType: 'plotOutput', parentId: findNode(s.root, colCell.id)!.children[0].children[0].id, index: 0 });
  const code = generateApp(s.root).app;
  assert.match(
    code,
    /layout_columns\(\n {4}col_widths = c\(12, 12\),\n {4}div\(\n {6}layout_columns\(\n {8}col_widths = c\(6, 6\),\n {8}div\(\),\n {8}div\(\n {10}layout_columns\(col_widths = c\(12, 12\), div\(plotOutput\("plot1"\)\), div\(\)\)/,
  );
  // and it survives the trip through app.R
  assert.equal(generateApp(importApp(code).root).app, code);
});

test('uniform grids keep their widths in step with the number of cells', () => {
  let { s, mainId } = withMain();
  s = reducer(s, { type: 'add', componentType: 'layout_columns', preset: 'grid_2cols', parentId: mainId, index: 0 });
  let grid = main(s.root).children[0];
  s = reducer(s, { type: 'add', componentType: 'cell', parentId: grid.id, index: 2 });
  assert.equal(findNode(s.root, grid.id)!.props.col_widths, '4, 4, 4');
  s = reducer(s, { type: 'add', componentType: 'cell', parentId: grid.id, index: 3 });
  assert.equal(findNode(s.root, grid.id)!.props.col_widths, '3, 3, 3, 3');
  s = reducer(s, { type: 'remove', id: findNode(s.root, grid.id)!.children[3].id });
  s = reducer(s, { type: 'remove', id: findNode(s.root, grid.id)!.children[2].id });
  assert.equal(findNode(s.root, grid.id)!.props.col_widths, '6, 6');

  s = reducer(s, { type: 'add', componentType: 'layout_columns', preset: 'grid_2rows', parentId: mainId, index: 1 });
  grid = main(s.root).children[1];
  s = reducer(s, { type: 'duplicate', id: grid.children[0].id });
  assert.equal(findNode(s.root, grid.id)!.props.col_widths, '12, 12, 12');

  // custom widths are the user's choice and stay as they are
  s = reducer(s, { type: 'updateProps', id: grid.id, patch: { col_widths: '4, 8' } });
  s = reducer(s, { type: 'remove', id: findNode(s.root, grid.id)!.children[0].id });
  assert.equal(findNode(s.root, grid.id)!.props.col_widths, '4, 8');
});

test('dropping beside a component wraps both into a two-column grid', () => {
  let { s, mainId } = withMain();
  s = reducer(s, { type: 'add', componentType: 'card', parentId: mainId, index: 0 });
  const card = main(s.root).children[0];
  s = reducer(s, { type: 'placeBeside', targetId: card.id, side: 'right', componentType: 'plotOutput' });
  const grid = main(s.root).children[0];
  assert.equal(grid.type, 'layout_columns');
  assert.equal(grid.props.col_widths, '6, 6');
  assert.equal(grid.children[0].children[0].id, card.id, 'card stays on the left');
  assert.equal(grid.children[1].children[0].type, 'plotOutput');
  assert.equal(findNode(s.root, s.selectedId!)!.type, 'plotOutput');

  // moving a component to the left of the plot's cell
  s = reducer(s, { type: 'add', componentType: 'textOutput', parentId: mainId, index: 1 });
  const text = main(s.root).children[1];
  const plotCell = grid.children[1];
  s = reducer(s, { type: 'placeBeside', targetId: plotCell.id, side: 'left', id: text.id });
  const inner = findNode(s.root, grid.id)!.children[1];
  assert.equal(inner.type, 'layout_columns', 'the plot cell became a nested grid');
  assert.deepEqual(inner.children.map((c) => c.children[0].type), ['textOutput', 'plotOutput']);
  assert.equal(inner.children[1].id, plotCell.id, 'a cell target is reused, not wrapped twice');
  assert.equal(main(s.root).children.length, 1, 'the moved text left the main area');

  // not beside itself, and not into its own descendant
  const before = s.root;
  s = reducer(s, { type: 'placeBeside', targetId: grid.children[0].id, side: 'right', id: grid.id });
  assert.equal(s.root, before);
});

test('Row and Column build a grid one cell at a time', () => {
  let { s, mainId } = withMain();
  const add = (preset: 'row' | 'column', parentId: string, index = 999) =>
    (s = reducer(s, { type: 'add', componentType: 'cell', preset, parentId, index }));

  // Row in the main area -> a new grid with one row
  add('row', mainId);
  const grid = main(s.root).children[0];
  assert.equal(grid.type, 'layout_columns');
  assert.equal(grid.props.col_widths, '12');
  assert.equal(isRowsGrid(grid), true);
  assert.equal(s.selectedId, grid.children[0].id, 'the new row is selected');

  // Row dropped on that grid -> row 2
  add('row', grid.id);
  assert.equal(findNode(s.root, grid.id)!.props.col_widths, '12, 12');

  // Row dropped inside row 1 -> a new row right after it (row 2 moves down)
  const row1 = findNode(s.root, grid.id)!.children[0];
  add('row', row1.id, 0);
  assert.equal(findNode(s.root, grid.id)!.children.length, 3);
  assert.equal(findNode(s.root, grid.id)!.children[1].id, s.selectedId);

  // Column dropped inside row 2 -> row 2 splits into two columns
  const row2 = findNode(s.root, grid.id)!.children[1];
  add('column', row2.id, 0);
  const split = findNode(s.root, row2.id)!.children[0];
  assert.equal(split.type, 'layout_columns');
  assert.equal(split.props.col_widths, '6, 6');
  assert.deepEqual(split.children.map((c) => c.type), ['cell', 'cell']);
  assert.equal(split.children[1].id, s.selectedId);

  // Column dropped inside row 2 again -> a third column, not a nested grid
  add('column', row2.id, 0);
  assert.equal(findNode(s.root, split.id)!.children.length, 3);
  assert.equal(findNode(s.root, split.id)!.props.col_widths, '4, 4, 4');

  // Row dropped inside a column -> that column splits into rows, keeping its content first
  const col1 = findNode(s.root, split.id)!.children[0];
  s = reducer(s, { type: 'add', componentType: 'plotOutput', parentId: col1.id, index: 0 });
  add('row', col1.id);
  const rowsInCol = findNode(s.root, col1.id)!.children[0];
  assert.equal(rowsInCol.props.col_widths, '12, 12');
  assert.equal(rowsInCol.children[0].children[0].type, 'plotOutput', 'existing content goes to the first row');

  const code = generateApp(s.root).app;
  assert.equal(generateApp(importApp(code).root).app, code, 'round-trips through app.R');
});

test('Column in the main area starts a one-column grid; Column beside a card adds a column', () => {
  let { s, mainId } = withMain();
  s = reducer(s, { type: 'add', componentType: 'cell', preset: 'column', parentId: mainId, index: 0 });
  const grid = main(s.root).children[0];
  assert.equal(grid.props.col_widths, '', 'a single column uses automatic width');
  assert.equal(isRowsGrid(grid), false);
  s = reducer(s, { type: 'add', componentType: 'cell', preset: 'column', parentId: grid.id, index: 1 });
  assert.equal(findNode(s.root, grid.id)!.children.length, 2);
  assert.match(generateUI(s.root), /layout_columns\(div\(\), div\(\)\)/);

  s = reducer(s, { type: 'add', componentType: 'card', parentId: mainId, index: 1 });
  const card = main(s.root).children[1];
  s = reducer(s, { type: 'placeBeside', targetId: card.id, side: 'right', componentType: 'cell', preset: 'column' });
  const g2 = main(s.root).children[1];
  assert.deepEqual(g2.children.map((c) => c.children.length), [1, 0], 'card in column 1, empty column 2');
});
