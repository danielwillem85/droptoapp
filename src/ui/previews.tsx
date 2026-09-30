import type { CSSProperties, ReactNode } from 'react';
import type { Props, UINode } from '../model/types';

/**
 * Static look-alikes of the Shiny/bslib widgets. They are plain divs, not real
 * form controls, so clicking one selects the component instead of using it.
 */

const str = (p: Props, k: string) => (p[k] === undefined || p[k] === null ? '' : String(p[k]));
const list = (p: Props, k: string): string[] => {
  const v = p[k];
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  return arr.map((x) => x.trim()).filter(Boolean);
};

export interface ThemeTokens {
  primary: string;
  bg: string;
  fg: string;
  muted: string;
  border: string;
  sidebarBg: string;
  font: string;
}

const base: ThemeTokens = {
  primary: '#007bc2',
  bg: '#ffffff',
  fg: '#1d1f21',
  muted: '#6c757d',
  border: '#dee2e6',
  sidebarBg: '#f7f7f7',
  font: '"Open Sans", "Segoe UI", system-ui, sans-serif',
};

export const THEME_TOKENS: Record<string, ThemeTokens> = {
  default: base,
  flatly: { ...base, primary: '#2c3e50', font: 'Lato, "Segoe UI", system-ui, sans-serif' },
  minty: { ...base, primary: '#78c2ad', font: 'Montserrat, "Segoe UI", system-ui, sans-serif' },
  cosmo: { ...base, primary: '#2780e3', font: '"Source Sans Pro", "Segoe UI", system-ui, sans-serif' },
  lux: { ...base, primary: '#1a1a1a', font: 'Nunito Sans, "Segoe UI", system-ui, sans-serif' },
  darkly: {
    ...base,
    primary: '#375a7f',
    bg: '#222222',
    fg: '#ffffff',
    muted: '#adb5bd',
    border: '#444444',
    sidebarBg: '#2b2b2b',
  },
};

export function themeStyle(theme: string): CSSProperties {
  const t = THEME_TOKENS[theme] ?? base;
  return {
    '--sp-primary': t.primary,
    '--sp-bg': t.bg,
    '--sp-fg': t.fg,
    '--sp-muted': t.muted,
    '--sp-border': t.border,
    '--sp-sidebar-bg': t.sidebarBg,
    '--sp-font': t.font,
  } as CSSProperties;
}

const VB_COLORS: Record<string, string> = {
  primary: 'var(--sp-primary)',
  secondary: '#6c757d',
  success: '#198754',
  info: '#0dcaf0',
  warning: '#ffc107',
  danger: '#dc3545',
};

function Label({ text }: { text: ReactNode }) {
  return text ? <label className="sp-label">{text}</label> : null;
}

/** A property's text, or its R expression when it is not a plain value. */
function val(node: UINode, key: string): ReactNode {
  const raw = node.raw?.[key];
  return raw ? <code className="sp-raw">{raw}</code> : str(node.props, key);
}

function Tag({ fn, id }: { fn: string; id: string }) {
  return (
    <span className="sp-output-tag">
      {fn}
      <b>{id}</b>
    </span>
  );
}

function PlotPlaceholder({ height }: { height: string }) {
  const bars = [18, 34, 55, 80, 96, 88, 70, 52, 60, 74, 58, 36, 20, 10];
  return (
    <svg className="sp-plot-svg" viewBox="0 0 280 100" preserveAspectRatio="none" style={{ height }} aria-hidden>
      <line x1="12" y1="94" x2="276" y2="94" className="axis" />
      <line x1="12" y1="6" x2="12" y2="94" className="axis" />
      {bars.map((h, i) => (
        <rect key={i} x={16 + i * 18.5} y={94 - h * 0.86} width={16} height={h * 0.86} className="bar" />
      ))}
    </svg>
  );
}

export function LeafPreview({ node }: { node: UINode }): ReactNode {
  const p = node.props;
  const label = <Label text={val(node, 'label')} />;
  switch (node.type) {
    case 'sliderInput': {
      const min = Number(p.min);
      const max = Number(p.max);
      const val = Number(p.value);
      const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
      return (
        <div className="sp-form-group">
          {label}
          <div className="sp-slider">
            <div className="sp-slider-bubble" style={{ left: `${pct}%` }}>
              {Number.isFinite(val) ? val : ''}
            </div>
            <div className="sp-slider-track">
              <div className="sp-slider-fill" style={{ width: `${pct}%` }} />
              <div className="sp-slider-handle" style={{ left: `${pct}%` }} />
            </div>
            <div className="sp-slider-ends">
              <span>{str(p, 'min')}</span>
              <span>{str(p, 'max')}</span>
            </div>
          </div>
        </div>
      );
    }
    case 'numericInput':
      return (
        <div className="sp-form-group">
          {label}
          <div className="sp-input sp-input-number">
            <span>{str(p, 'value')}</span>
            <span className="sp-spinner">⇕</span>
          </div>
        </div>
      );
    case 'textInput':
    case 'dateInput': {
      const value = str(p, 'value');
      const placeholder = node.type === 'dateInput' ? new Date().toISOString().slice(0, 10) : str(p, 'placeholder');
      return (
        <div className="sp-form-group">
          {label}
          <div className={`sp-input${value ? '' : ' is-placeholder'}`}>{value || placeholder || ' '}</div>
        </div>
      );
    }
    case 'textAreaInput': {
      const rows = Number(p.rows) || 3;
      const value = str(p, 'value');
      return (
        <div className="sp-form-group">
          {label}
          <div className={`sp-input sp-textarea${value ? '' : ' is-placeholder'}`} style={{ minHeight: `${rows * 1.5 + 0.75}em` }}>
            {value || str(p, 'placeholder') || ' '}
          </div>
        </div>
      );
    }
    case 'selectInput': {
      const choices = node.raw?.choices ? [`‹${node.raw.choices}›`] : list(p, 'choices');
      const selected = str(p, 'selected') || choices[0] || '';
      return (
        <div className="sp-form-group">
          {label}
          <div className="sp-input sp-select">
            {p.multiple === true ? (
              <span className="sp-chips">
                {selected ? <span className="sp-chip">{selected}</span> : null}
              </span>
            ) : (
              <span>{selected || ' '}</span>
            )}
            <span className="sp-caret">▾</span>
          </div>
        </div>
      );
    }
    case 'radioButtons':
    case 'checkboxGroupInput': {
      const choices = node.raw?.choices ? [`‹${node.raw.choices}›`] : list(p, 'choices');
      const radio = node.type === 'radioButtons';
      const selected = str(p, 'selected') || (radio ? choices[0] : '');
      return (
        <div className="sp-form-group">
          {label}
          <div className={`sp-options${p.inline === true ? ' is-inline' : ''}`}>
            {choices.map((c) => (
              <span key={c} className="sp-option">
                <span className={`${radio ? 'sp-radio' : 'sp-check'}${c === selected ? ' is-on' : ''}`} />
                {c}
              </span>
            ))}
          </div>
        </div>
      );
    }
    case 'checkboxInput':
      return (
        <div className="sp-form-group">
          <span className="sp-option">
            <span className={`sp-check${p.value === true ? ' is-on' : ''}`} />
            {val(node, 'label')}
          </span>
        </div>
      );
    case 'actionButton': {
      const cls = str(p, 'class') || 'btn-default';
      return (
        <div className="sp-form-group">
          <span className={`sp-btn ${cls}`}>{node.raw?.label ? val(node, 'label') : str(p, 'label') || 'Button'}</span>
        </div>
      );
    }
    case 'plotOutput':
      return (
        <div className="sp-output sp-plot">
          <PlotPlaceholder height={str(p, 'height') || '400px'} />
          <Tag fn="plotOutput" id={str(p, 'id')} />
        </div>
      );
    case 'tableOutput':
      return (
        <div className="sp-output">
          <table className="sp-table">
            <thead>
              <tr>
                <th>col 1</th>
                <th>col 2</th>
                <th>col 3</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((r) => (
                <tr key={r}>
                  {[0, 1, 2].map((c) => (
                    <td key={c}>
                      <span className="sp-bar" style={{ width: `${40 + ((r * 7 + c * 13) % 45)}%` }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Tag fn="tableOutput" id={str(p, 'id')} />
        </div>
      );
    case 'textOutput':
      return (
        <div className="sp-output sp-text-output">
          <Tag fn="textOutput" id={str(p, 'id')} />
        </div>
      );
    case 'verbatimTextOutput':
      return (
        <pre className="sp-pre">
          <Tag fn="verbatimTextOutput" id={str(p, 'id')} />
        </pre>
      );
    case 'value_box':
      return (
        <div
          className="sp-value-box"
          style={{
            background: VB_COLORS[str(p, 'theme')] ?? VB_COLORS.primary,
            color: ['warning', 'info'].includes(str(p, 'theme')) ? '#1d1f21' : '#fff',
          }}
        >
          <div className="sp-vb-title">{val(node, 'title')}</div>
          <div className="sp-vb-value">{val(node, 'value')}</div>
        </div>
      );
    case 'heading': {
      const level = /^h[1-6]$/.test(str(p, 'level')) ? str(p, 'level') : 'h3';
      const H = level as 'h1';
      return <H className="sp-heading">{str(p, 'text')}</H>;
    }
    case 'paragraph':
      return <p className="sp-p">{str(p, 'text')}</p>;
    case 'divider':
      return <hr className="sp-hr" />;
    case 'rcode':
      return (
        <div className="sp-rcode">
          <span className="sp-rcode-tag">R code</span>
          <pre>{str(p, 'code')}</pre>
        </div>
      );
    default:
      return null;
  }
}
