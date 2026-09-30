import { COMPONENTS, PRESETS, canAccept, canHold, isRowsGrid, isStructural, syncedWidths, wrapperFor } from './components';
import type { Axis } from './components';
import type { ComponentType, Props, UINode } from './types';

let counter = 0;
/** Internal node ids (not the Shiny ids). */
export function newNodeId(): string {
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}`;
}

export function walk(node: UINode, visit: (n: UINode, parent: UINode | null) => void, parent: UINode | null = null) {
  visit(node, parent);
  node.children.forEach((c) => walk(c, visit, node));
}

export function findNode(root: UINode, id: string): UINode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

export function findParent(root: UINode, id: string): { parent: UINode; index: number } | null {
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === id) return { parent: root, index: i };
    const hit = findParent(root.children[i], id);
    if (hit) return hit;
  }
  return null;
}

/** Path of node ids from root to `id` (inclusive), or [] when absent. */
export function pathTo(root: UINode, id: string): string[] {
  if (root.id === id) return [root.id];
  for (const c of root.children) {
    const p = pathTo(c, id);
    if (p.length) return [root.id, ...p];
  }
  return [];
}

export function isDescendantOrSelf(root: UINode, ancestorId: string, id: string): boolean {
  const anc = findNode(root, ancestorId);
  return anc ? findNode(anc, id) !== null : false;
}

/** All Shiny ids currently in use (inputs and outputs share one namespace in the browser). */
export function usedShinyIds(root: UINode): Set<string> {
  const ids = new Set<string>();
  walk(root, (n) => {
    if (COMPONENTS[n.type].io && typeof n.props.id === 'string') ids.add(n.props.id);
  });
  return ids;
}

export function nextShinyId(prefix: string, used: Set<string>): string {
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function cloneProps(p: Props): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(p)) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

/** Create a fresh node of `type` (or from a palette preset) with default props and a unique Shiny id. */
export function createNode(type: ComponentType, root: UINode | null, presetKey?: string): UINode {
  const preset = presetKey ? PRESETS.find((p) => p.key === presetKey && p.type === type) : undefined;
  if (preset) {
    const cells = Array.from({ length: preset.cells }, () => createNode('cell', root));
    return { id: newNodeId(), type, props: { ...cloneProps(COMPONENTS[type].defaults), ...cloneProps(preset.props) }, children: cells };
  }
  const def = COMPONENTS[type];
  const props = cloneProps(def.defaults);
  if (def.idPrefix) props.id = nextShinyId(def.idPrefix, root ? usedShinyIds(root) : new Set());
  const node: UINode = { id: newNodeId(), type, props, children: [] };
  // A tabset is useless without tabs, so start it with two.
  if (type === 'navset_card_tab') {
    node.children = [
      { id: newNodeId(), type: 'nav_panel', props: { title: 'Tab 1' }, children: [] },
      { id: newNodeId(), type: 'nav_panel', props: { title: 'Tab 2' }, children: [] },
    ];
  }
  return node;
}

// ---------------------------------------------------------------------------
// Immutable operations. Each returns a new root (unchanged branches are shared).

function mapNode(root: UINode, id: string, fn: (n: UINode) => UINode): UINode {
  if (root.id === id) return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const next = mapNode(c, id, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

export function updateProps(root: UINode, id: string, patch: Props): UINode {
  return mapNode(root, id, (n) => ({ ...n, props: { ...n.props, ...patch } }));
}

export function removeNode(root: UINode, id: string): UINode {
  const node = findNode(root, id);
  if (!node || isStructural(node.type)) return root;
  const loc = findParent(root, id);
  if (!loc) return root;
  return mapNode(root, loc.parent.id, (p) => ({ ...p, children: p.children.filter((c) => c.id !== id) }));
}

/** `node` as it should be placed in a parent of type `parent`: as is, or inside its required wrapper. */
export function wrapFor(parent: ComponentType, node: UINode): UINode {
  const wrapper = wrapperFor(parent, node.type);
  if (!wrapper) return node;
  return { id: newNodeId(), type: wrapper, props: cloneProps(COMPONENTS[wrapper].defaults), children: [node] };
}

/**
 * Insert `node` at `index` in `parentId`. A node that needs a particular parent
 * (a Tab panel) is wrapped in one (a new Tabset card) when the target isn't one.
 */
export function insertNode(root: UINode, parentId: string, index: number, node: UINode): UINode {
  const parent = findNode(root, parentId);
  if (!parent || !canHold(parent.type, node.type)) return root;
  const item = wrapFor(parent.type, node);
  return mapNode(root, parentId, (p) => {
    const children = [...p.children];
    children.splice(Math.max(0, Math.min(index, children.length)), 0, item);
    return { ...p, children };
  });
}

/**
 * Move node `id` so it ends up at `index` in `parentId`'s children, where
 * `index` is expressed in terms of the parent's children *before* the move.
 */
export function moveNode(root: UINode, id: string, parentId: string, index: number): UINode {
  const node = findNode(root, id);
  const parent = findNode(root, parentId);
  if (!node || !parent || isStructural(node.type)) return root;
  if (isDescendantOrSelf(root, id, parentId)) return root; // can't drop into itself
  if (!canHold(parent.type, node.type)) return root;
  const loc = findParent(root, id)!;
  let target = index;
  if (loc.parent.id === parentId && loc.index < index) target -= 1;
  if (loc.parent.id === parentId && loc.index === target) return root;
  return insertNode(removeNode(root, id), parentId, target, node);
}

/** Deep copy with fresh node ids and fresh Shiny ids. */
export function cloneWithNewIds(node: UINode, root: UINode): UINode {
  const used = usedShinyIds(root);
  const rec = (n: UINode): UINode => {
    const def = COMPONENTS[n.type];
    const props = cloneProps(n.props);
    if (def.idPrefix) {
      const base = String(props.id ?? def.idPrefix).replace(/\d+$/, '') || def.idPrefix;
      props.id = nextShinyId(base, used);
      used.add(props.id);
    }
    const copy: UINode = { id: newNodeId(), type: n.type, props, children: n.children.map(rec) };
    if (n.raw) copy.raw = { ...n.raw };
    if (n.extra) copy.extra = n.extra;
    return copy;
  };
  return rec(node);
}

export function duplicateNode(root: UINode, id: string): { root: UINode; newId: string | null } {
  const node = findNode(root, id);
  const loc = findParent(root, id);
  if (!node || !loc || isStructural(node.type)) return { root, newId: null };
  const copy = cloneWithNewIds(node, root);
  return { root: insertNode(root, loc.parent.id, loc.index + 1, copy), newId: copy.id };
}

export function updateRaw(root: UINode, id: string, prop: string, value: string | null): UINode {
  return mapNode(root, id, (n) => {
    const raw = { ...(n.raw ?? {}) };
    if (value === null) delete raw[prop];
    else raw[prop] = value;
    const next: UINode = { ...n, raw };
    if (!Object.keys(raw).length) delete next.raw;
    return next;
  });
}

export function updateExtra(root: UINode, id: string, extra: string): UINode {
  return mapNode(root, id, (n) => {
    const next: UINode = { ...n, extra };
    if (!extra.trim()) delete next.extra;
    return next;
  });
}

/**
 * Give nodes of a freshly parsed tree the ids of their counterparts in the
 * previous tree, so selection, open tabs and React state survive code edits.
 * Children are matched by Shiny id first, then by position and type.
 */
export function reconcileIds(prev: UINode, next: UINode): UINode {
  const rec = (old: UINode | undefined, n: UINode): UINode => {
    const id = old && old.type === n.type ? old.id : n.id;
    const pool = old ? [...old.children] : [];
    const taken = new Set<UINode>();
    const pick = (c: UINode, i: number): UINode | undefined => {
      const byShinyId =
        typeof c.props.id === 'string' ? pool.find((o) => !taken.has(o) && o.type === c.type && o.props.id === c.props.id) : undefined;
      const byPos = pool[i] && !taken.has(pool[i]) && pool[i].type === c.type ? pool[i] : undefined;
      const hit = byShinyId ?? byPos;
      if (hit) taken.add(hit);
      return hit;
    };
    const children = n.children.map((c, i) => rec(pick(c, i), c));
    return { ...n, id, children };
  };
  return rec(prev, next);
}

/** Deep equality of two trees (ids included). */
export function sameTree(a: UINode, b: UINode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Update col_widths of the given uniform grids after their number of children changed. */
export function syncGrids(root: UINode, ids: (string | null | undefined)[]): UINode {
  let out = root;
  for (const id of new Set(ids)) {
    if (!id) continue;
    const node = findNode(out, id);
    const next = node ? syncedWidths(node) : null;
    if (next !== null) out = updateProps(out, id, { col_widths: next });
  }
  return out;
}

export type Side = 'left' | 'right';

/** Can `nodeType` be dropped beside `targetId` (wrapping both into a new two-column grid)? */
export function canPlaceBeside(root: UINode, targetId: string, nodeType: ComponentType, movingId?: string): boolean {
  const target = findNode(root, targetId);
  const loc = findParent(root, targetId);
  if (!target || !loc || isStructural(target.type) || target.type === 'nav_panel') return false;
  if (!canAccept(loc.parent.type, 'layout_columns') || !canHold('cell', nodeType)) return false;
  if (movingId && isDescendantOrSelf(root, movingId, targetId)) return false;
  return true;
}

/**
 * Put `node` to the left or right of `targetId`: the target is replaced by a
 * two-column grid whose cells hold the target and the new node. A target that
 * already is a cell becomes the grid's cell itself. When `movingId` is given,
 * that node is moved instead of `node` being inserted.
 */
export function placeBeside(root: UINode, targetId: string, side: Side, node: UINode, movingId?: string): UINode {
  if (!canPlaceBeside(root, targetId, node.type, movingId)) return root;
  const oldParent = movingId ? findParent(root, movingId)?.parent.id : undefined;
  let r = movingId ? removeNode(root, movingId) : root;
  const target = findNode(r, targetId)!;
  const loc = findParent(r, targetId)!;
  const asCell = (n: UINode): UINode =>
    n.type === 'cell' ? n : { id: newNodeId(), type: 'cell', props: {}, children: [wrapFor('cell', n)] };
  const cells = side === 'right' ? [asCell(target), asCell(node)] : [asCell(node), asCell(target)];
  const grid: UINode = { id: newNodeId(), type: 'layout_columns', props: { col_widths: '6, 6' }, children: cells };
  r = mapNode(r, loc.parent.id, (p) => ({ ...p, children: p.children.map((c) => (c.id === targetId ? grid : c)) }));
  return syncGrids(r, [oldParent]);
}

// ---------------------------------------------------------------------------
// Column / Row: adding one cell at a time

export function gridAxis(grid: UINode): Axis {
  return isRowsGrid(grid) ? 'row' : 'column';
}

/** A grid whose widths the designer manages (not an R expression). */
const isPlainGrid = (n: UINode | undefined): boolean => !!n && n.type === 'layout_columns' && !n.raw?.col_widths;

/** A new grid holding `cells` along `axis`. A single column uses automatic widths (12 would read as a row). */
function newGrid(axis: Axis, cells: UINode[]): UINode {
  const n = cells.length;
  const widths =
    axis === 'row' ? Array(n).fill(12).join(', ') : n > 1 && 12 % n === 0 ? Array(n).fill(12 / n).join(', ') : '';
  return { id: newNodeId(), type: 'layout_columns', props: { col_widths: widths }, children: cells };
}

/**
 * Add one empty cell along `axis`, dropped at (`parentId`, `index`):
 *  - on a grid: it becomes the next column/row there;
 *  - in a cell of a grid running the same way: a new sibling right after that cell;
 *  - in a cell of a grid running the other way: that cell is split in two
 *    (its current content in the first half), e.g. a Column dropped in a row;
 *  - anywhere else: a new grid with this single cell.
 */
export function addCell(root: UINode, parentId: string, index: number, axis: Axis): { root: UINode; cellId: string | null } {
  const parent = findNode(root, parentId);
  if (!parent) return { root, cellId: null };
  const cell = createNode('cell', root);
  const done = (r: UINode) => ({ root: r, cellId: r === root ? null : cell.id });

  if (isPlainGrid(parent)) return done(syncGrids(insertNode(root, parentId, index, cell), [parentId]));

  const loc = findParent(root, parentId);
  if (parent.type === 'cell' && loc && isPlainGrid(loc.parent)) {
    const grid = loc.parent;
    if (gridAxis(grid) === axis) return done(syncGrids(insertNode(root, grid.id, loc.index + 1, cell), [grid.id]));
    const only = parent.children.length === 1 ? parent.children[0] : undefined;
    if (only && isPlainGrid(only) && gridAxis(only) === axis)
      return done(syncGrids(insertNode(root, only.id, only.children.length, cell), [only.id]));
    const existing: UINode = { id: newNodeId(), type: 'cell', props: {}, children: parent.children };
    return done(mapNode(root, parentId, (p) => ({ ...p, children: [newGrid(axis, [existing, cell])] })));
  }

  if (!canHold(parent.type, 'layout_columns')) return { root, cellId: null };
  return done(insertNode(root, parentId, index, newGrid(axis, [cell])));
}
