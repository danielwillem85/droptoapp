import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApp } from '../src/model/codegen';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from '../src/model/lzstring';
import { DEFAULT_SHINYLIVE_URL, encodeFiles, packagesUsed, shinyliveBase, shinyliveUrl } from '../src/model/shinylive';
import { starterProject } from '../src/model/templates';

test('lz-string: matches the reference library on known values', () => {
  // LZString.compressToEncodedURIComponent('') === 'Q' in the reference implementation
  assert.equal(compressToEncodedURIComponent(''), 'Q');
  assert.equal(decompressFromEncodedURIComponent('Q'), '');
  // Output only uses the URL-safe alphabet
  assert.match(compressToEncodedURIComponent('library(shiny)\nui <- page_fluid("Ünïcödé ✓ 😀")'), /^[A-Za-z0-9+$-]+$/);
});

test('lz-string: round trips text of every shape', () => {
  const samples = [
    'a',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'abababababababababcabcabcabc',
    'TOBEORNOTTOBEORTOBEORNOT#',
    'Ünïcödé ✓ 😀 中文 \u0000 ÿ Ā ￿',
    generateApp(starterProject().root).app,
  ];
  // Pseudo-random strings over small and large alphabets, many lengths (to cross every bit-width change)
  let seed = 42;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let k = 0; k < 300; k++) {
    const len = rand(3000);
    const wide = k % 3 === 0;
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(wide ? rand(0xd7ff) : 32 + rand(k % 5 === 0 ? 3 : 95));
    samples.push(s);
  }
  for (const s of samples) {
    const packed = compressToEncodedURIComponent(s);
    assert.equal(decompressFromEncodedURIComponent(packed), s);
    // URLSearchParams turns '+' into ' '; decoding still works
    assert.equal(decompressFromEncodedURIComponent(packed.replace(/\+/g, ' ')), s);
  }
  // Links stay short: smaller than the code itself, and much smaller for longer apps
  const app = generateApp(starterProject().root).app;
  assert.ok(compressToEncodedURIComponent(app).length < app.length);
  const big = app.repeat(10);
  assert.ok(compressToEncodedURIComponent(big).length < big.length * 0.5);
});

test('shinylive links carry app.R in the #fragment, in the format shinylive reads', () => {
  const app = generateApp(starterProject().root).app;
  const url = shinyliveUrl(app, { header: false });
  assert.ok(url.startsWith('https://shinylive.io/r/app/#h=0&code='), url.slice(0, 60));
  // Read it back the way shinylive does: URLSearchParams on the hash, then lz-string, then JSON
  const params = new URLSearchParams(new URL(url).hash.slice(1));
  assert.equal(params.get('h'), '0');
  const files = JSON.parse(decompressFromEncodedURIComponent(params.get('code')!)!);
  assert.deepEqual(files, [{ name: 'app.R', content: app }]);

  assert.match(shinyliveUrl('x', { mode: 'editor' }), /^https:\/\/shinylive\.io\/r\/editor\/#code=/);
  assert.match(shinyliveUrl('x'), /^https:\/\/shinylive\.io\/r\/app\/#code=/);
  assert.equal(
    encodeFiles([{ name: 'b.csv', content: '1' }, { name: 'app.R', content: '2' }]),
    compressToEncodedURIComponent('[{"name":"app.R","content":"2"},{"name":"b.csv","content":"1"}]'),
  );
});

test('the shinylive address can be configured, but only to a web address or a path', () => {
  assert.equal(shinyliveBase(undefined), DEFAULT_SHINYLIVE_URL);
  assert.equal(shinyliveBase('https://shiny.example.com/live/'), 'https://shiny.example.com/live');
  assert.equal(shinyliveBase('/shinylive'), '/shinylive');
  for (const bad of ['javascript:alert(1)', '//evil.com', 'ftp://x', 'data:text/html,hi', 'shinylive.io'])
    assert.equal(shinyliveBase(bad), DEFAULT_SHINYLIVE_URL, bad);
  assert.match(shinyliveUrl('x', { base: '/shinylive' }), /^\/shinylive\/r\/app\/#code=/);
});

test('packages used by the app are listed', () => {
  const code = `library(shiny)
library("bslib")
suppressPackageStartupMessages(require(dplyr))
# library(notused)
ui <- page_fluid(DT::DTOutput("t"), plotly::plotlyOutput("p"))
server <- function(input, output) base::invisible(NULL)`;
  assert.deepEqual(packagesUsed(code), ['DT', 'bslib', 'dplyr', 'plotly', 'shiny']);
});
