import { COMPONENTS } from '../model/components';
import type { UINode } from '../model/types';
import { describe } from '../state/store';
import { useEditor } from './context';

export function Outline() {
  const { state } = useEditor();
  return (
    <div className="outline" role="tree">
      <OutlineRow node={state.root} depth={0} />
    </div>
  );
}

function OutlineRow({ node, depth }: { node: UINode; depth: number }) {
  const { state, dispatch } = useEditor();
  const layout = state.root.props.layout;
  const unused = node.type === 'sidebar' && layout !== 'page_sidebar';
  const selected = node.type === 'page' ? state.selectedId === null : state.selectedId === node.id;
  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        className={`outline-row${selected ? ' is-selected' : ''}${unused ? ' is-unused' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => dispatch({ type: 'select', id: node.type === 'page' ? null : node.id })}
        title={unused ? 'Not used by this layout' : undefined}
      >
        <span className="glyph">{COMPONENTS[node.type].glyph}</span>
        <span className="text">{node.type === 'page' ? `Page · ${String(layout)}` : describe(node)}</span>
      </div>
      {node.children.map((c) => (
        <OutlineRow key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}
