import { newNodeId } from './tree';
import type { Project, UINode } from './types';

const node = (type: UINode['type'], props: UINode['props'] = {}, children: UINode[] = []): UINode => ({
  id: newNodeId(),
  type,
  props,
  children,
});

export function emptyProject(): Project {
  return {
    format: 'truth-editor/v1',
    root: node('page', { title: 'My Shiny app', layout: 'page_sidebar', theme: 'default', setup: '', serverCode: '' }, [
      node('sidebar', { title: '', width: 250, position: 'left' }),
      node('main'),
    ]),
  };
}

/** The classic "Old Faithful" example, so a new user sees something working right away. */
export function starterProject(): Project {
  return {
    format: 'truth-editor/v1',
    root: node('page', { title: 'Old Faithful Geyser Data', layout: 'page_sidebar', theme: 'default', setup: '', serverCode: '' }, [
      node('sidebar', { title: 'Controls', width: 250, position: 'left' }, [
        node('sliderInput', { id: 'bins', label: 'Number of bins:', min: 1, max: 50, value: 30, step: '' }),
        node('selectInput', {
          id: 'var',
          label: 'Variable',
          choices: ['waiting', 'eruptions'],
          selected: 'waiting',
          multiple: false,
        }),
      ]),
      node('main', {}, [
        node('layout_columns', { col_widths: '' }, [
          node('value_box', { title: 'Eruptions recorded', value: '272', theme: 'primary' }),
          node('value_box', { title: 'Mean waiting time', value: '70.9 min', theme: 'success' }),
        ]),
        node('card', { header: 'Histogram', full_screen: true, height: '' }, [
          node('plotOutput', {
            id: 'distPlot',
            height: '',
            code: [
              'x <- faithful[[input$var]]',
              'bins <- seq(min(x), max(x), length.out = input$bins + 1)',
              'hist(x, breaks = bins, col = "#007bc2", border = "white",',
              '     xlab = input$var, main = NULL)',
            ].join('\n'),
          }),
        ]),
      ]),
    ]),
  };
}

export function isProject(x: unknown): x is Project {
  if (!x || typeof x !== 'object') return false;
  const p = x as Project;
  return (
    p.format === 'truth-editor/v1' &&
    !!p.root &&
    p.root.type === 'page' &&
    Array.isArray(p.root.children) &&
    (p.code === undefined || typeof p.code === 'string')
  );
}
