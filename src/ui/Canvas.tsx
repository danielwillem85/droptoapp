import { useEffect, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from 'react';
import { COMPONENTS, isRowsGrid } from '../model/components';
import { parseWidths } from '../model/rcode';
import { canPlaceBeside, pathTo } from '../model/tree';
import type { Side } from '../model/tree';
import type { UINode } from '../model/types';
import { describe } from '../state/store';
import { canDropInto, currentDrag, DropContext, endDrag, startDrag, useDrop, useEditor } from './context';
import type { DropTarget } from './context';
import { LeafPreview, themeStyle } from './previews';

type Direction = 'column' | 'row';

// ------------------------------------------------------------------ helpers

function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.parentId === b.parentId &&
      a.index === b.index &&
      a.beside?.id === b.beside?.id &&
      a.beside?.side === b.beside?.side)
  );
}

/** dragover for the side of a component: drop there to put both into a new two-column grid. */
function useDragOverBeside() {
  const { state } = useEditor();
  const { target, setTarget } = useDrop();
  return (e: DragEvent, targetId: string, side: Side): boolean => {
    const p = currentDrag();
    if (!p || !canPlaceBeside(state.root, targetId, p.componentType, p.kind === 'move' ? p.id : undefined)) return false;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = p.kind === 'new' ? 'copy' : 'move';
    const t: DropTarget = { parentId: '', index: -1, beside: { id: targetId, side } };
    if (!sameTarget(target, t)) setTarget(t);
    return true;
  };
}

/** Shared dragover logic: accept the drop at (parentId, index) if the rules allow it. */
function useDragOverAt() {
  const { state } = useEditor();
  const { target, setTarget } = useDrop();
  return (e: DragEvent, parentId: string, index: number): boolean => {
    const p = currentDrag();
    if (!p || !canDropInto(state.root, p, parentId)) return false; // let an ancestor try
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = p.kind === 'new' ? 'copy' : 'move';
    const t = { parentId, index };
    if (!sameTarget(target, t)) setTarget(t);
    return true;
  };
}

// ------------------------------------------------------------------ child lists

interface ChildListProps {
  parent: UINode;
  direction?: Direction;
  grow?: boolean;
  hint?: string;
  childStyle?: (i: number) => CSSProperties | undefined;
}

function ChildList({ parent, direction = 'column', grow, hint, childStyle }: ChildListProps) {
  return (
    <div className={`child-list is-${direction}${grow ? ' is-grow' : ''}`}>
      {parent.children.map((child, i) => (
        <NodeView key={child.id} node={child} parent={parent} index={i} direction={direction} style={childStyle?.(i)} />
      ))}
      <AppendZone parent={parent} direction={direction} grow={grow} hint={hint} />
    </div>
  );
}

function AppendZone({ parent, direction, grow, hint }: { parent: UINode; direction: Direction; grow?: boolean; hint?: string }) {
  const { target } = useDrop();
  const dragOverAt = useDragOverAt();
  const index = parent.children.length;
  const empty = index === 0;
  const active = target?.parentId === parent.id && target.index === index;
  return (
    <div
      className={`append-zone is-${direction}${empty ? ' is-empty' : ''}${grow ? ' is-grow' : ''}${active ? ' is-active' : ''}`}
      onDragOver={(e) => dragOverAt(e, parent.id, index)}
    >
      {empty ? <span>{hint ?? 'Drop components here'}</span> : null}
    </div>
  );
}

// ------------------------------------------------------------------ a single node

interface NodeViewProps {
  node: UINode;
  parent: UINode;
  index: number;
  direction: Direction;
  style?: CSSProperties;
}

function NodeView({ node, parent, index, direction, style }: NodeViewProps) {
  const { state, dispatch } = useEditor();
  const { target } = useDrop();
  const dragOverAt = useDragOverAt();
  const dragOverBeside = useDragOverBeside();
  const def = COMPONENTS[node.type];
  const selected = state.selectedId === node.id;
  const before = target?.parentId === parent.id && target.index === index;
  // Left/right edge zones: in a row of columns they insert a column before/after this one;
  // in a vertical list they put the dropped component beside this one in a new 2-column grid.
  const hasEdges = node.type !== 'nav_panel' && parent.type !== 'navset_card_tab';
  const onEdge = (e: DragEvent, side: Side) => {
    if (direction === 'row') dragOverAt(e, parent.id, side === 'left' ? index : index + 1);
    else dragOverBeside(e, node.id, side);
  };
  const edgeActive = (side: Side) =>
    target?.beside?.id === node.id && target.beside.side === side ? ' is-active' : '';

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const after = direction === 'row' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    dragOverAt(e, parent.id, index + (after ? 1 : 0));
  };

  const act = (e: MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      className={[
        'nv',
        `nv-${node.type}`,
        `is-${direction}-item`,
        selected ? 'is-selected' : '',
        before ? `drop-before-${direction}` : '',
      ].join(' ')}
      style={style}
      data-node-id={node.id}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        startDrag(e, { kind: 'move', id: node.id, componentType: node.type });
      }}
      onDragOver={onDragOver}
      onClick={(e) => {
        e.stopPropagation();
        dispatch({ type: 'select', id: node.id });
      }}
    >
      <div className="nv-tag" title={def.description}>
        <span className="nv-tag-label">{describe(node)}</span>
        {selected ? (
          <span className="nv-tag-actions">
            <button title="Move up / left (Alt+↑)" onClick={(e) => act(e, () => dispatch({ type: 'nudge', id: node.id, delta: -1 }))}>
              ↑
            </button>
            <button title="Move down / right (Alt+↓)" onClick={(e) => act(e, () => dispatch({ type: 'nudge', id: node.id, delta: 1 }))}>
              ↓
            </button>
            <button title="Duplicate (Ctrl+D)" onClick={(e) => act(e, () => dispatch({ type: 'duplicate', id: node.id }))}>
              ⧉
            </button>
            <button title="Delete (Del)" onClick={(e) => act(e, () => dispatch({ type: 'remove', id: node.id }))}>
              ✕
            </button>
          </span>
        ) : null}
      </div>
      <NodeBody node={node} />
      {hasEdges ? (
        <>
          <div
            className={`edge-zone is-left is-${direction}${edgeActive('left')}`}
            data-hint={direction === 'row' ? undefined : 'New column'}
            onDragOver={(e) => onEdge(e, 'left')}
          />
          <div
            className={`edge-zone is-right is-${direction}${edgeActive('right')}`}
            data-hint={direction === 'row' ? undefined : 'New column'}
            onDragOver={(e) => onEdge(e, 'right')}
          />
        </>
      ) : null}
    </div>
  );
}

function NodeBody({ node }: { node: UINode }): ReactNode {
  const p = node.props;
  switch (node.type) {
    case 'card':
      return (
        <div className="sp-card" style={{ minHeight: String(p.height || '') || undefined }}>
          {p.header ? <div className="sp-card-header">{String(p.header)}</div> : null}
          <div className="sp-card-body">
            <ChildList parent={node} hint="Drop components into this card" />
          </div>
        </div>
      );
    case 'layout_columns': {
      if (isRowsGrid(node))
        return (
          <div className="sp-cols is-rows">
            <ChildList parent={node} hint="Drop components to add rows" />
          </div>
        );
      const widths = parseWidths(String(p.col_widths ?? ''));
      return (
        <div className="sp-cols">
          <ChildList
            parent={node}
            direction="row"
            hint="Drop components to add columns"
            childStyle={(i) =>
              widths.length
                ? { flex: `0 0 calc(${(widths[i % widths.length] / 12) * 100}% - var(--col-gap))` }
                : { flex: '1 1 0' }
            }
          />
        </div>
      );
    }
    case 'cell':
      return (
        <div className={`sp-cell${node.children.length ? '' : ' is-empty'}`}>
          <ChildList parent={node} hint="Drop here" />
        </div>
      );
    case 'navset_card_tab':
      return <NavsetView node={node} />;
    case 'nav_panel':
      return (
        <div className="sp-tab-body">
          <ChildList parent={node} hint={`Drop components into “${String(p.title)}”`} />
        </div>
      );
    default:
      return <LeafPreview node={node} />;
  }
}

// ------------------------------------------------------------------ tabsets

function NavsetView({ node }: { node: UINode }) {
  const { state, dispatch } = useEditor();
  const { target } = useDrop();
  const dragOverAt = useDragOverAt();
  const [active, setActive] = useState<string | null>(null);

  const selPath = state.selectedId ? pathTo(node, state.selectedId) : [];
  const selectedPanel = selPath.length > 1 ? selPath[1] : null;
  useEffect(() => {
    if (selectedPanel) setActive(selectedPanel);
  }, [selectedPanel]);

  const panels = node.children;
  const activeId = selectedPanel ?? (panels.some((c) => c.id === active) ? active : panels[0]?.id ?? null);
  const activeIndex = panels.findIndex((c) => c.id === activeId);

  return (
    <div className="sp-card sp-navset">
      <div className="sp-card-header sp-tabs">
        {hasText(node.props.title) ? <span className="sp-navset-title">{String(node.props.title)}</span> : null}
        {panels.map((panel, i) => (
          <div
            key={panel.id}
            className={`sp-tab${panel.id === activeId ? ' is-active' : ''}${
              target?.parentId === node.id && target.index === i ? ' drop-before-row' : ''
            }`}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              startDrag(e, { kind: 'move', id: panel.id, componentType: panel.type });
            }}
            onDragOver={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              dragOverAt(e, node.id, i + (e.clientX > r.left + r.width / 2 ? 1 : 0));
            }}
            onClick={(e) => {
              e.stopPropagation();
              setActive(panel.id);
              dispatch({ type: 'select', id: panel.id });
            }}
          >
            {panel.type === 'nav_panel' ? (
              panel.raw?.title ? <code className="sp-raw">{panel.raw.title}</code> : String(panel.props.title) || 'Tab'
            ) : (
              <code className="sp-raw">R code</code>
            )}
          </div>
        ))}
        <AppendZone parent={node} direction="row" hint="Drop a Tab panel here" />
      </div>
      {activeIndex >= 0 ? (
        <NodeView node={panels[activeIndex]} parent={node} index={activeIndex} direction="column" />
      ) : (
        <div className="sp-empty-note">No tabs yet — drag a “Tab panel” from the palette onto the tab bar.</div>
      )}
    </div>
  );
}

const hasText = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

// ------------------------------------------------------------------ regions + page

function RegionView({ node, className, style, hint }: { node: UINode; className: string; style?: CSSProperties; hint: string }) {
  const { state, dispatch } = useEditor();
  const selected = state.selectedId === node.id;
  return (
    <div
      className={`region ${className}${selected ? ' is-selected' : ''}`}
      style={style}
      data-node-id={node.id}
      onClick={(e) => {
        e.stopPropagation();
        dispatch({ type: 'select', id: node.id });
      }}
    >
      {node.type === 'sidebar' && hasText(node.props.title) ? <div className="sp-sidebar-title">{String(node.props.title)}</div> : null}
      <ChildList parent={node} grow hint={hint} />
    </div>
  );
}

export function Canvas({ width }: { width: number | null }) {
  const { state, dispatch } = useEditor();
  const [target, setTarget] = useState<DropTarget | null>(null);
  const root = state.root;
  const layout = String(root.props.layout ?? 'page_sidebar');
  const sidebar = root.children.find((c) => c.type === 'sidebar');
  const main = root.children.find((c) => c.type === 'main');

  // Always clean up, even when the drop happens outside the canvas.
  useEffect(() => {
    const clear = () => {
      setTarget(null);
      endDrag();
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const drag = currentDrag();
    if (drag && target?.beside) {
      const { id: targetId, side } = target.beside;
      if (drag.kind === 'new') dispatch({ type: 'placeBeside', targetId, side, componentType: drag.componentType, preset: drag.preset });
      else dispatch({ type: 'placeBeside', targetId, side, id: drag.id });
    } else if (drag && target) {
      if (drag.kind === 'new')
        dispatch({ type: 'add', componentType: drag.componentType, preset: drag.preset, parentId: target.parentId, index: target.index });
      else dispatch({ type: 'move', id: drag.id, parentId: target.parentId, index: target.index });
    }
    setTarget(null);
    endDrag();
  };

  // Keep the selected component in view (e.g. when it was picked in the outline).
  useEffect(() => {
    if (!state.selectedId) return;
    const el = document.querySelector(`.canvas-scroll [data-node-id="${state.selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.selectedId]);

  const sidebarWidth = Number(sidebar?.props.width) || 250;
  const right = sidebar?.props.position === 'right';

  return (
    <DropContext.Provider value={{ target, setTarget }}>
      <div className="canvas-area">
      {state.codeError ? (
        <div className="canvas-locked" role="status">
          <div className="canvas-locked-card">
            <b>app.R has a syntax error</b>
            <span>
              Line {state.codeError.line}: {state.codeError.message}. The canvas shows the last valid version and is
              read-only until the code is fixed.
            </span>
            <button onClick={() => dispatch({ type: 'discardCode' })}>Discard code edits</button>
          </div>
        </div>
      ) : null}
      <div
        className="canvas-scroll"
        onClick={() => dispatch({ type: 'select', id: null })}
        onDragOver={() => {
          // Nothing below accepted the drag: clear the indicator (no preventDefault = no drop).
          if (target) setTarget(null);
        }}
        onDrop={onDrop}
      >
        <div className="browser-frame" style={{ maxWidth: width ?? undefined }}>
          <div className="frame-bar">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            <span className="frame-tab">{root.raw?.title ?? String(root.props.title || 'Shiny')}</span>
            <span className="frame-layout">{layout}</span>
          </div>
          <div className={`sp-page sp-${layout}${root.props.theme === 'darkly' ? ' is-dark' : ''}`} style={themeStyle(String(root.props.theme ?? 'default'))}>
            {layout === 'page_sidebar' ? (
              <div className="sp-navbar">{root.raw?.title ? <code className="sp-raw">{root.raw.title}</code> : String(root.props.title ?? '')}</div>
            ) : null}
            <div className={`sp-body${right ? ' is-right' : ''}`}>
              {layout === 'page_sidebar' && sidebar ? (
                <RegionView node={sidebar} className="sp-sidebar" style={{ flexBasis: sidebarWidth, width: sidebarWidth }} hint="Drop inputs here" />
              ) : null}
              {main ? <RegionView node={main} className="sp-main" hint="Drop components here to build the main area" /> : null}
            </div>
          </div>
        </div>
      </div>
      </div>
    </DropContext.Provider>
  );
}

