import { COMPONENTS, hasRoomFor, isRowsGrid, presetByKey } from '../model/components';
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
  setPageLayout,
  pathTo,
  placeBeside,
  sameTree,
  syncGrids,
  updateExtra,
  updateProps,
  updateRaw,
} from '../model/tree';
import type { Side } from '../model/tree';
import type { ComponentType, Project, Props, UINode } from '../model/types';

const HISTORY_LIMIT = 200;

/**
 * One undo step: the design and, when app.R was edited by hand, that exact text (with its
 * formatting, comments and any syntax error). Undo/redo restore both, so undoing a visual edit
 * brings back the code as you wrote it, not code regenerated from the design.
 */
export interface Snapshot {
  root: UINode;
  codeDraft: string | null;
  codeError: CodeError | null;
}

export interface EditorState {
  root: UINode;
  selectedId: string | null;
  past: Snapshot[];
  future: Snapshot[];
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
  /** Switch to another project: its own design and a fresh undo history. */
  | { type: 'replace'; state: EditorState }
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

/** The design in an editor state, as stored in the account and in the browser. */
export function stateJson(s: Pick<EditorState, 'root' | 'codeDraft'>): string {
  return JSON.stringify({ format: 'droptoapp/v1', root: s.root, ...(s.codeDraft !== null ? { code: s.codeDraft } : {}) });
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

const snapshot = (s: EditorState): Snapshot => ({ root: s.root, codeDraft: s.codeDraft, codeError: s.codeError });

/**
 * Apply a change as one undo step. A change of the design without an explicit codeDraft is a visual
 * edit: the code is then regenerated from the design. A change of only the code (e.g. a comment
 * typed in app.R) is an undo step too.
 */
function commit(state: EditorState, root: UINode, extra: Partial<EditorState> = {}, coalesceKey: string | null = null): EditorState {
  const designChanged = root !== state.root;
  const codeDraft = extra.codeDraft !== undefined ? extra.codeDraft : designChanged ? null : state.codeDraft;
  const codeError = extra.codeError !== undefined ? extra.codeError : designChanged ? null : state.codeError;
  if (!designChanged && codeDraft === state.codeDraft) return { ...state, ...extra };
  const merge = coalesceKey !== null && coalesceKey === state.coalesceKey;
  return {
    ...state,
    ...extra,
    root,
    codeDraft,
    codeError,
    past: merge ? state.past : [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
    future: [],
    coalesceKey,
  };
}

/** Go to a snapshot from the history, keeping the selection when that component still exists. */
function restore(state: EditorState, to: Snapshot, past: Snapshot[], future: Snapshot[]): EditorState {
  return {
    ...state,
    ...to,
    past,
    future,
    coalesceKey: null,
    selectedId: state.selectedId && findNode(to.root, state.selectedId) ? state.selectedId : null,
  };
}

/**
 * Give a newly added panel a title that is unique among its siblings:
 * Tab 1, Tab 2 in a tabset; Page 1, Page 2 in a page_navbar; Section 1, ... in an accordion.
 */
function numberNewPanel(root: UINode, id: string): UINode {
  const loc = findParent(root, id);
  if (!loc) return root;
  const panels = loc.parent;
  const word = panels.type === 'navbar' ? 'Page' : panels.type === 'accordion' ? 'Section' : 'Tab';
  const used = new Set(panels.children.filter((c) => c.id !== id).map((c) => String(c.props.title ?? '')));
  let n = panels.children.length;
  while (used.has(`${word} ${n}`)) n++;
  return updateProps(root, id, { title: `${word} ${n}` });
}

/** Containers whose children are panels of the given type. */
const PANEL_PARENTS: Partial<Record<ComponentType, ComponentType[]>> = {
  nav_panel: ['navset_card_tab', 'navbar'],
  accordion_panel: ['accordion'],
};

export function reducer(state: EditorState, action: Action): EditorState {
  // An invalid draft is the only copy of unfinished work. Tree mutations,
  // history navigation and loading another project must not replace it.
  // Keep inspection, source editing (including native undo), and explicit
  // discard available. Guard here as well as in the UI for keyboard/drop events.
  // 'replace' is only used after the current design was saved to the account, so nothing is lost.
  if (state.codeError && action.type !== 'select' && action.type !== 'setCode' && action.type !== 'discardCode' && action.type !== 'replace')
    return state;

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
      if (PANEL_PARENTS[node.type]) root = numberNewPanel(root, node.id);
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
      let root = updateProps(state.root, action.id, action.patch);
      // Switching to or from page_navbar moves the content between the main area and the pages.
      const layout = action.patch.layout;
      if (action.id === state.root.id && typeof layout === 'string' && layout !== state.root.props.layout) {
        root = setPageLayout(root, layout);
        const selectedId = state.selectedId && findNode(root, state.selectedId) ? state.selectedId : null;
        return commit(state, root, { selectedId });
      }
      return commit(state, root, {}, key);
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
      // An undo step of its own, so Undo brings the discarded (or reformatted) code back.
      if (state.codeDraft === null) return state;
      return commit(state, state.root, { codeDraft: null, codeError: null });

    case 'load': {
      const next = projectState(action.project, state.root);
      const s = commit(state, next.root, { selectedId: null, codeDraft: next.codeDraft, codeError: next.codeError });
      // Loading always starts a new undo step, even if the tree happens to be identical.
      return s.root === state.root ? { ...s, coalesceKey: null } : s;
    }

    case 'replace':
      return action.state;

    case 'undo': {
      if (!state.past.length) return state;
      return restore(state, state.past[state.past.length - 1], state.past.slice(0, -1), [snapshot(state), ...state.future]);
    }

    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return restore(state, next, [...state.past, snapshot(state)].slice(-HISTORY_LIMIT), rest);
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
  // A new tab (or section) goes into the tabset (or accordion) the selection is in, right after the current one.
  const parents = PANEL_PARENTS[type];
  if (parents && sel) {
    const path = pathTo(root, sel.id);
    for (let i = path.length - 1; i >= 0; i--) {
      const n = findNode(root, path[i])!;
      if (!parents.includes(n.type)) continue;
      if (i === path.length - 1) return { parentId: n.id, index: n.children.length };
      return { parentId: n.id, index: n.children.findIndex((c) => c.id === path[i + 1]) + 1 };
    }
  }
  // A new page of a page_navbar goes at the end of the navigation bar.
  const navbar = root.children.find((c) => c.type === 'navbar');
  if (type === 'nav_panel' && navbar && (!sel || sel.type === 'navbar')) return { parentId: navbar.id, index: navbar.children.length };
  if (sel && hasRoomFor(sel, type)) return { parentId: sel.id, index: sel.children.length };
  if (sel) {
    const loc = findParent(root, sel.id);
    if (loc && hasRoomFor(loc.parent, type)) return { parentId: loc.parent.id, index: loc.index + 1 };
  }
  // Otherwise: inputs to the end of the sidebar, everything else to the end of the main area
  // (with page_navbar: the first page).
  const wantSidebar = COMPONENTS[type].io === 'input' && root.props.layout === 'page_sidebar';
  const firstPage = navbar?.children.find((c) => c.type === 'nav_panel');
  const area = wantSidebar ? root.children.find((c) => c.type === 'sidebar') : (root.children.find((c) => c.type === 'main') ?? firstPage);
  if (area && hasRoomFor(area, type)) return { parentId: area.id, index: area.children.length };
  if (navbar && hasRoomFor(navbar, type)) return { parentId: navbar.id, index: navbar.children.length };
  return null;
}
