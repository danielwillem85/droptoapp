import type { Category, ComponentType, FieldDef, Props, PropValue, UINode } from './types';
import { indent, parseWidths, rCall, rNum, rNumVec, rStr, rStrVec } from './rcode';

/**
 * Everything the designer knows about one component type: palette metadata,
 * editable fields, defaults, and — through `rFn`/`formals`/`args` — how it maps
 * to an R call. The same argument specs drive both code generation
 * (codegen.ts) and parsing app.R back into a design (fromR.ts), so the two
 * directions stay consistent.
 *
 * The React previews live in src/ui/previews.tsx so this module stays pure.
 */

export type ArgKind = 'string' | 'number' | 'bool' | 'strings' | 'widths';

export interface ArgSpec {
  /** R argument name. */
  arg: string;
  /** Property key on the node. */
  prop: string;
  kind: ArgKind;
  /** Emit without the name (only for leading arguments that are always present). */
  positional?: boolean;
  /** Always emit, even when empty. */
  required?: boolean;
  /** Property value meaning "argument not given"; such values are not emitted. */
  absent?: PropValue;
  /** R code to emit when a required argument is empty. */
  fallback?: string;
}

export interface ComponentDef {
  type: ComponentType;
  label: string;
  category: Category | null; // null = structural, not in the palette
  glyph: string;
  description: string;
  /** Prefix for generated input/output ids (e.g. "slider" -> slider1). */
  idPrefix?: string;
  fields: FieldDef[];
  defaults: Props;
  /** Which child types this container accepts; undefined = not a container. */
  accepts?: (child: ComponentType) => boolean;
  /** Kind of reactive endpoint this component creates. */
  io?: 'input' | 'output';

  /** R function name, when the component is a plain call. */
  rFn?: string;
  /** The R function's formal arguments, in order ('...' included). Used to match positional args. */
  formals?: string[];
  /** Arguments that map to properties. */
  args?: ArgSpec[];
  /** Calls emitted before the children (e.g. card_header()). */
  prefixChildren?: (node: UINode) => string[];
  /** Custom emitter for components that are not a plain call. */
  toR?: (node: UINode, children: string[]) => string;
  /** For outputs: the render function used in the server. */
  renderFn?: string;
  /** Server code for this component, or null when there is none. */
  server?: (node: UINode) => string | null;
}

const STRUCTURAL: ComponentType[] = ['page', 'sidebar', 'main'];
const acceptsContent = (child: ComponentType) => !STRUCTURAL.includes(child) && child !== 'nav_panel';

const str = (p: Props, k: string): string => (p[k] === undefined || p[k] === null ? '' : String(p[k]));

export function listValue(v: PropValue | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => x.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split('\n').map((x) => x.trim()).filter(Boolean);
  return [];
}

const ID = (arg: string): ArgSpec => ({ arg, prop: 'id', kind: 'string', positional: true, required: true });
const LABEL: ArgSpec = { arg: 'label', prop: 'label', kind: 'string', positional: true, required: true };

const ID_FIELD: FieldDef = { key: 'id', label: 'ID', kind: 'id', help: 'Used as input$id / output$id in the server.' };
const LABEL_FIELD: FieldDef = { key: 'label', label: 'Label', kind: 'text' };
const CODE_FIELD = (help: string): FieldDef => ({ key: 'code', label: 'Server code', kind: 'code', help });

function renderServer(node: UINode, fn: string): string | null {
  const body = str(node.props, 'code').trim();
  if (!body) return null;
  return `output$${str(node.props, 'id')} <- ${fn}({\n${indent(body)}\n})`;
}

export const THEMES = ['default', 'flatly', 'minty', 'cosmo', 'lux', 'darkly'] as const;
export const VALUE_BOX_THEMES = ['default', 'primary', 'secondary', 'success', 'info', 'warning', 'danger'];
export const PAGE_LAYOUTS = ['page_sidebar', 'page_fillable', 'page_fluid'] as const;

const defs: ComponentDef[] = [
  // ------------------------------------------------------------------ structure
  {
    type: 'page',
    label: 'Page',
    category: null,
    glyph: '▣',
    description: 'The top-level bslib page.',
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      {
        key: 'layout',
        label: 'Layout',
        kind: 'select',
        options: [...PAGE_LAYOUTS],
        help: 'page_fillable and page_fluid have no sidebar.',
      },
      { key: 'theme', label: 'Bootswatch theme', kind: 'select', options: [...THEMES] },
      {
        key: 'setup',
        label: 'Setup code',
        kind: 'code',
        help: 'Runs once before the UI is built: extra library() calls, data loading, helper functions.',
      },
      {
        key: 'serverCode',
        label: 'Other server code',
        kind: 'code',
        help: 'Placed at the top of the server function: reactive(), observe(), and render code for outputs not on the canvas.',
      },
    ],
    defaults: { title: 'My Shiny app', layout: 'page_sidebar', theme: 'default', setup: '', serverCode: '' },
    accepts: () => false,
  },
  {
    type: 'sidebar',
    label: 'Sidebar',
    category: null,
    glyph: '◧',
    description: 'The page sidebar.',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', optional: true },
      { key: 'width', label: 'Width (px)', kind: 'number' },
      { key: 'position', label: 'Position', kind: 'select', options: ['left', 'right'] },
    ],
    defaults: { title: '', width: 250, position: 'left' },
    accepts: acceptsContent,
    rFn: 'sidebar',
    formals: ['...', 'width', 'position', 'open', 'id', 'title', 'bg', 'fg', 'class', 'max_height_mobile', 'collapsible', 'gap', 'padding', 'fillable'],
    args: [
      { arg: 'title', prop: 'title', kind: 'string', absent: '' },
      { arg: 'width', prop: 'width', kind: 'number', absent: 250 },
      { arg: 'position', prop: 'position', kind: 'string', absent: 'left' },
    ],
  },
  {
    type: 'main',
    label: 'Main area',
    category: null,
    glyph: '▢',
    description: 'The main content area of the page.',
    fields: [],
    defaults: {},
    accepts: acceptsContent,
  },

  // ------------------------------------------------------------------ layout
  {
    type: 'card',
    label: 'Card',
    category: 'Layout',
    glyph: '▭',
    description: 'A bordered box with an optional header.',
    fields: [
      { key: 'header', label: 'Header', kind: 'text', optional: true },
      { key: 'full_screen', label: 'Allow full screen', kind: 'boolean' },
      { key: 'height', label: 'Height', kind: 'text', optional: true, placeholder: 'e.g. 400px' },
    ],
    defaults: { header: 'Card title', full_screen: false, height: '' },
    accepts: acceptsContent,
    rFn: 'card',
    formals: ['...', 'full_screen', 'height', 'max_height', 'min_height', 'fill', 'class', 'wrapper', 'id'],
    args: [
      { arg: 'full_screen', prop: 'full_screen', kind: 'bool', absent: false },
      { arg: 'height', prop: 'height', kind: 'string', absent: '' },
    ],
    prefixChildren: (n) => (str(n.props, 'header').trim() ? [rCall('card_header', [rStr(str(n.props, 'header'))])] : []),
  },
  {
    type: 'layout_columns',
    label: 'Grid',
    category: null, // built from the palette with Column, Row, 2 columns and 2 rows
    glyph: '▥',
    description: 'Cells arranged as columns (side by side) or rows (stacked), on a 12-column grid.',
    fields: [
      {
        key: 'col_widths',
        label: 'Column widths',
        kind: 'text',
        optional: true,
        placeholder: 'e.g. 4, 8  (blank = equal)',
        help: 'Widths out of 12, one per child. Leave blank for equal widths. Use 12 for every child to stack them as rows.',
      },
    ],
    defaults: { col_widths: '' },
    accepts: acceptsContent,
    rFn: 'layout_columns',
    formals: ['...', 'col_widths', 'row_heights', 'fill', 'fillable', 'gap', 'class', 'height', 'min_height', 'max_height'],
    args: [{ arg: 'col_widths', prop: 'col_widths', kind: 'widths', absent: '' }],
  },
  {
    type: 'cell',
    label: 'Cell',
    category: 'Layout',
    glyph: '⬚',
    description: 'A box that holds components, e.g. one cell of a grid. In R it is a plain div().',
    fields: [],
    defaults: {},
    accepts: acceptsContent,
    rFn: 'div',
    formals: ['...'],
    args: [],
  },
  {
    type: 'navset_card_tab',
    label: 'Tabset card',
    category: 'Layout',
    glyph: '⊟',
    description: 'A card with tabs. Drop Tab panels into it.',
    fields: [{ key: 'title', label: 'Title', kind: 'text', optional: true }],
    defaults: { title: '' },
    accepts: (c) => c === 'nav_panel' || c === 'rcode',
    rFn: 'navset_card_tab',
    formals: ['...', 'id', 'selected', 'title', 'sidebar', 'header', 'footer'],
    args: [{ arg: 'title', prop: 'title', kind: 'string', absent: '' }],
  },
  {
    type: 'nav_panel',
    label: 'Tab panel',
    category: 'Layout',
    glyph: '⊓',
    description: 'One tab. Drop it on a Tabset card to add a tab, or anywhere else to start a new Tabset card.',
    fields: [{ key: 'title', label: 'Tab title', kind: 'text' }],
    defaults: { title: 'Tab' },
    accepts: acceptsContent,
    rFn: 'nav_panel',
    formals: ['title', '...', 'value', 'icon'],
    args: [{ arg: 'title', prop: 'title', kind: 'string', positional: true, required: true }],
  },
  {
    type: 'value_box',
    label: 'Value box',
    category: 'Layout',
    glyph: '▮',
    description: 'A highlighted number or KPI.',
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'value', label: 'Value', kind: 'text' },
      { key: 'theme', label: 'Theme', kind: 'select', options: VALUE_BOX_THEMES },
    ],
    defaults: { title: 'Total', value: '1,234', theme: 'primary' },
    rFn: 'value_box',
    formals: ['title', 'value', '...', 'showcase', 'showcase_layout', 'full_screen', 'theme', 'height', 'max_height', 'min_height', 'fill', 'class'],
    args: [
      { arg: 'title', prop: 'title', kind: 'string', required: true },
      { arg: 'value', prop: 'value', kind: 'string', required: true },
      { arg: 'theme', prop: 'theme', kind: 'string', absent: 'default' },
    ],
  },

  // ------------------------------------------------------------------ inputs
  {
    type: 'sliderInput',
    label: 'Slider',
    category: 'Inputs',
    glyph: '⊸',
    description: 'Pick a number from a range.',
    idPrefix: 'slider',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      { key: 'min', label: 'Min', kind: 'number' },
      { key: 'max', label: 'Max', kind: 'number' },
      { key: 'value', label: 'Value', kind: 'number' },
      { key: 'step', label: 'Step', kind: 'number', optional: true },
    ],
    defaults: { label: 'Slider', min: 0, max: 100, value: 50, step: '' },
    rFn: 'sliderInput',
    formals: ['inputId', 'label', 'min', 'max', 'value', 'step', 'round', 'ticks', 'animate', 'width', 'sep', 'pre', 'post', 'timeFormat', 'timezone', 'dragRange'],
    args: [
      ID('inputId'),
      LABEL,
      { arg: 'min', prop: 'min', kind: 'number', required: true, fallback: '0' },
      { arg: 'max', prop: 'max', kind: 'number', required: true, fallback: '100' },
      { arg: 'value', prop: 'value', kind: 'number', required: true, fallback: '50' },
      { arg: 'step', prop: 'step', kind: 'number', absent: '' },
    ],
  },
  {
    type: 'numericInput',
    label: 'Numeric input',
    category: 'Inputs',
    glyph: '#',
    description: 'Type a number.',
    idPrefix: 'num',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      { key: 'value', label: 'Value', kind: 'number' },
      { key: 'min', label: 'Min', kind: 'number', optional: true },
      { key: 'max', label: 'Max', kind: 'number', optional: true },
      { key: 'step', label: 'Step', kind: 'number', optional: true },
    ],
    defaults: { label: 'Number', value: 10, min: '', max: '', step: '' },
    rFn: 'numericInput',
    formals: ['inputId', 'label', 'value', 'min', 'max', 'step', 'width'],
    args: [
      ID('inputId'),
      LABEL,
      { arg: 'value', prop: 'value', kind: 'number', required: true, fallback: 'NA' },
      { arg: 'min', prop: 'min', kind: 'number', absent: '' },
      { arg: 'max', prop: 'max', kind: 'number', absent: '' },
      { arg: 'step', prop: 'step', kind: 'number', absent: '' },
    ],
  },
  {
    type: 'textInput',
    label: 'Text input',
    category: 'Inputs',
    glyph: 'T',
    description: 'A single line of text.',
    idPrefix: 'text',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      { key: 'value', label: 'Value', kind: 'text', optional: true },
      { key: 'placeholder', label: 'Placeholder', kind: 'text', optional: true },
    ],
    defaults: { label: 'Text', value: '', placeholder: '' },
    rFn: 'textInput',
    formals: ['inputId', 'label', 'value', 'width', 'placeholder'],
    args: [
      ID('inputId'),
      LABEL,
      { arg: 'value', prop: 'value', kind: 'string', absent: '' },
      { arg: 'placeholder', prop: 'placeholder', kind: 'string', absent: '' },
    ],
  },
  {
    type: 'textAreaInput',
    label: 'Text area',
    category: 'Inputs',
    glyph: '¶',
    description: 'Multiple lines of text.',
    idPrefix: 'textarea',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      { key: 'value', label: 'Value', kind: 'text', optional: true },
      { key: 'rows', label: 'Rows', kind: 'number', optional: true },
      { key: 'placeholder', label: 'Placeholder', kind: 'text', optional: true },
    ],
    defaults: { label: 'Notes', value: '', rows: 3, placeholder: '' },
    rFn: 'textAreaInput',
    formals: ['inputId', 'label', 'value', 'width', 'height', 'cols', 'rows', 'placeholder', 'resize'],
    args: [
      ID('inputId'),
      LABEL,
      { arg: 'value', prop: 'value', kind: 'string', absent: '' },
      { arg: 'rows', prop: 'rows', kind: 'number', absent: '' },
      { arg: 'placeholder', prop: 'placeholder', kind: 'string', absent: '' },
    ],
  },
  {
    type: 'selectInput',
    label: 'Select',
    category: 'Inputs',
    glyph: '▾',
    description: 'Choose from a drop-down list.',
    idPrefix: 'select',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      { key: 'choices', label: 'Choices (one per line)', kind: 'list' },
      { key: 'selected', label: 'Selected', kind: 'text', optional: true },
      { key: 'multiple', label: 'Allow multiple', kind: 'boolean' },
    ],
    defaults: { label: 'Choose', choices: ['A', 'B', 'C'], selected: '', multiple: false },
    rFn: 'selectInput',
    formals: ['inputId', 'label', 'choices', 'selected', 'multiple', 'selectize', 'width', 'size'],
    args: [
      ID('inputId'),
      LABEL,
      { arg: 'choices', prop: 'choices', kind: 'strings', required: true },
      { arg: 'selected', prop: 'selected', kind: 'string', absent: '' },
      { arg: 'multiple', prop: 'multiple', kind: 'bool', absent: false },
    ],
  },
  {
    type: 'radioButtons',
    label: 'Radio buttons',
    category: 'Inputs',
    glyph: '◉',
    description: 'Choose exactly one option.',
    idPrefix: 'radio',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      { key: 'choices', label: 'Choices (one per line)', kind: 'list' },
      { key: 'selected', label: 'Selected', kind: 'text', optional: true },
      { key: 'inline', label: 'Inline', kind: 'boolean' },
    ],
    defaults: { label: 'Pick one', choices: ['Option 1', 'Option 2'], selected: '', inline: false },
    rFn: 'radioButtons',
    formals: ['inputId', 'label', 'choices', 'selected', 'inline', 'width', 'choiceNames', 'choiceValues'],
    args: [
      ID('inputId'),
      LABEL,
      { arg: 'choices', prop: 'choices', kind: 'strings', required: true },
      { arg: 'selected', prop: 'selected', kind: 'string', absent: '' },
      { arg: 'inline', prop: 'inline', kind: 'bool', absent: false },
    ],
  },
  {
    type: 'checkboxInput',
    label: 'Checkbox',
    category: 'Inputs',
    glyph: '☑',
    description: 'A single TRUE/FALSE checkbox.',
    idPrefix: 'check',
    io: 'input',
    fields: [ID_FIELD, LABEL_FIELD, { key: 'value', label: 'Checked', kind: 'boolean' }],
    defaults: { label: 'Enable', value: false },
    rFn: 'checkboxInput',
    formals: ['inputId', 'label', 'value', 'width'],
    args: [ID('inputId'), LABEL, { arg: 'value', prop: 'value', kind: 'bool', absent: false }],
  },
  {
    type: 'checkboxGroupInput',
    label: 'Checkbox group',
    category: 'Inputs',
    glyph: '☷',
    description: 'Choose any number of options.',
    idPrefix: 'checkgroup',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      { key: 'choices', label: 'Choices (one per line)', kind: 'list' },
      { key: 'inline', label: 'Inline', kind: 'boolean' },
    ],
    defaults: { label: 'Select all that apply', choices: ['Red', 'Green', 'Blue'], inline: false },
    rFn: 'checkboxGroupInput',
    formals: ['inputId', 'label', 'choices', 'selected', 'inline', 'width', 'choiceNames', 'choiceValues'],
    args: [
      ID('inputId'),
      LABEL,
      { arg: 'choices', prop: 'choices', kind: 'strings', required: true },
      { arg: 'inline', prop: 'inline', kind: 'bool', absent: false },
    ],
  },
  {
    type: 'dateInput',
    label: 'Date',
    category: 'Inputs',
    glyph: '▦',
    description: 'Pick a date.',
    idPrefix: 'date',
    io: 'input',
    fields: [ID_FIELD, LABEL_FIELD, { key: 'value', label: 'Value', kind: 'text', optional: true, placeholder: 'YYYY-MM-DD' }],
    defaults: { label: 'Date', value: '' },
    rFn: 'dateInput',
    formals: ['inputId', 'label', 'value', 'min', 'max', 'format', 'startview', 'weekstart', 'language', 'width', 'autoclose', 'datesdisabled', 'daysofweekdisabled'],
    args: [ID('inputId'), LABEL, { arg: 'value', prop: 'value', kind: 'string', absent: '' }],
  },
  {
    type: 'actionButton',
    label: 'Button',
    category: 'Inputs',
    glyph: '⏺',
    description: 'A button that triggers server code.',
    idPrefix: 'button',
    io: 'input',
    fields: [
      ID_FIELD,
      LABEL_FIELD,
      {
        key: 'class',
        label: 'Style',
        kind: 'select',
        options: ['btn-default', 'btn-primary', 'btn-success', 'btn-danger', 'btn-outline-primary'],
      },
      CODE_FIELD('Runs inside observeEvent() when the button is clicked.'),
    ],
    defaults: { label: 'Go', class: 'btn-primary', code: 'showNotification("Button clicked")' },
    rFn: 'actionButton',
    formals: ['inputId', 'label', 'icon', 'width', 'disabled', '...'],
    args: [ID('inputId'), LABEL, { arg: 'class', prop: 'class', kind: 'string', absent: 'btn-default' }],
    server: (n) => {
      const body = str(n.props, 'code').trim();
      return body ? `observeEvent(input$${str(n.props, 'id')}, {\n${indent(body)}\n})` : null;
    },
  },

  // ------------------------------------------------------------------ outputs
  {
    type: 'plotOutput',
    label: 'Plot',
    category: 'Outputs',
    glyph: '◿',
    description: 'A plot drawn by renderPlot().',
    idPrefix: 'plot',
    io: 'output',
    fields: [
      ID_FIELD,
      { key: 'height', label: 'Height', kind: 'text', optional: true, placeholder: '400px' },
      CODE_FIELD('Body of renderPlot().'),
    ],
    defaults: { height: '', code: 'hist(rnorm(500), col = "#007bc2", border = "white")' },
    rFn: 'plotOutput',
    formals: ['outputId', 'width', 'height', 'click', 'dblclick', 'hover', 'brush', 'inline', 'fill'],
    args: [ID('outputId'), { arg: 'height', prop: 'height', kind: 'string', absent: '' }],
    renderFn: 'renderPlot',
  },
  {
    type: 'tableOutput',
    label: 'Table',
    category: 'Outputs',
    glyph: '▤',
    description: 'A table drawn by renderTable().',
    idPrefix: 'table',
    io: 'output',
    fields: [ID_FIELD, CODE_FIELD('Body of renderTable(). Return a data frame.')],
    defaults: { code: 'head(mtcars)' },
    rFn: 'tableOutput',
    formals: ['outputId'],
    args: [ID('outputId')],
    renderFn: 'renderTable',
  },
  {
    type: 'textOutput',
    label: 'Text output',
    category: 'Outputs',
    glyph: '≡',
    description: 'Text from renderText().',
    idPrefix: 'txt',
    io: 'output',
    fields: [ID_FIELD, CODE_FIELD('Body of renderText(). Return a string.')],
    defaults: { code: 'paste("The time is", format(Sys.time(), "%H:%M"))' },
    rFn: 'textOutput',
    formals: ['outputId', 'container', 'inline'],
    args: [ID('outputId')],
    renderFn: 'renderText',
  },
  {
    type: 'verbatimTextOutput',
    label: 'Console output',
    category: 'Outputs',
    glyph: '›_',
    description: 'Printed R output from renderPrint().',
    idPrefix: 'print',
    io: 'output',
    fields: [ID_FIELD, CODE_FIELD('Body of renderPrint().')],
    defaults: { code: 'summary(cars)' },
    rFn: 'verbatimTextOutput',
    formals: ['outputId', 'placeholder'],
    args: [ID('outputId')],
    renderFn: 'renderPrint',
  },

  // ------------------------------------------------------------------ content
  {
    type: 'heading',
    label: 'Heading',
    category: 'Content',
    glyph: 'H',
    description: 'A heading (h1–h6).',
    fields: [
      { key: 'text', label: 'Text', kind: 'text' },
      { key: 'level', label: 'Level', kind: 'select', options: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] },
    ],
    defaults: { text: 'Heading', level: 'h3' },
    toR: (n) => rCall(str(n.props, 'level') || 'h3', [rStr(str(n.props, 'text'))]),
  },
  {
    type: 'paragraph',
    label: 'Paragraph',
    category: 'Content',
    glyph: '¶',
    description: 'A paragraph of text.',
    fields: [{ key: 'text', label: 'Text', kind: 'text' }],
    defaults: { text: 'Some explanatory text.' },
    toR: (n) => rCall('p', [rStr(str(n.props, 'text'))]),
  },
  {
    type: 'divider',
    label: 'Divider',
    category: 'Content',
    glyph: '—',
    description: 'A horizontal rule.',
    fields: [],
    defaults: {},
    toR: () => 'hr()',
  },
  {
    type: 'rcode',
    label: 'R code',
    category: 'Content',
    glyph: '{}',
    description: 'Any R UI code the designer has no visual editor for. It is kept exactly as written.',
    fields: [{ key: 'code', label: 'R code', kind: 'code', help: 'A single R expression that returns UI, e.g. DT::DTOutput("tbl").' }],
    defaults: { code: 'uiOutput("dynamic")' },
    toR: (n) => str(n.props, 'code').trim() || 'NULL',
  },
];

export const COMPONENTS: Record<ComponentType, ComponentDef> = Object.fromEntries(defs.map((d) => [d.type, d])) as Record<
  ComponentType,
  ComponentDef
>;

/** Component definitions keyed by their R function name (for parsing). */
export const BY_R_FN: Record<string, ComponentDef> = Object.fromEntries(
  defs.filter((d) => d.rFn && d.type !== 'sidebar').map((d) => [d.rFn!, d]),
);

export const PALETTE_CATEGORIES: Category[] = ['Layout', 'Inputs', 'Outputs', 'Content'];

export function paletteItems(category: Category): ComponentDef[] {
  return defs.filter((d) => d.category === category);
}

export type Axis = 'column' | 'row';

/** A ready-made arrangement of components, offered in the palette next to the components. */
export interface Preset {
  key: string;
  label: string;
  glyph: string;
  description: string;
  category: Category;
  /** Type of the top-level node the preset creates. */
  type: ComponentType;
  props: Props;
  /** Number of empty cells created inside it. */
  cells: number;
  /**
   * Column / Row: adds a single cell along this axis. On a grid it becomes the
   * next column/row; elsewhere it starts a new grid (see addCell in tree.ts).
   */
  adds?: Axis;
  /** Palette position: shown right after this component. */
  after: ComponentType;
}

export const PRESETS: Preset[] = [
  {
    key: 'column',
    label: 'Column',
    glyph: '▯',
    description:
      'Adds one column. Drop it on a grid to add the next column, in a row to split that row into columns, or anywhere else to start a new grid.',
    category: 'Layout',
    type: 'cell',
    props: {},
    cells: 0,
    adds: 'column',
    after: 'card',
  },
  {
    key: 'row',
    label: 'Row',
    glyph: '▬',
    description:
      'Adds one row. Drop it on a grid of rows to add the next row, in a column to split that column into rows, or anywhere else to start a new grid.',
    category: 'Layout',
    type: 'cell',
    props: {},
    cells: 0,
    adds: 'row',
    after: 'card',
  },
  {
    key: 'grid_2cols',
    label: '2 columns',
    glyph: '◫',
    description: 'A grid of two cells side by side. Drop anything into a cell, including another grid.',
    category: 'Layout',
    type: 'layout_columns',
    props: { col_widths: '6, 6' },
    cells: 2,
    after: 'card',
  },
  {
    key: 'grid_2rows',
    label: '2 rows',
    glyph: '⊟',
    description: 'A grid of two cells stacked as rows. Drop anything into a cell, including another grid.',
    category: 'Layout',
    type: 'layout_columns',
    props: { col_widths: '12, 12' },
    cells: 2,
    after: 'card',
  },
];

export function presetByKey(key: string | undefined): Preset | undefined {
  return key ? PRESETS.find((p) => p.key === key) : undefined;
}

export interface PaletteEntry {
  key: string;
  label: string;
  glyph: string;
  description: string;
  type: ComponentType;
  preset?: string;
}

/** What the palette shows for a category: components, with presets right after the component they follow. */
export function paletteEntries(category: Category): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const d of paletteItems(category)) {
    out.push({ key: d.type, label: d.label, glyph: d.glyph, description: d.description, type: d.type });
    for (const p of PRESETS.filter((x) => x.category === category && x.after === d.type))
      out.push({ key: p.key, label: p.label, glyph: p.glyph, description: p.description, type: p.type, preset: p.key });
  }
  return out;
}

/** A layout_columns whose widths are all 12 stacks its children as rows. */
export function isRowsGrid(node: UINode): boolean {
  if (node.type !== 'layout_columns' || node.raw?.col_widths) return false;
  const w = parseWidths(String(node.props.col_widths ?? ''));
  return w.length > 0 && w.every((x) => x === 12);
}

/**
 * Keep a uniform grid's widths in step with its number of children, so that
 * adding a cell to "6, 6" gives "4, 4, 4" and adding a row to "12, 12" gives
 * "12, 12, 12". Custom widths such as "4, 8" are left alone.
 */
export function syncedWidths(node: UINode): string | null {
  if (node.type !== 'layout_columns' || node.raw?.col_widths) return null;
  const w = parseWidths(String(node.props.col_widths ?? ''));
  const n = node.children.length;
  if (!w.length || !n) return null;
  let next: string;
  if (w.every((x) => x === 12)) next = Array(n).fill(12).join(', ');
  else if (w.every((x) => x === w[0]) && w[0] * w.length === 12) next = 12 % n === 0 ? Array(n).fill(12 / n).join(', ') : '';
  else return null;
  return next === String(node.props.col_widths) ? null : next;
}

export function isContainer(type: ComponentType): boolean {
  return COMPONENTS[type].accepts !== undefined;
}

export function canAccept(parent: ComponentType, child: ComponentType): boolean {
  const acc = COMPONENTS[parent].accepts;
  return acc ? acc(child) : false;
}

/**
 * Some components only work inside a particular parent (a Tab panel needs a
 * Tabset card). When one is dropped somewhere else, that parent is created
 * around it. Returns the wrapper type, or null when no wrapper is needed/possible.
 */
export function wrapperFor(parent: ComponentType, child: ComponentType): ComponentType | null {
  if (child === 'nav_panel' && !canAccept(parent, 'nav_panel') && canAccept(parent, 'navset_card_tab')) return 'navset_card_tab';
  return null;
}

/** Can `child` be placed in `parent`, directly or inside an automatic wrapper? */
export function canHold(parent: ComponentType, child: ComponentType): boolean {
  return canAccept(parent, child) || wrapperFor(parent, child) !== null;
}

export function isStructural(type: ComponentType): boolean {
  return STRUCTURAL.includes(type);
}

export function argSpecFor(type: ComponentType, prop: string): ArgSpec | undefined {
  return COMPONENTS[type].args?.find((a) => a.prop === prop);
}

// ------------------------------------------------------------------ emitting R

function isAbsent(spec: ArgSpec, v: PropValue | undefined): boolean {
  if (v === undefined || v === '' || (Array.isArray(v) && listValue(v).length === 0)) return true;
  if (spec.kind === 'widths') return parseWidths(String(v)).length === 0;
  if (spec.absent !== undefined) return spec.kind === 'number' ? Number(v) === Number(spec.absent) : v === spec.absent;
  return false;
}

function literal(spec: ArgSpec, v: PropValue | undefined): string | undefined {
  switch (spec.kind) {
    case 'string':
      return v === undefined ? undefined : rStr(String(v));
    case 'number':
      return rNum(v);
    case 'bool':
      return v === true ? 'TRUE' : 'FALSE';
    case 'strings': {
      const items = listValue(v);
      return items.length ? rStrVec(items) : 'character(0)';
    }
    case 'widths': {
      const w = parseWidths(String(v ?? ''));
      return w.length ? rNumVec(w) : undefined;
    }
  }
}

/** R source for a property value, e.g. to start an expression from the current value. */
export function literalR(spec: ArgSpec, v: PropValue | undefined): string {
  return literal(spec, v) ?? spec.fallback ?? (spec.kind === 'string' ? '""' : 'NULL');
}

/** The arguments of a component's R call (without children). */
export function emitArgs(node: UINode): string[] {
  const def = COMPONENTS[node.type];
  const out: string[] = [];
  for (const spec of def.args ?? []) {
    const raw = node.raw?.[spec.prop];
    let code: string | undefined;
    if (raw !== undefined && raw.trim()) code = raw.trim();
    else {
      const v = node.props[spec.prop];
      if (!spec.required && isAbsent(spec, v)) continue;
      code = literal(spec, v) ?? spec.fallback ?? (spec.kind === 'string' ? '""' : 'NULL');
    }
    out.push(spec.positional ? code : `${spec.arg} = ${code}`);
  }
  const extra = node.extra?.trim().replace(/,\s*$/, '');
  if (extra) out.push(extra);
  return out;
}

/** Full R expression for a (non-structural) component. */
export function nodeToR(node: UINode, children: string[]): string {
  const def = COMPONENTS[node.type];
  if (def.toR) return def.toR(node, children);
  return rCall(def.rFn!, [...emitArgs(node), ...(def.prefixChildren?.(node) ?? []), ...children]);
}

/** Server code for a component, if any. */
export function serverCode(node: UINode): string | null {
  const def = COMPONENTS[node.type];
  if (def.server) return def.server(node);
  if (def.renderFn) return renderServer(node, def.renderFn);
  return null;
}
