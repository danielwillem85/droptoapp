/** A single property value on a component. */
export type PropValue = string | number | boolean | string[];
export type Props = Record<string, PropValue>;

/** Every component the designer knows about. */
export type ComponentType =
  // structural (locked, created by the designer itself)
  | 'page'
  | 'sidebar'
  | 'main'
  // layout
  | 'card'
  | 'layout_columns'
  | 'cell' // a plain div(): one cell of a grid, or any box that groups components
  | 'navset_card_tab'
  | 'nav_panel'
  | 'value_box'
  // inputs
  | 'sliderInput'
  | 'numericInput'
  | 'textInput'
  | 'textAreaInput'
  | 'selectInput'
  | 'radioButtons'
  | 'checkboxInput'
  | 'checkboxGroupInput'
  | 'dateInput'
  | 'actionButton'
  // outputs
  | 'plotOutput'
  | 'tableOutput'
  | 'textOutput'
  | 'verbatimTextOutput'
  // static content
  | 'heading'
  | 'paragraph'
  | 'divider'
  | 'rcode'; // any other R UI expression, kept verbatim

/** A node in the UI tree. Containers use `children`; leaves keep it empty. */
export interface UINode {
  id: string;
  type: ComponentType;
  props: Props;
  children: UINode[];
  /**
   * Properties whose value is an R expression rather than a literal,
   * keyed by prop, e.g. { choices: 'names(mtcars)' }. Emitted verbatim.
   */
  raw?: Record<string, string>;
  /** Other arguments the designer has no field for, as R source, e.g. 'width = "100%"'. */
  extra?: string;
}

export type Category = 'Layout' | 'Inputs' | 'Outputs' | 'Content';

export type FieldKind =
  | 'text'
  | 'id' // a Shiny inputId / outputId
  | 'number'
  | 'boolean'
  | 'select'
  | 'list' // one string per line
  | 'code'; // multi-line R code

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  placeholder?: string;
  help?: string;
  /** Leave the argument out of the generated code when the value is empty. */
  optional?: boolean;
}

/** The on-disk project format (what Save/Open read and write). */
export interface Project {
  /** 'truth-editor/v1' is the same format from before the rename; still accepted when opening. */
  format: 'droptoapp/v1' | 'truth-editor/v1';
  root: UINode;
  /** The app.R text as last edited by hand, if it differs from the generated code. */
  code?: string;
}
