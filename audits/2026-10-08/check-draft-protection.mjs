import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { openDb } from '../../server/db.ts';

// Run after npm run build, using the temporary Playwright runtime from the audit.
const { chromium } = await import(pathToFileURL(path.join(os.tmpdir(), 'trutheditor-workflow-audit-runtime/node_modules/playwright-core/index.mjs')).href);
const out = path.resolve('audits/2026-10-08');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'trutheditor-draft-check-'));
const db = openDb(path.join(scratch, 'audit.db'));
const app = createApp(loadConfig({}), db);
const server = createServer((req, res) => void app.handle(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
const checks = [];
page.on('pageerror', e => errors.push(e.message));
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
const source = () => page.getByRole('textbox', { name: 'app.R source code' });
const code = () => source().inputValue();
const button = name => page.getByRole('button', { name, exact: true });
async function locked() {
  for (const name of ['New', 'Example', 'Open…', '↶ Undo', '↷ Redo']) assert.equal(await button(name).isDisabled(), true, name);
  assert.equal(await page.locator('.props input, .props select, .props textarea, .props button').evaluateAll(els => els.every(el => el.matches(':disabled'))), true);
  assert.equal(await page.locator('.palette-item').evaluateAll(els => els.every(el => el.disabled && !el.draggable)), true);
  assert.equal(await page.locator('.canvas-scroll').getAttribute('inert'), '');
  assert.equal(await source().isEditable(), true);
  for (const name of ['Save', 'Export app.R', 'Download app.R', 'Copy', 'Go to error', 'Discard edits']) assert.equal(await button(name).isEnabled(), true, name);
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('tab', { name: 'Create account', exact: true }).click();
  await page.locator('input[name="name"]').fill('Draft Protection Check');
  await page.locator('input[name="email"]').fill('draft-check@example.test');
  await page.locator('input[name="password"]').fill('Local-check-only-2026!');
  await page.locator('#submit').click();
  await button('Do not subscribe').click();
  await source().waitFor();
  const file = page.waitForEvent('filechooser');
  await button('Open…').click();
  await (await file).setFiles(path.join(out, 'representative-app.R'));
  await page.waitForFunction(() => document.querySelector('.editor-input')?.value.includes('Cars workflow audit'));
  await page.locator('#f-title').fill('Draft protection audit');
  const valid = await code();
  const invalid = valid + '\nnew_helper <- function(x) {\n  x * 2\n';
  await source().fill(invalid);
  await page.getByRole('alert').waitFor();
  await locked();
  passed('Invalid draft disables destructive controls and leaves source/recovery/download controls available');

  await page.getByRole('treeitem', { name: /Slider.*rows/ }).click();
  await page.locator('.panel-title').filter({ hasText: 'Properties' }).click();
  for (const shortcut of ['Delete', 'Backspace', 'Control+d', 'Alt+ArrowDown', 'Alt+ArrowUp', 'Control+z', 'Control+y']) {
    await page.keyboard.press(shortcut);
    assert.equal(await code(), invalid, shortcut);
  }
  assert.equal(await button('Delete').isDisabled(), true);
  assert.equal(await button('Duplicate').isDisabled(), true);
  passed('Outline inspection and all destructive keyboard shortcuts preserve unfinished function');

  for (const [name, filename] of [['Save', 'protected-draft.shinydesign.json'], ['Export app.R', 'protected-draft.R']]) {
    const event = page.waitForEvent('download');
    await button(name).click();
    const download = await event;
    const target = path.join(scratch, filename);
    await download.saveAs(target);
    const text = await fs.readFile(target, 'utf8');
    assert.equal(name === 'Save' ? JSON.parse(text).code : text, invalid);
  }
  passed('Save and export retain invalid source byte-for-byte');

  await page.waitForTimeout(400);
  await page.reload();
  await source().waitFor();
  await page.locator('#boot').waitFor({ state: 'detached' });
  await locked();
  assert.equal(await code(), invalid);
  await page.screenshot({ path: path.join(out, '07-draft-protected.png'), fullPage: true });
  passed('Autosave reload retains unfinished source and reapplies protection');

  await source().fill(invalid + '}\n');
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.locator('#f-title').isEnabled(), true);
  assert.equal(await page.locator('.canvas-scroll').getAttribute('inert'), null);
  assert.equal(await page.locator('.palette-item').first().isEnabled(), true);
  for (const name of ['New', 'Example', 'Open…']) assert.equal(await button(name).isEnabled(), true);
  await page.locator('#f-title').fill('Recovered through correction');
  assert.match(await code(), /new_helper <- function/);
  assert.match(await code(), /Recovered through correction/);
  passed('Correcting code unlocks visual editing and preserves the completed helper');

  const beforeDiscard = await code();
  await source().fill(beforeDiscard + '\n(');
  await button('Discard edits').click();
  assert.equal(await code(), beforeDiscard);
  assert.equal(await page.locator('#f-title').isEnabled(), true);
  passed('Explicit discard restores the valid design and unlocks controls');

  // Native text undo remains available even though design undo is disabled.
  await source().focus();
  await source().press('Control+End');
  await page.keyboard.insertText('\n(');
  await page.getByRole('alert').waitFor();
  await source().press('Control+z');
  assert.equal(await code(), beforeDiscard);
  assert.equal(await page.getByRole('alert').count(), 0);
  passed('Native code-editor undo can repair an invalid draft');
  assert.deepEqual(errors, []);
  passed('No uncaught browser errors');
  await fs.writeFile(path.join(out, 'draft-protection-results.json'), JSON.stringify({ pass: true, browser: browser.version(), checks, errors }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(out, 'draft-protection-results.json'), JSON.stringify({ pass: false, checks, error: String(error), errors }, null, 2));
  await page.screenshot({ path: path.join(out, 'draft-protection-failure.png'), fullPage: true });
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await app.idle();
  db.close();
}
