import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateApp } from '../src/model/codegen';
import { importApp } from '../src/model/fromR';
import { TEMPLATES, templateBySlug, templateFunctions, templateProject } from '../src/model/gallery';
import { packagesUsed } from '../src/model/shinylive';
import { starterProject } from '../src/model/templates';
import { walk } from '../src/model/tree';
import { validate } from '../src/model/validate';

test('every template is exactly the code the editor generates for it', () => {
  for (const t of TEMPLATES) {
    const root = importApp(t.code).root;
    assert.equal(generateApp(root).app, t.code, `${t.slug}: paste the generated app.R back into gallery.ts`);
    assert.deepEqual(validate(root), [], t.slug);
    assert.equal(generateApp(templateProject(t).root).app, t.code);
  }
});

test('templates are fully visual: no R code blocks on the canvas', () => {
  for (const t of TEMPLATES) {
    walk(importApp(t.code).root, (n) => assert.notEqual(n.type, 'rcode', `${t.slug} has an R code block`));
  }
});

test('templates only use packages that run in the browser (Run) and on any Shiny server', () => {
  for (const t of TEMPLATES) for (const p of packagesUsed(t.code)) assert.ok(['shiny', 'bslib', 'DT', 'plotly'].includes(p), `${t.slug}: ${p}`);
});

test('template pages have what search engines need', () => {
  const slugs = new Set<string>();
  for (const t of TEMPLATES) {
    assert.match(t.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!slugs.has(t.slug), `duplicate ${t.slug}`);
    slugs.add(t.slug);
    assert.ok(t.summary.length >= 80 && t.summary.length <= 160, `${t.slug}: summary is ${t.summary.length} characters`);
    assert.ok(t.intro.length >= 2 && t.highlights.length >= 3, t.slug);
    assert.ok(templateFunctions(t).length >= 4, t.slug);
    for (const ext of ['webp', 'png'])
      assert.ok(existsSync(resolve(import.meta.dirname, `../server/public/templates/${t.slug}.${ext}`)), `${t.slug}.${ext} screenshot`);
  }
  assert.equal(templateBySlug('kpi-dashboard')?.title, 'KPI dashboard');
  assert.equal(templateBySlug('nope'), undefined);
  // The Old Faithful template is the editor's starter design
  assert.equal(templateBySlug('old-faithful')!.code, generateApp(starterProject().root).app);
});
