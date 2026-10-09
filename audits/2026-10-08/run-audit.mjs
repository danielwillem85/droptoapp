import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { openDb } from '../../server/db.ts';

// Run with: node --import tsx audits/2026-10-08/run-audit.mjs
// Install playwright-core in %TEMP%/trutheditor-workflow-audit-runtime first.
const { chromium } = await import(pathToFileURL(path.join(os.tmpdir(), 'trutheditor-workflow-audit-runtime/node_modules/playwright-core/index.mjs')).href);
const out = path.resolve('audits/2026-10-08');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'trutheditor-audit-'));
const cfg = loadConfig({ DATABASE_PATH: path.join(scratch, 'audit.db') });
const db = openDb(cfg.databasePath);
const app = createApp(cfg, db);
const server = createServer((req, res) => void app.handle(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const results = [];
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const check = (name, pass, detail = {}) => { const r = { name, pass: !!pass, ...detail }; results.push(r); console.log(JSON.stringify(r)); };
const source = () => page.getByRole('textbox', { name: 'app.R source code' });
const readCode = () => source().inputValue();
const open = async file => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open…', exact: true }).click();
  await (await chooser).setFiles(file);
};
const download = async (button, filename) => {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const d = await event;
  await d.saveAs(path.join(out, filename));
  return d.suggestedFilename();
};
const settle = () => page.waitForTimeout(450);
let rProcess;
try {
  await page.goto(url);
  await page.getByRole('tab', { name: 'Create account', exact: true }).click();
  await page.locator('input[name="name"]').fill('Workflow Audit');
  await page.locator('input[name="email"]').fill('workflow-audit@example.test');
  await page.locator('input[name="password"]').fill('Local-audit-only-2026!');
  await page.locator('#submit').click();
  await page.getByRole('button', { name: 'Do not subscribe', exact: true }).click();
  await source().waitFor();
  check('Register and enter production editor', true);

  const original = await fs.readFile(path.join(out, 'representative-app.R'), 'utf8');
  await open(path.join(out, 'representative-app.R'));
  await page.waitForFunction(() => document.querySelector('.editor-input')?.value.includes('Cars workflow audit'));
  check('Import existing app.R byte-for-byte', await readCode() === original);
  check('Imported document validates', (await page.locator('.statusbar').innerText()).includes('No problems'));
  await page.screenshot({ path: path.join(out, '01-import.png'), fullPage: true });

  await page.locator('#f-title').fill('Cars workflow audit — edited');
  const visual = await readCode();
  const preserved = ['choices = names(cars)', 'ticks = FALSE', 'selected <- reactive', 'updateSliderInput(session, "rows", value = 10)', 'tags$small(', 'café', '✓', '# Keep this setup comment'];
  check('Visual edit preserves custom R, setup, server behavior and Unicode', preserved.every(x => visual.includes(x)), { missing: preserved.filter(x => !visual.includes(x)) });
  check('UI comments survive visual regeneration', visual.includes('# Keep this UI comment'), { documentedLimitation: true });
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click();
  const undone = await readCode();
  check('Undo visual edit restores original handwritten source', undone === original, { originalUICommentRestored: undone.includes('# Keep this UI comment') });
  await fs.writeFile(path.join(out, 'after-undo.R'), undone);
  await page.getByRole('button', { name: '↷ Redo', exact: true }).click();
  check('Redo restores visual edit', await readCode() === visual);

  await page.getByRole('treeitem', { name: /Slider.*rows/ }).click();
  await page.locator('#f-value').fill('12');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const duplicateId = await page.locator('#f-id').inputValue();
  check('Duplicate generates unique input ID', duplicateId !== 'rows' && (await readCode()).includes(`"${duplicateId}"`), { duplicateId });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click();
  check('Undo deletion restores duplicate', (await readCode()).includes(`"${duplicateId}"`));
  await page.getByRole('button', { name: '↷ Redo', exact: true }).click();
  const edited = await readCode();
  const filename = await download('Save', 'saved-design.shinydesign.json');
  const saved = JSON.parse(await fs.readFile(path.join(out, 'saved-design.shinydesign.json'), 'utf8'));
  check('Save downloads a valid design', saved.format === 'droptoapp/v1', { filename });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await open(path.join(out, 'saved-design.shinydesign.json'));
  await page.waitForFunction(() => document.querySelector('.editor-input')?.value.includes('Cars workflow audit'));
  check('Reopen saved design preserves edited app', await readCode() === edited);
  await settle();
  await page.reload();
  await source().waitFor();
  check('Reload restores autosaved design', await readCode() === edited);

  const hand = edited + '\n# Audit: retain this handwritten source note.\n';
  await source().fill(hand);
  await download('Save', 'handwritten-design.shinydesign.json');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await open(path.join(out, 'handwritten-design.shinydesign.json'));
  await page.waitForFunction(() => document.querySelector('.editor-input')?.value.includes('# Audit: retain'));
  check('Save/reopen preserves handwritten source exactly', await readCode() === hand);

  const invalidDraft = hand + '\n# Work in progress: new helper\nnew_helper <- function(x) {\n  x * 2\n';
  await source().fill(invalidDraft);
  await page.getByRole('alert').waitFor();
  check('Syntax error has line/column and canvas pause banner', (await page.getByRole('alert').innerText()).includes('column') && (await page.locator('.canvas-locked').innerText()).includes('read-only'));
  await page.getByRole('button', { name: 'Go to error', exact: true }).click();
  check('Go to error focuses source editor', await source().evaluate(el => document.activeElement === el));
  await source().fill(hand);
  check('Correcting syntax restores valid editing state', await page.getByRole('alert').count() === 0 && await readCode() === hand);
  await source().fill(invalidDraft);
  await download('Save', 'invalid-draft.shinydesign.json');
  await settle();
  await page.reload();
  await source().waitFor();
  check('Autosave recovers invalid draft and error banner', await readCode() === invalidDraft && await page.getByRole('alert').count() === 1);
  await page.locator('#boot').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(out, '02-invalid-draft.png'), fullPage: true });
  await page.locator('#f-title').fill('Edited while invalid');
  check('Properties cannot silently discard invalid draft', (await readCode()).includes('new_helper <- function(x)'), { errorBannerRemaining: await page.getByRole('alert').count() });
  await page.screenshot({ path: path.join(out, '03-after-property-edit.png'), fullPage: true });
  await open(path.join(out, 'handwritten-design.shinydesign.json'));
  await page.waitForFunction(() => document.querySelector('.editor-input')?.value.includes('# Audit: retain'));
  await download('Export app.R', 'exported-app.R');
  const exported = await fs.readFile(path.join(out, 'exported-app.R'), 'utf8');
  check('Export preserves displayed source exactly', exported === hand);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await open(path.join(out, 'exported-app.R'));
  await page.waitForFunction(() => document.querySelector('.editor-input')?.value.includes('# Audit: retain'));
  check('Reimport exported app.R preserves source', await readCode() === exported);
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.screenshot({ path: path.join(out, '04-phone-preview.png'), fullPage: true });
  const phoneBounds = await page.evaluate(() => ({
    frameRight: document.querySelector('.browser-frame').getBoundingClientRect().right,
    valueBoxRight: document.querySelector('.nv-value_box').getBoundingClientRect().right,
  }));
  check('Expression value box stays within phone preview', phoneBounds.valueBoxRight <= phoneBounds.frameRight, phoneBounds);

  // Reload immediately after an edit to probe the 300 ms debounce window.
  await settle();
  await page.locator('#f-title').fill('Immediate reload marker');
  await page.reload();
  await source().waitFor();
  check('Immediate reload preserves last edit', (await readCode()).includes('Immediate reload marker'));

  // Storage failure injected only in a separate disposable context.
  const failedContext = await browser.newContext({ storageState: await context.storageState() });
  await failedContext.addInitScript(() => { Storage.prototype.setItem = function() { throw new DOMException('Audit quota simulation', 'QuotaExceededError'); }; });
  const failedPage = await failedContext.newPage();
  await failedPage.goto(url);
  await failedPage.locator('#f-title').fill('Storage failure marker');
  await failedPage.waitForTimeout(500);
  const failedText = await failedPage.locator('body').innerText();
  check('Autosave storage failure is surfaced to user', /save failed|storage.*(full|unavailable)|unable to save|could not save/i.test(failedText));
  await failedPage.screenshot({ path: path.join(out, '05-storage-failure.png'), fullPage: true });
  await failedContext.close();

  // Validate and run the actual exported app with the installed R runtime.
  const rFile = path.join(out, 'exported-app.R').replaceAll('\\', '/');
  const parsed = spawnSync('C:/R/R-4.6.0/bin/Rscript.exe', ['-e', `parse(file=${JSON.stringify(rFile)}); cat("AUDIT_PARSE_OK\\n")`], { encoding: 'utf8', windowsHide: true });
  await fs.writeFile(path.join(out, 'r-parse.log'), parsed.stdout + parsed.stderr);
  check('Exported app parses in real R', parsed.status === 0);
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const rPort = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  rProcess = spawn('C:/R/R-4.6.0/bin/Rscript.exe', ['-e', `shiny::runApp(${JSON.stringify(rFile)}, host="127.0.0.1", port=${rPort}, launch.browser=FALSE)`], { windowsHide: true });
  let rLog = '';
  rProcess.stdout.on('data', d => { rLog += d; });
  rProcess.stderr.on('data', d => { rLog += d; });
  const rUrl = `http://127.0.0.1:${rPort}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(rUrl)).ok) { ready = true; break; } } catch {}
    if (rProcess.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  check('Exported Shiny app starts', ready);
  if (ready) {
    const live = await context.newPage();
    await live.goto(rUrl);
    await live.waitForFunction(() => document.querySelector('#summary')?.textContent === '12 cars');
    check('Reactive output renders edited default in live R app', true);
    await live.locator('#reset').click();
    await live.waitForFunction(() => document.querySelector('#summary')?.textContent === '10 cars');
    check('Reset button updates live reactive output', true);
    await live.getByRole('tab', { name: 'Data', exact: true }).click();
    await live.waitForFunction(() => document.querySelectorAll('#table tbody tr').length === 10);
    check('Live table renders filtered rows', true);
    await live.getByRole('tab', { name: 'Plot', exact: true }).click();
    await live.waitForFunction(() => !!document.querySelector('#scatter img')?.getAttribute('src'));
    check('Live plot renders', true);
    await live.screenshot({ path: path.join(out, '06-live-shiny.png'), fullPage: true });
    await live.close();
  }
  await fs.writeFile(path.join(out, 'r-runtime.log'), rLog);
  check('No uncaught editor browser errors', errors.length === 0, { errors });
} catch (e) {
  check('Audit harness completed', false, { fatal: String(e), stack: e.stack });
  await page.screenshot({ path: path.join(out, 'harness-failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ browser: browser.version(), results, errors }, null, 2));
  if (rProcess && rProcess.exitCode === null) spawnSync('taskkill', ['/PID', String(rProcess.pid), '/T', '/F'], { windowsHide: true });
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await app.idle();
  db.close();
}
