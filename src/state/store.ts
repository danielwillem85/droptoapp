import { COMPONENTS, canHold, isRowsGrid, presetByKey } from '../model/components';
import { ImportError, importApp } from '../model/fromR';
import {
  addCell,
  createNode,
  duplicateNode,
  findNode,
  findParent,
  insertNode,
  moveNode,
  reconcileIds,
  removeNode,
  pathTo,
  placeBeside,
  sameTree,
  syncGrids,
  updateExtra,
  updateProps,
  updateRaw,
  walk,
} from '../model/tree';
import type { Side } from '../model/tree';
import type { ComponentType, Project, Props, UINode } from '../model/types';

const HISTORY_LIMIT = 200;

export interface EditorState {
  root: UINode;
  selectedId: string | null;
  past: UINode[];
  future: UINode[];
  /** Consecutive edits with the same key (e.g. typing in one field) collapse into one undo step. */
  coalesceKey: string | null;
  /**
   * app.R as typed in the code editor. While set, the editor shows this text
   * (not the generated code) and the design follows it. Any visual edit clears
   * it, and the code is regenerated from the design.
   */
  codeDraft: string | null;
  /** Why codeDraft could not be turned into a design (the design keeps its last good state). */
  codeError: CodeError | null;
}

export interface CodeError {
  message: string;
  line: number;
  col: number;
}

export type Action =
  | { type: 'select'; id: string | null }
  | { type: 'add'; componentType: ComponentType; preset?: string; parentId: string; index: number }
  /** Drop beside a component: both end up in a new two-column grid. Moves `id`, or creates `componentType`. */
  | { type: 'placeBeside'; targetId: string; side: Side; id?: string; componentType?: ComponentType; preset?: string }
  | { type: 'move'; id: string; parentId: string; index: number }
  | { type: 'remove'; id: string }
  | { type: 'duplicate'; id: string }
  | { type: 'nudge'; id: string; delta: -1 | 1 }
  | { type: 'updateProps'; id: string; patch: Props }
  | { type: 'setRaw'; id: string; prop: string; value: string | null }
  | { type: 'setExtra'; id: string; extra: string }
  | { type: 'setCode'; code: string }
  | { type: 'discardCode' }
  | { type: 'load'; project: Project }
  | { type: 'undo' }
  | { type: 'redo' };

/** Turn app.R text into a design, keeping node ids from `prev` where possible. */
function fromCode(code: string, prev: UINode): { root: UINode; error: CodeError | null } {
  try {
    const root = reconcileIds(prev, importApp(code).root);
    return { root: sameTree(root, prev) ? prev : root, error: null };
  } catch (e) {
    if (e instanceof ImportError) return { root: prev, error: { message: e.message, line: e.line, col: e.col } };
    throw e;
  }
}

function projectState(project: Project, prev: UINode): Pick<EditorState, 'root' | 'codeDraft' | 'codeError'> {
  if (project.code === undefined) return { root: project.root, codeDraft: null, codeError: null };
  const { root, error } = fromCode(project.code, project.root);
  return { root: error ? project.root : reconcileIds(prev, root), codeDraft: project.code, codeError: error };
}

export function initialState(project: Project): EditorState {
  return {
    ...projectState(project, project.root),
    selectedId: null,
    past: [],
    future: [],
    coalesceKey: null,
  };
}

function commit(state: EditorState, root: UINode, extra: Partial<EditorState> = {}, coalesceKey: string | null = null): EditorState {
  if (root === state.root) return { ...state, ...extra };
  const merge = coalesceKey !== null && coalesceKey === state.coalesceKey;
  return {
    ...state,
    codeDraft: null, // a visual edit: regenerate the code from the design
    codeError: null,
    ...extra,
    root,
    past: merge ? state.past : [...state.past, state.root].slice(-HISTORY_LIMIT),
    future: [],
    coalesceKey,
  };
}

/** Give a newly added tab a title that is unique in its tabset: Tab 1, Tab 2, ... */
function numberNewTab(root: UINode, id: string): UINode {
  const tabs = findParent(root, id)?.parent;
  if (!tabs) return root;
  const used = new Set(tabs.children.filter((c) => c.id !== id).map((c) => String(c.props.title ?? '')));
  let n = tabs.children.length;
  while (used.has(`Tab ${n}`)) n++;
  return updateProps(root, id, { title: `Tab ${n}` });
}

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedId: action.id, coalesceKey: null };

    case 'add': {
      const adds = presetByKey(action.preset)?.adds;
      if (adds) {
        // Column / Row: one new cell, placed according to where it was dropped
        const { root, cellId } = addCell(state.root, action.parentId, action.index, adds);
        return cellId ? commit(state, root, { selectedId: cellId }) : state;
      }
      const node = createNode(action.componentType, state.root, action.preset);
      let root = insertNode(state.root, action.parentId, action.index, node);
      if (root === state.root) return state;
      if (node.type === 'nav_panel') root = numberNewTab(root, node.id);
      return commit(state, syncGrids(root, [action.parentId]), { selectedId: node.id });
    }

    case 'move': {
      const from = findParent(state.root, action.id)?.parent.id;
      const root = moveNode(state.root, action.id, action.parentId, action.index);
      if (root === state.root) return state;
      return commit(state, syncGrids(root, [from, action.parentId]), { selectedId: action.id });
    }

    case 'placeBeside': {
      const moving = action.id ? findNode(state.root, action.id) : null;
      const node = moving ?? (action.componentType ? createNode(action.componentType, state.root, action.preset) : null);
      if (!node) return state;
      const root = placeBeside(state.root, action.targetId, action.side, node, moving ? moving.id : undefined);
      return root === state.root ? state : commit(state, root, { selectedId: node.id });
    }

    case 'remove': {
      const loc = findParent(state.root, action.id);
      const removed = removeNode(state.root, action.id);
      if (removed === state.root || !loc) return state;
      const root = syncGrids(removed, [loc.parent.id]);
      // Select a sensible neighbour so keyboard deletion can continue.
      const siblings = findNode(root, loc.parent.id)?.children ?? [];
      const next = siblings[Math.min(loc.index, siblings.length - 1)]?.id ?? loc.parent.id;
      return commit(state, root, { selectedId: next });
    }

    case 'duplicate': {
      const { root, newId } = duplicateNode(state.root, action.id);
      return commit(state, syncGrids(root, [findParent(state.root, action.id)?.parent.id]), newId ? { selectedId: newId } : {});
    }

    case 'nudge': {
      const loc = findParent(state.root, action.id);
      if (!loc) return state;
      const target = loc.index + (action.delta === 1 ? 2 : -1);
      if (target < 0 || target > loc.parent.children.length) return state;
      return commit(state, moveNode(state.root, action.id, loc.parent.id, target));
    }

    case 'updateProps': {
      const key = `props:${action.id}:${Object.keys(action.patch).join(',')}`;
      return commit(state, updateProps(state.root, action.id, action.patch), {}, key);
    }

    case 'setRaw':
      return commit(state, updateRaw(state.root, action.id, action.prop, action.value), {}, `raw:${action.id}:${action.prop}`);

    case 'setExtra':
      return commit(state, updateExtra(state.root, action.id, action.extra), {}, `extra:${action.id}`);

    case 'setCode': {
      const { root, error } = fromCode(action.code, state.root);
      const selectedId = state.selectedId && findNode(root, state.selectedId) ? state.selectedId : null;
      return commit(state, root, { codeDraft: action.code, codeError: error, selectedId }, 'code');
    }

    case 'discardCode':
      return { ...state, codeDraft: null, codeError: null, coalesceKey: null };

    case 'load': {
      const next = projectState(action.project, state.root);
      const s = commit(state, next.root, { selectedId: null, codeDraft: next.codeDraft, codeError: next.codeError });
      // Loading always starts a new undo step, even if the tree happens to be identical.
      return s.root === state.root ? { ...s, coalesceKey: null } : s;
    }

    case 'undo': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        root: prev,
        past: state.past.slice(0, -1),
        future: [state.root, ...state.future],
        coalesceKey: null,
        codeDraft: null,
        codeError: null,
        selectedId: state.selectedId && findNode(prev, state.selectedId) ? state.selectedId : null,
      };
    }

    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        root: next,
        past: [...state.past, state.root],
        future: rest,
        coalesceKey: null,
        codeDraft: null,
        codeError: null,
        selectedId: state.selectedId && findNode(next, state.selectedId) ? state.selectedId : null,
      };
    }
  }
}

export function describe(node: UINode): string {
  const def = COMPONENTS[node.type];
  if (node.type === 'layout_columns' && !node.raw?.col_widths) {
    const n = node.children.length;
    const what = isRowsGrid(node) ? 'row' : 'column';
    return `Grid · ${n} ${what}${n === 1 ? '' : 's'}`;
  }
  if (node.type === 'rcode') {
    const first = String(node.props.code ?? '').trim().split('\n')[0];
    return `R code · ${first.length > 28 ? first.slice(0, 27) + '…' : first}`;
  }
  const id = node.props.id ? ` · ${node.props.id}` : '';
  const title =
    !node.props.id && (node.props.title || node.props.header || node.props.text)
      ? ` · ${String(node.props.title || node.props.header || node.props.text)}`
      : '';
  return `${def.label}${id}${title}`;
}

/**
 * Where a component goes when it is clicked (instead of dragged) in the palette:
 * into the selected container, after the selected component, or at the end of
 * the sidebar (inputs) / main area (everything else).
 */
export function clickAddTarget(
  root: UINode,
  selectedId: string | null,
  type: ComponentType,
): { parentId: string; index: number } | null {
  const sel = selectedId ? findNode(root, selectedId) : null;
  // A new tab goes into the tabset the selection is in, right after the current tab.
  if (type === 'nav_panel' && sel) {
    const path = pathTo(root, sel.id);
    for (let i = path.length - 1; i >= 0; i--) {
      const n = findNode(root, path[i])!;
      if (n.type !== 'navset_card_tab') continue;
      if (i === path.length - 1) return { parentId: n.id, index: n.children.length };
      return { parentId: n.id, index: n.children.findIndex((c) => c.id === path[i + 1]) + 1 };
    }
  }
  if (sel && canHold(sel.type, type)) return { parentId: sel.id, index: sel.children.length };
  if (sel) {
    const loc = findParent(root, sel.id);
    if (loc && canHold(loc.parent.type, type)) return { parentId: loc.parent.id, index: loc.index + 1 };
  }
  // Otherwise: inputs to the end of the sidebar, everything else to the end of the main area.
  const wantSidebar = COMPONENTS[type].io === 'input' && root.props.layout === 'page_sidebar';
  let fallback: UINode | null = null;
  walk(root, (n) => {
    if (!fallback && n.type === (wantSidebar ? 'sidebar' : 'main') && canHold(n.type, type)) fallback = n;
  });
  const f = fallback as UINode | null;
  return f ? { parentId: f.id, index: f.children.length } : null;
}
