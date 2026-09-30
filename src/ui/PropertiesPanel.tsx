import type { KeyboardEvent } from 'react';
import { COMPONENTS, argSpecFor, isStructural, literalR } from '../model/components';
import { VALID_R_ID } from '../model/rcode';
import { findNode } from '../model/tree';
import type { FieldDef, PropValue, UINode } from '../model/types';
import type { Issue } from '../model/validate';
import { useEditor } from './context';

export function PropertiesPanel({ issues }: { issues: Issue[] }) {
  const { state, dispatch } = useEditor();
  const node: UINode | null = state.selectedId ? findNode(state.root, state.selectedId) : state.root;
  if (!node) return null;
  const def = COMPONENTS[node.type];
  const mine = issues.filter((i) => i.nodeId === node.id);
  const set = (key: string, value: PropValue) => dispatch({ type: 'updateProps', id: node.id, patch: { [key]: value } });

  return (
    <div className="props">
      <header className="props-header">
        <span className="glyph">{def.glyph}</span>
        <div>
          <div className="props-title">{def.label}</div>
          <div className="props-sub">{def.description}</div>
        </div>
      </header>

      {mine.map((i, k) => (
        <div key={k} className={`issue is-${i.severity}`}>
          {i.message}
        </div>
      ))}

      {def.fields.length === 0 ? (
        <p className="props-empty">
          {node.type === 'main'
            ? 'The main area holds the page content. Drop components into it on the canvas.'
            : 'This component has no properties.'}
        </p>
      ) : (
        <div className="props-fields">
          {def.fields.map((f) => {
            const raw = node.raw?.[f.key];
            if (raw !== undefined)
              return (
                <RawField
                  key={f.key}
                  label={f.label}
                  value={raw}
                  onChange={(v) => dispatch({ type: 'setRaw', id: node.id, prop: f.key, value: v })}
                  onReset={() => dispatch({ type: 'setRaw', id: node.id, prop: f.key, value: null })}
                />
              );
            const spec = argSpecFor(node.type, f.key);
            return (
              <Field
                key={f.key}
                field={f}
                value={node.props[f.key]}
                onChange={(v) => set(f.key, v)}
                onUseExpression={
                  spec
                    ? () => dispatch({ type: 'setRaw', id: node.id, prop: f.key, value: literalR(spec, node.props[f.key]) })
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      {node.type === 'page' && node.raw?.sidebar !== undefined ? (
        <div className="props-fields">
          <RawField
            label="Sidebar"
            value={node.raw.sidebar}
            onChange={(v) => dispatch({ type: 'setRaw', id: node.id, prop: 'sidebar', value: v })}
            onReset={() => dispatch({ type: 'setRaw', id: node.id, prop: 'sidebar', value: null })}
          />
        </div>
      ) : null}

      {def.rFn || node.type === 'page' ? (
        <details className="props-more" open={!!node.extra}>
          <summary>More R arguments</summary>
          <div className="field">
            <textarea
              className="code-input"
              rows={3}
              spellCheck={false}
              placeholder={node.type === 'page' ? 'e.g. fillable = FALSE' : 'e.g. width = "100%"'}
              value={node.extra ?? ''}
              onChange={(e) => dispatch({ type: 'setExtra', id: node.id, extra: e.target.value })}
            />
            <div className="field-help">
              Extra arguments for {node.type === 'page' ? String(node.props.layout) : def.rFn}(), written as R. Separate them with commas.
            </div>
          </div>
        </details>
      ) : null}

      {!isStructural(node.type) ? (
        <div className="props-actions">
          <button onClick={() => dispatch({ type: 'duplicate', id: node.id })}>Duplicate</button>
          <button className="danger" onClick={() => dispatch({ type: 'remove', id: node.id })}>
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A property whose value is an R expression instead of a fixed value. */
function RawField({ label, value, onChange, onReset }: { label: string; value: string; onChange: (v: string) => void; onReset: () => void }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>
          {label} <span className="badge">R expression</span>
        </span>
        <button className="link" onClick={onReset} title="Replace the expression with a fixed value">
          Use a fixed value
        </button>
      </div>
      <textarea className="code-input" rows={Math.min(6, value.split('\n').length + 1)} spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
  onUseExpression,
}: {
  field: FieldDef;
  value: PropValue | undefined;
  onChange: (v: PropValue) => void;
  onUseExpression?: () => void;
}) {
  const id = `f-${field.key}`;
  const label = (
    <div className="field-label">
      <label htmlFor={id}>
        {field.label}
        {field.optional ? <span className="optional">optional</span> : null}
      </label>
      {onUseExpression ? (
        <button className="link expr-toggle" onClick={onUseExpression} title="Compute this value with an R expression instead">
          R
        </button>
      ) : null}
    </div>
  );
  const help = field.help ? <div className="field-help">{field.help}</div> : null;

  switch (field.kind) {
    case 'boolean':
      return (
        <div className="field field-inline">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <label htmlFor={id}>{field.label}</label>
          {help}
        </div>
      );
    case 'select':
      return (
        <div className="field">
          {label}
          <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {help}
        </div>
      );
    case 'number':
      return (
        <div className="field">
          {label}
          <input
            id={id}
            type="number"
            value={value === undefined || value === '' ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {help}
        </div>
      );
    case 'list':
      return (
        <div className="field">
          {label}
          <textarea
            id={id}
            rows={4}
            value={Array.isArray(value) ? value.join('\n') : String(value ?? '')}
            onChange={(e) => onChange(e.target.value.split('\n'))}
          />
          {help}
        </div>
      );
    case 'code':
      return (
        <div className="field">
          {label}
          <textarea
            id={id}
            className="code-input"
            rows={7}
            spellCheck={false}
            value={String(value ?? '')}
            onKeyDown={(e) => insertTab(e, onChange)}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </div>
      );
    case 'id': {
      const v = String(value ?? '');
      const bad = !VALID_R_ID.test(v);
      return (
        <div className="field">
          {label}
          <input
            id={id}
            className={`mono${bad ? ' is-invalid' : ''}`}
            value={v}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value.replace(/\s/g, '_'))}
          />
          {help}
        </div>
      );
    }
    default:
      return (
        <div className="field">
          {label}
          <input id={id} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
          {help}
        </div>
      );
  }
}

/** Let Tab indent inside code fields instead of moving focus. */
function insertTab(e: KeyboardEvent<HTMLTextAreaElement>, onChange: (v: string) => void) {
  if (e.key !== 'Tab' || e.shiftKey) return;
  e.preventDefault();
  const el = e.currentTarget;
  const { selectionStart: s, selectionEnd: end, value } = el;
  const next = value.slice(0, s) + '  ' + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
}
