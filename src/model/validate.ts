import { sidebarUsed } from './codegen';
import { COMPONENTS } from './components';
import { parseWidths, VALID_R_ID } from './rcode';
import { parseR } from './rparse';
import { walk } from './tree';
import type { UINode } from './types';

export interface Issue {
  nodeId: string;
  severity: 'error' | 'warning';
  message: string;
}

export function validate(root: UINode): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, string>();
  const layout = String(root.props.layout ?? 'page_sidebar');
  const usesSidebar = sidebarUsed(root);

  walk(root, (n) => {
    const def = COMPONENTS[n.type];
    // Hand-written R (expressions, other arguments, R code blocks) must at least parse.
    const snippets: [string, string][] = Object.entries(n.raw ?? {}).map(([k, v]) => [`the ${k} expression`, `f(${v})`]);
    if (n.extra?.trim()) snippets.push(['the other arguments', `f(${n.extra.trim().replace(/,\s*$/, '')})`]);
    if (n.type === 'rcode') snippets.push(['this R code', String(n.props.code ?? '')]);
    if (n.type === 'page') {
      snippets.push(['the setup code', String(n.props.setup ?? '')], ['the other server code', String(n.props.serverCode ?? '')]);
    }
    if (def.renderFn || n.type === 'actionButton') snippets.push(['the server code', `{\n${String(n.props.code ?? '')}\n}`]);
    for (const [what, code] of snippets) {
      try {
        parseR(code);
      } catch (e) {
        issues.push({ nodeId: n.id, severity: 'error', message: `${def.label}: R syntax error in ${what}: ${(e as Error).message}` });
      }
    }
    if (def.renderFn && !String(n.props.code ?? '').trim()) {
      const other = String(root.props.serverCode ?? '');
      if (!other.includes(`output$${n.props.id}`))
        issues.push({ nodeId: n.id, severity: 'warning', message: `${def.label} "${n.props.id}" has no server code, so it will stay empty.` });
    }
    if (def.io && !n.raw?.id) {
      const id = String(n.props.id ?? '');
      if (!VALID_R_ID.test(id)) {
        issues.push({
          nodeId: n.id,
          severity: 'error',
          message: `${def.label}: "${id}" is not a valid ID (start with a letter; letters, digits, _ and . only).`,
        });
      } else if (seen.has(id)) {
        issues.push({ nodeId: n.id, severity: 'error', message: `Duplicate ID "${id}". Inputs and outputs need unique IDs.` });
      } else {
        seen.set(id, n.id);
      }
    }
    if (n.type === 'sliderInput' && !n.raw) {
      const { min, max, value } = n.props;
      if (Number(min) >= Number(max)) issues.push({ nodeId: n.id, severity: 'error', message: `Slider "${n.props.id}": min must be less than max.` });
      else if (Number(value) < Number(min) || Number(value) > Number(max))
        issues.push({ nodeId: n.id, severity: 'warning', message: `Slider "${n.props.id}": value is outside min–max.` });
    }
    if (n.type === 'layout_columns') {
      const raw = String(n.props.col_widths ?? '').trim();
      const w = parseWidths(raw);
      if (raw && w.length === 0) issues.push({ nodeId: n.id, severity: 'error', message: 'Columns: widths must be numbers between 1 and 12.' });
    }
    if (n.type === 'navset_card_tab' && n.children.length === 0)
      issues.push({ nodeId: n.id, severity: 'warning', message: 'Tabset card has no tabs.' });
    if (n.type === 'accordion' && n.children.length === 0)
      issues.push({ nodeId: n.id, severity: 'warning', message: 'Accordion has no sections.' });
    if (n.type === 'navbar' && !n.children.some((c) => c.type === 'nav_panel'))
      issues.push({ nodeId: n.id, severity: 'warning', message: 'page_navbar has no pages yet: add a Tab panel to the navigation bar.' });
    if (n.type === 'tooltip' && n.children.length === 0)
      issues.push({ nodeId: n.id, severity: 'warning', message: 'Tooltip: drop the component it should explain into it.' });
    if (n.type === 'conditionalPanel' && !n.raw?.condition) {
      const cond = String(n.props.condition ?? '').trim();
      if (!cond) issues.push({ nodeId: n.id, severity: 'error', message: 'Conditional panel: the condition is empty.' });
      else if (/\binput\$/.test(cond))
        issues.push({
          nodeId: n.id,
          severity: 'warning',
          message: 'Conditional panel: the condition is JavaScript, so write input.id instead of input$id.',
        });
    }
    if (n.type === 'sidebar' && !usesSidebar && n.children.length > 0)
      issues.push({
        nodeId: n.id,
        severity: 'warning',
        message: `The sidebar is not used by ${layout}, so its ${n.children.length} component(s) are left out of the code.`,
      });
  });
  return issues;
}
