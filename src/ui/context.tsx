import { createContext, useContext } from 'react';
import type { Dispatch, DragEvent } from 'react';
import { canHold } from '../model/components';
import { findNode, isDescendantOrSelf } from '../model/tree';
import type { Side } from '../model/tree';
import type { ComponentType, UINode } from '../model/types';
import type { Action, EditorState } from '../state/store';

// ---------------------------------------------------------------- editor state

export interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<Action>;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used inside <EditorContext.Provider>');
  return ctx;
}

// ---------------------------------------------------------------- drag & drop
//
// We use native HTML5 drag and drop. The payload is kept in a module variable
// because `dataTransfer.getData()` is not readable during `dragover`, and we
// need to know what is being dragged to decide where it may be dropped.

export type DragPayload =
  | { kind: 'new'; componentType: ComponentType; preset?: string }
  | { kind: 'move'; id: string; componentType: ComponentType };

let payload: DragPayload | null = null;

export function startDrag(e: DragEvent, p: DragPayload) {
  payload = p;
  e.dataTransfer.effectAllowed = p.kind === 'new' ? 'copy' : 'move';
  e.dataTransfer.setData('text/plain', p.kind === 'new' ? p.componentType : p.id);
  document.body.classList.add('is-dragging');
}

export function currentDrag(): DragPayload | null {
  return payload;
}

export function endDrag() {
  payload = null;
  document.body.classList.remove('is-dragging');
}

export function canDropInto(root: UINode, p: DragPayload, parentId: string): boolean {
  const parent = findNode(root, parentId);
  if (!parent || !canHold(parent.type, p.componentType)) return false;
  if (p.kind === 'move' && isDescendantOrSelf(root, p.id, parentId)) return false;
  return true;
}

/**
 * Where a drop will land: at `index` among `parentId`'s children, or — when
 * `beside` is set — to one side of a component (both then go into a new
 * two-column grid; parentId/index are unused).
 */
export interface DropTarget {
  parentId: string;
  index: number;
  beside?: { id: string; side: Side };
}

export interface DropContextValue {
  target: DropTarget | null;
  setTarget: (t: DropTarget | null) => void;
}

export const DropContext = createContext<DropContextValue>({ target: null, setTarget: () => {} });

export function useDrop(): DropContextValue {
  return useContext(DropContext);
}
