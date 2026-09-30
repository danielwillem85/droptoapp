import { useState } from 'react';
import { PALETTE_CATEGORIES, paletteEntries } from '../model/components';
import { clickAddTarget } from '../state/store';
import { endDrag, startDrag, useEditor } from './context';

export function Palette() {
  const { state, dispatch } = useEditor();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  return (
    <div className="palette">
      <input
        className="palette-search"
        placeholder="Search components…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {PALETTE_CATEGORIES.map((cat) => {
        const items = paletteEntries(cat).filter(
          (d) => !q || d.label.toLowerCase().includes(q) || d.key.toLowerCase().includes(q),
        );
        if (!items.length) return null;
        return (
          <section key={cat} className="palette-section">
            <h3>{cat}</h3>
            <div className="palette-grid">
              {items.map((d) => (
                <button
                  key={d.key}
                  className="palette-item"
                  draggable
                  title={`${d.description}\nDrag onto the canvas, or click to add.`}
                  data-type={d.preset ?? d.type}
                  onDragStart={(e) => startDrag(e, { kind: 'new', componentType: d.type, preset: d.preset })}
                  onDragEnd={endDrag}
                  onClick={() => {
                    const t = clickAddTarget(state.root, state.selectedId, d.type);
                    if (t) dispatch({ type: 'add', componentType: d.type, preset: d.preset, ...t });
                  }}
                >
                  <span className="glyph">{d.glyph}</span>
                  <span className="name">{d.label}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
