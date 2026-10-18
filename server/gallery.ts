/**
 * Public template pages, for people and search engines:
 *   /templates             the gallery
 *   /templates/<slug>      one template: what it does, a screenshot, the full app.R, how to run it
 *   /templates/<slug>/app.R  the code as a download
 * The content comes from src/model/gallery.ts, the same templates the editor offers.
 */
import { packagesUsed, shinyliveUrl } from '../src/model/shinylive';
import { TEMPLATES, templateFunctions } from '../src/model/gallery';
import type { AppTemplate } from '../src/model/gallery';
import { tokenizeR } from '../src/model/rHighlight';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function highlightR(code: string): string {
  return tokenizeR(code)
    .map((t) => (t.kind === 'plain' ? esc(t.text) : `<span class="tok-${t.kind}">${esc(t.text)}</span>`))
    .join('');
}

interface PageOptions {
  title: string;
  description: string;
  path: string;
  image: string;
  imageAlt: string;
  ld: unknown[];
  body: string;
}

function page(site: string, o: PageOptions): string {
  const url = `${site}${o.path}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(o.title)}</title>
    <meta name="description" content="${esc(o.description)}" />
    <link rel="canonical" href="${esc(url)}" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1l7 7-7 7-7-7z' fill='%232563eb'/%3E%3C/svg%3E" />
    <meta name="theme-color" content="#2563eb" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="DropToApp" />
    <meta property="og:title" content="${esc(o.title)}" />
    <meta property="og:description" content="${esc(o.description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(site + o.image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(o.imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    ${o.ld.map(jsonLd).join('\n    ')}
    <style>${CSS}</style>
  </head>
  <body>
    <header class="site-header">
      <div class="wrap">
        <a class="brand" href="/"><span>◆</span> DropToApp</a>
        <nav class="site-nav" aria-label="Site">
          <a href="/templates">Templates</a>
          <a href="/#features">Features</a>
          <a href="/#faq">FAQ</a>
        </nav>
        <a class="header-login" href="/#account">Log in</a>
      </div>
    </header>
    <main>
${o.body}
    </main>
    <footer>
      <div class="wrap">
        <p><strong>DropToApp</strong>: a visual, drag-and-drop editor for R Shiny user interfaces. <a href="/templates">Shiny app templates</a></p>
        <p>Shiny is a trademark of Posit Software, PBC. DropToApp is an independent project, not affiliated with or endorsed by Posit or the R Foundation.</p>
      </div>
    </footer>
  </body>
</html>
`;
}

function card(t: AppTemplate): string {
  return `<article class="tpl-card">
          <a class="tpl-thumb" href="/templates/${t.slug}"><img src="/static/templates/${t.slug}.webp" width="1200" height="750" loading="lazy" decoding="async" alt="Screenshot of the ${esc(t.title)} Shiny template in the DropToApp editor" /></a>
          <div class="tpl-card-body">
            <h3><a href="/templates/${t.slug}">${esc(t.title)}</a></h3>
            <p>${esc(t.summary)}</p>
            <div class="tags">${t.tags.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
          </div>
        </article>`;
}

/** Cards for the landing page's template section. */
export function templateCards(limit = TEMPLATES.length): string {
  return TEMPLATES.slice(0, limit).map(card).join('\n        ');
}

const breadcrumbs = (site: string, items: [string, string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site}${path}` })),
});

export function renderGalleryIndex(site: string): string {
  const description =
    'Free R Shiny app templates: a KPI dashboard, a data explorer, a form, a multi-page app and more. Copy the app.R, run it in your browser or edit it visually.';
  return page(site, {
    title: 'R Shiny app templates: free examples to copy | DropToApp',
    description,
    path: '/templates',
    image: `/static/templates/${TEMPLATES[0].slug}.png`,
    imageAlt: 'Shiny app templates in the DropToApp editor',
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'R Shiny app templates',
        description,
        url: `${site}/templates`,
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: TEMPLATES.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}/templates/${t.slug}`, name: t.title })),
        },
      },
      breadcrumbs(site, [
        ['DropToApp', '/'],
        ['Templates', '/templates'],
      ]),
    ],
    body: `      <section class="hero">
        <div class="wrap">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Templates</nav>
          <h1>R Shiny app templates</h1>
          <p class="lead">Complete, working Shiny apps built with bslib, ready to copy. Each one comes with the full <code>app.R</code>, runs in your browser without installing R, and opens in the DropToApp editor so you can change it by drag and drop or in code.</p>
        </div>
      </section>
      <section class="tight">
        <div class="wrap grid">
        ${TEMPLATES.map(card).join('\n        ')}
        </div>
      </section>
      <section>
        <div class="wrap narrow">
          <h2>How to use a template</h2>
          <ol class="steps">
            <li><b>Try it.</b> Open a template and click <em>Run it in your browser</em>: the real app starts on your computer with webR, R compiled to WebAssembly.</li>
            <li><b>Make it yours.</b> <em>Open in DropToApp</em> loads it into the editor. Rearrange the layout, change inputs and outputs, and edit the server code, with the R code and the design in sync.</li>
            <li><b>Run it anywhere.</b> Download <code>app.R</code> and run it with <code>shiny::runApp()</code>, or deploy it to Shiny Server, Posit Connect or shinyapps.io.</li>
          </ol>
          <p class="cta-row"><a class="button" href="/#account">Create a free account</a></p>
        </div>
      </section>`,
  });
}

export function renderTemplatePage(t: AppTemplate, site: string, shinyliveBase: string): string {
  const fns = templateFunctions(t);
  const pkgs = packagesUsed(t.code).filter((p) => p !== 'shiny' && p !== 'bslib');
  const install = `install.packages(c(${['shiny', 'bslib', ...pkgs].map((p) => `"${p}"`).join(', ')}))`;
  const runUrl = shinyliveUrl(t.code, { base: shinyliveBase });
  const others = TEMPLATES.filter((x) => x.slug !== t.slug);
  const title = `${t.headline} | DropToApp`;
  return page(site, {
    title,
    description: t.summary,
    path: `/templates/${t.slug}`,
    image: `/static/templates/${t.slug}.png`,
    imageAlt: `The ${t.title} Shiny template in the DropToApp editor`,
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareSourceCode',
        name: t.headline,
        description: t.summary,
        url: `${site}/templates/${t.slug}`,
        image: `${site}/static/templates/${t.slug}.png`,
        programmingLanguage: { '@type': 'ComputerLanguage', name: 'R' },
        runtimePlatform: 'Shiny',
        codeSampleType: 'full solution',
        keywords: ['R Shiny', 'Shiny template', 'bslib', ...t.tags].join(', '),
        isAccessibleForFree: true,
        publisher: { '@type': 'Organization', name: 'DropToApp', url: `${site}/` },
      },
      breadcrumbs(site, [
        ['DropToApp', '/'],
        ['Templates', '/templates'],
        [t.title, `/templates/${t.slug}`],
      ]),
    ],
    body: `      <section class="hero">
        <div class="wrap">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/templates">Templates</a> › ${esc(t.title)}</nav>
          <h1>${esc(t.headline)}</h1>
          <p class="lead">${esc(t.summary)}</p>
          <div class="cta-row">
            <a class="button" href="/?template=${t.slug}">Open in DropToApp</a>
            <a class="button ghost" href="${esc(runUrl)}" target="_blank" rel="noopener">Run it in your browser ↗</a>
            <a class="button link" href="/templates/${t.slug}/app.R" download="app.R">Download app.R</a>
          </div>
        </div>
      </section>
      <section class="tight">
        <div class="wrap">
          <figure class="shot">
            <img src="/static/templates/${t.slug}.webp" width="1200" height="750" decoding="async" alt="The ${esc(t.title)} template in the DropToApp editor: the app's layout with its inputs and outputs" />
            <figcaption>The template in the DropToApp editor. <a href="${esc(runUrl)}" target="_blank" rel="noopener">Run it</a> to see it working.</figcaption>
          </figure>
        </div>
      </section>
      <section>
        <div class="wrap two-col">
          <div>
            <h2>About this template</h2>
            ${t.intro.map((p) => `<p>${p}</p>`).join('\n            ')}
            <h2>What's inside</h2>
            <ul class="ticks">
              ${t.highlights.map((h) => `<li>${h}</li>`).join('\n              ')}
            </ul>
          </div>
          <aside class="facts">
            <h3>Shiny functions used</h3>
            <p class="chips">${fns.map((f) => `<code>${esc(f)}</code>`).join(' ')}</p>
            <h3>Packages</h3>
            <p class="chips">${['shiny', 'bslib', ...pkgs].map((p) => `<code>${esc(p)}</code>`).join(' ')}</p>
            <h3>Data</h3>
            <p>Built into R, so it runs as is.</p>
          </aside>
        </div>
      </section>
      <section>
        <div class="wrap">
          <div class="code-head">
            <h2 id="code">The complete app.R</h2>
            <span>
              <button type="button" class="copy" data-copy="app-code">Copy</button>
              <a href="/templates/${t.slug}/app.R" download="app.R">Download</a>
            </span>
          </div>
          <pre class="code" id="app-code"><code>${highlightR(t.code)}</code></pre>
        </div>
      </section>
      <section>
        <div class="wrap narrow">
          <h2>How to run it</h2>
          <ol class="steps">
            <li><b>In your browser:</b> <a href="${esc(runUrl)}" target="_blank" rel="noopener">run it with shinylive</a>. R runs on your computer with webR; the first start downloads R and the packages, which can take a minute.</li>
            <li><b>In R or RStudio:</b> save the code as <code>app.R</code>, install the packages once with <code>${esc(install)}</code>, then run <code>shiny::runApp()</code> in the folder with the file.</li>
            <li><b>In DropToApp:</b> <a href="/?template=${t.slug}">open the template in the editor</a> to change the layout by drag and drop or edit the code, and export your own <code>app.R</code>.</li>
          </ol>
        </div>
      </section>
      <section>
        <div class="wrap">
          <h2>More Shiny templates</h2>
          <div class="grid">
          ${others.map(card).join('\n          ')}
          </div>
        </div>
      </section>
      <script>
        document.querySelectorAll('[data-copy]').forEach(function (b) {
          b.addEventListener('click', function () {
            var text = document.getElementById(b.getAttribute('data-copy')).innerText;
            navigator.clipboard.writeText(text).then(function () {
              b.textContent = 'Copied';
              setTimeout(function () { b.textContent = 'Copy'; }, 1500);
            });
          });
        });
      </script>`,
  });
}

export function renderNotFound(site: string): string {
  return page(site, {
    title: 'Template not found | DropToApp',
    description: 'This Shiny template does not exist (any more). Browse all R Shiny app templates.',
    path: '/templates',
    image: `/static/templates/${TEMPLATES[0].slug}.png`,
    imageAlt: 'Shiny app templates',
    ld: [],
    body: `      <section class="hero">
        <div class="wrap">
          <h1>Template not found</h1>
          <p class="lead">There is no template at this address. Have a look at <a href="/templates">all Shiny app templates</a>.</p>
        </div>
      </section>`,
  });
}

const CSS = `
      :root {
        --bg: #f6f7f9; --panel: #fff; --border: #e1e4e8; --text: #1f2328; --muted: #5d6673;
        --accent: #2563eb; --accent-soft: rgba(37, 99, 235, 0.1); --code-bg: #fbfbfc;
        --ui: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
        --mono: ui-monospace, 'Cascadia Code', Consolas, monospace;
        color-scheme: light;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #17191c; --panel: #1f2226; --border: #33373d; --text: #e6e8eb; --muted: #9aa3ae;
          --accent: #5b8def; --accent-soft: rgba(91, 141, 239, 0.16); --code-bg: #1b1d21; color-scheme: dark;
        }
        .tok-string { color: #7ee2a8 !important; } .tok-number { color: #f3a86b !important; }
        .tok-keyword { color: #c7a4ff !important; } .tok-fn { color: #79b8ff !important; } .tok-op { color: #ff8b8b !important; }
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 var(--ui); }
      a { color: var(--accent); }
      code { font: 0.9em var(--mono); background: var(--accent-soft); border-radius: 4px; padding: 0 4px; }
      .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
      .narrow { max-width: 820px; }
      .site-header { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
      .site-header .wrap { display: flex; align-items: center; gap: 24px; height: 60px; }
      .brand { font-weight: 700; font-size: 18px; color: var(--text); text-decoration: none; }
      .brand span { color: var(--accent); }
      .site-nav { display: flex; gap: 20px; margin-left: auto; font-size: 14px; }
      .site-nav a { color: var(--muted); text-decoration: none; }
      .site-nav a:hover { color: var(--text); }
      .header-login { font-size: 14px; font-weight: 600; padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border); background: var(--panel); color: var(--text); text-decoration: none; }
      section { padding: 44px 0; }
      section.tight { padding-top: 0; }
      .hero { padding: 44px 0 36px; }
      h1 { font-size: clamp(28px, 4vw, 42px); line-height: 1.15; letter-spacing: -0.02em; margin: 10px 0 14px; }
      h2 { font-size: clamp(21px, 2.6vw, 27px); line-height: 1.25; margin: 0 0 12px; }
      h3 { font-size: 16px; margin: 0 0 6px; }
      .lead { font-size: 18px; color: var(--muted); max-width: 760px; margin: 0 0 22px; }
      .crumbs { font-size: 13px; color: var(--muted); }
      .crumbs a { color: var(--muted); }
      .cta-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
      .button { display: inline-block; font-weight: 600; padding: 10px 18px; border-radius: 8px; text-decoration: none; border: 1px solid var(--accent); background: var(--accent); color: #fff; }
      .button.ghost { background: transparent; color: var(--accent); }
      .button.link { border-color: transparent; background: transparent; color: var(--accent); padding-left: 6px; padding-right: 6px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
      .tpl-card { display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
      .tpl-thumb img { display: block; width: 100%; height: auto; border-bottom: 1px solid var(--border); }
      .tpl-card-body { padding: 14px 16px 16px; }
      .tpl-card-body h3 a { color: var(--text); text-decoration: none; }
      .tpl-card-body h3 a:hover { color: var(--accent); }
      .tpl-card-body p { margin: 0 0 10px; color: var(--muted); font-size: 14px; }
      .tags { display: flex; flex-wrap: wrap; gap: 4px; }
      .tags span { font-size: 12px; padding: 1px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
      .shot { margin: 0; }
      .shot img { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.12); }
      .shot figcaption { text-align: center; color: var(--muted); font-size: 14px; margin-top: 12px; }
      .two-col { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 48px; align-items: start; }
      .two-col h2 + p, .two-col p { color: var(--muted); }
      .two-col h2:not(:first-child) { margin-top: 28px; }
      .ticks { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
      .ticks li::before { content: '✓'; color: var(--accent); font-weight: 700; margin-right: 10px; }
      .facts { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
      .facts h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-top: 14px; }
      .facts h3:first-child { margin-top: 0; }
      .facts p { margin: 0; font-size: 14px; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .code-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .code-head span { display: flex; gap: 12px; align-items: center; font-size: 14px; }
      .copy { font: inherit; font-size: 14px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer; }
      pre.code { margin: 0; padding: 18px 20px; overflow: auto; background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; font: 13px/1.55 var(--mono); }
      pre.code code { background: none; padding: 0; font: inherit; }
      .tok-comment { color: #6a737d; font-style: italic; } .tok-string { color: #0a7f3f; } .tok-number { color: #b35900; }
      .tok-keyword { color: #8250df; } .tok-fn { color: #0550ae; } .tok-op { color: #cf222e; }
      .steps { padding-left: 22px; display: grid; gap: 10px; }
      footer { border-top: 1px solid var(--border); padding: 28px 0 40px; color: var(--muted); font-size: 13px; }
      footer p { margin: 4px 0; }
      @media (max-width: 860px) {
        .two-col { grid-template-columns: 1fr; gap: 24px; }
        .site-nav { display: none; }
        .header-login { margin-left: auto; }
      }
`;
