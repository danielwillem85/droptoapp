# DropToApp: a Shiny UI designer (proof of concept)

DropToApp lets you design an R Shiny user interface by dragging and dropping
components. It writes a runnable `app.R` (Shiny + bslib) as you work.

The editor is built with **TypeScript and React** and runs in the browser. A
small Node.js server (`server/`) adds **user accounts** (SQLite), a
**newsletter sign-up** (Brevo) and serves the editor to logged-in users only.

## Getting started

Requirements: **Node.js 22.13 or newer** (the accounts database uses Node's
built-in SQLite).

```bash
npm install
cp .env.example .env   # then fill in your Brevo API key and list number
npm run dev            # open http://localhost:5173, then register an account
```

On Windows you can also double-click `start-local.cmd`: it runs `npm run dev`
with Brevo switched off (local sign-ups send no emails) and opens the browser.

`npm run dev` starts both the account server (port 3000) and Vite (port 5173,
with hot reload); Vite forwards `/api`, `/login`, `/templates`, `/static` and the robots/sitemap
files to the server.

Other scripts:

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm test`          | Unit tests: model, R code generator, round-trips, accounts API   |
| `npm run typecheck` | TypeScript type check                                            |
| `npm run build`     | Production build of the editor in `dist/`                        |
| `npm start`         | Production server: landing page, accounts API and `dist/`        |

To run the generated app, click **Export app.R** and then, in R:

```r
install.packages(c("shiny", "bslib"))   # once (plus "DT" / "plotly" if the app uses them)
shiny::runApp("path/to/folder/with/app.R")
```

## What you can do

- **Drag components** from the palette onto the canvas, or **click** one to
  add it to the selected container. Inputs go to the sidebar by default.
- **Build grids.** *Column* and *Row* add one cell at a time: dropped on a
  grid they add the next column or row, dropped in a row they split it into
  columns (and in a column, into rows), and anywhere else they start a new
  grid. *2 columns* and *2 rows* add a ready-made grid of two empty cells.
  Cells hold anything, including other grids. While you drag, the left and
  right edges of every component are also drop zones: in a row of columns they
  add a column there, and anywhere else they put the dropped component
  **beside** that one in a new two-column grid (the hint says *New column*).
  Grids with equal widths keep them equal as you add or remove cells
  (`6, 6` becomes `4, 4, 4`); custom widths like `4, 8` are left alone.
- **Tabs anywhere.** Drop a *Tab panel* on a Tabset card to add a tab, or
  anywhere else (main area, card, grid cell) to start a new Tabset card with
  it. Clicking *Tab panel* adds a tab next to the one you are working in.
  *Accordion panels* work the same way with *Accordions*.
- **Multi-page apps.** Set the page layout to `page_navbar`: each *Tab panel*
  becomes a page in the navigation bar. The content you had becomes the first
  page; switching back turns several pages into a Tabset card, so nothing is
  lost. With `page_navbar` the sidebar is optional: drop inputs in it to show
  it on every page.
- **Templates.** *Templates…* opens complete starter apps (a KPI dashboard,
  a data explorer, a feedback form, a multi-page app, a CSV explorer and the
  Old Faithful example). Each one opens as a new project. See *Template
  gallery* below.
- **Move components** by dragging them. A blue line shows where they'll land.
  Rules are enforced: for example, a *Tab panel* can only go inside a
  *Tabset card*, and you can't drop a container into itself.
- **Edit properties** in the right-hand panel: IDs, labels, choices, widths,
  and the **server code** for each output or button.
- **Edit `app.R` directly.** The code view is an editor, not just a preview
  (see *Visual and code editing* below). You can copy the code or download
  `app.R`.
- **Open an existing `app.R`.** *Open…* accepts R scripts as well as saved
  designs.
- **Validation** catches invalid or duplicate IDs, bad slider ranges, unused
  sidebar content and similar problems.
- **Page settings:** `page_sidebar`, `page_navbar`, `page_fillable` or
  `page_fluid`, and Bootswatch themes.
- **Responsive preview** at desktop, tablet and phone widths.
- **Editor size.** The whole editor is shown at 85% by default, so more of the
  design, code and panels fit on the screen. The − / % / + control at the right
  of the status bar changes it (70% to 125%; click the percentage to go back
  to 85%). It is remembered per browser. This scales the editor with CSS
  `zoom`; toolbar labels give way by the toolbar's own width (container
  queries), so they follow the chosen size.
- **Run the real app** in the browser with **▶ Run**, server code included,
  without installing R (see *Running apps in the browser* below).
- **Projects in your account** (*My projects*, see below), saved
  automatically, plus **undo/redo** and download/open of design files
  (`*.shinydesign.json`).

Keyboard: `Del` deletes · `Ctrl+Z` / `Ctrl+Y` undo/redo · `Ctrl+D` duplicates ·
`Alt+↑/↓` reorders · `Esc` selects the page · `Ctrl+Shift+Enter` runs (or
restarts) the app, also while typing in the code.

### Running apps in the browser

**▶ Run** starts the app for real: inputs, outputs, `render*()` functions,
`observeEvent()` and the rest of the server code all work. It uses
[shinylive](https://shinylive.io), which runs Shiny for R on
[webR](https://docs.r-wasm.org/webr/latest/) (R compiled to WebAssembly)
entirely in the visitor's browser. There is no R on the DropToApp server and
nothing extra to install.

- The running app takes the canvas's place. In *Split* view the code stays
  underneath; the Desktop/Tablet/Phone widths apply to the live app too.
- A run uses the code as it was when it started. After edits the bar says
  *Code changed since this run*; **↻ Restart** (or `Ctrl+Shift+Enter`) runs
  the latest version. Switching to *Code* view keeps the app running.
- Code with a syntax error can't be run; fix or discard the edit first.
- **New tab ↗** opens the running app on its own; **R console ↗** opens it in
  shinylive's editor, whose console shows R errors and warnings.
- The first start downloads R and the app's packages (shiny, bslib and
  anything it loads with `library()` or `pkg::`), which can take a minute;
  later runs are usually faster (browser cache). Packages come from the webR
  repository (repo.r-wasm.org), which has most of CRAN but not packages that
  need system libraries. Code that reads local files or databases won't find
  them in the browser.

#### Debugging with `browser()`

Put `browser()` in server code, or click a line number in the code view to
add one above that line (click the red dot to remove it again, like the margin
in RStudio). Breakpoints can only go at the start of a statement inside a
function: the server, a render block, an observer, a helper function.

- **In RStudio or R** the exported `app.R` behaves as usual: the app pauses at
  `browser()` and you get the `Browse[1]>` prompt.
- **With ▶ Run** R can't pause an app running in the browser, so DropToApp
  rewrites `browser()` for Run only: when the app reaches it, a *Debugger*
  dialog opens in the app with the line and the code around it, the local
  variables (with their values at that moment), the inputs, and an R prompt
  that evaluates code in that environment (`summary(x)`, `nrow(df)`, …).
  *Continue* closes it; *Don't stop again* turns it off until the next Run.
  The run bar shows which lines will stop the app. `browser()`'s arguments
  keep working, e.g. `browser(expr = input$n > 5)` only stops when the
  condition is true.
- The validator warns about every `browser()` left in the code, so you remember
  to remove it before deploying.

How it's done (`src/model/debug.ts`): `browser()` calls are found by parsing
the code (so comments and strings don't count) and replaced by
`.dta_browser(…, .line = 42L, .source = "…")` in the code sent to Run. A
small debugger written in R with plain Shiny functions (`DEBUGGER_R`) is added
at the top, and `.dta_debug_init()` is added as the first line of the server
function. *R console ↗* gets your `app.R` unchanged.

How it works: `src/model/shinylive.ts` builds a link like
`https://shinylive.io/r/app/#h=0&code=…` where `code` is `app.R` as JSON,
compressed with lz-string (`src/model/lzstring.ts`, a port of the library
shinylive uses). The code travels in the `#fragment`, which browsers never
send to a server, and shinylive runs it locally. The editor shows that page in
an iframe (`src/ui/RunPanel.tsx`). If a browser blocks it inside the editor
(some block service workers in embedded third-party pages), **New tab** works.

By default this uses Posit's public shinylive.io. `SHINYLIVE_URL` in `.env`
points it at another deployment of the shinylive site instead (it must serve
the `/r/app/` and `/r/editor/` pages), e.g. a self-hosted copy built from
[posit-dev/shinylive](https://github.com/posit-dev/shinylive).

### Visual and code editing

The design and `app.R` are two views of the same app, and you can switch
between them at any time.

- **Typing in the code view updates the canvas as you type.** Your text is
  kept exactly as written, including formatting and comments.
- **While the code has a syntax error,** the canvas shows the last valid
  version and is read-only. A banner shows the line and column of the error;
  *Go to error* jumps there and *Discard edits* throws the edits away.
  Properties, component insertion, design shortcuts, New/Open/Templates and
  design undo/redo are disabled until you fix or explicitly discard the code
  edits. You can still inspect the outline, edit or undo text in the code view,
  save the design, and export the draft.
- **A visual edit regenerates `app.R` from the design.** Code outside the UI
  (setup code, server code) is kept as written. Formatting and comments
  *inside* the `ui` call are normalised, and the code view says when that is
  about to happen (*Edited by hand*; *Reformat* does it on request).
- **Undo and redo** work across both: typing in the editor is one undo step
  per burst of typing. `Ctrl+Z` inside the editor uses the editor's own undo.
  Each undo step keeps the code exactly as it was, so undoing a visual edit
  brings back your hand-written `app.R` byte for byte (formatting and comments
  included). *Reformat* and *Discard edits* can be undone too, and undoing a
  discard restores an unfinished draft with its syntax error.

Nothing you write in R is thrown away, even if the designer has no visual
editor for it:

| In app.R                                                                  | In the designer                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A UI call it doesn't know, e.g. `DT::DTOutput("tbl")`, `div(...)`         | An **R code** block on the canvas, kept verbatim (also in the palette)   |
| A computed argument, e.g. `choices = names(mtcars)`                       | The field shows an **R expression** (the `R` button next to a field does the same) |
| An argument without a field, e.g. `ticks = FALSE`                         | **More R arguments** in the properties panel                             |
| `library()` calls, data loading, helper functions before `ui`             | Page → **Setup code**                                                    |
| `output$x <- renderPlot({...})` / `observeEvent(input$go, {...})`         | The **Server code** of that plot or button                               |
| Other server code, e.g. `reactive()`, `observe()`, `DT::renderDT()`       | Page → **Other server code**                                             |
| A theme other than `bs_theme(bootswatch = ...)`                           | The theme field as an R expression                                       |

**Limitations:** the `ui` must be a `page_sidebar()`, `page_fillable()` or
`page_fluid()` call assigned with `ui <- ...`, and `server` must be a
`function(input, output, session) { ... }`. Comments inside the `ui` call are
lost on the next visual edit.

## Accounts and newsletter

Visitors must register or log in before they can use the editor. The server
enforces this: without a valid session it only serves the landing page (with
the login and registration form), so the editor's code is never sent to
anonymous visitors.

- **Accounts** live in a SQLite database (`data/droptoapp.db` by default,
  created automatically). Passwords are stored as scrypt hashes; log-ins are
  HttpOnly, SameSite cookies whose tokens are stored hashed. Failed log-ins and
  registrations are rate limited (10 per 15 minutes per IP and per email).
- **Newsletter:** the registration form has a newsletter checkbox (not ticked
  by default; `NEWSLETTER_CHECKED_BY_DEFAULT` in `.env` changes that). If
  someone creates an account without ticking it, a popup asks once whether they
  are sure, with **Subscribe** and **Do not subscribe**; either button creates
  the account (Escape goes back to the form). When the box is ticked, or
  Subscribe is chosen, the server adds the address to your Brevo list via
  `POST https://api.brevo.com/v3/contacts` with `listIds: [BREVO_LIST_ID]`. It
  does this in the background, so a slow or failing Brevo never blocks
  registration. The result is stored per user in `users.brevo_status`
  (`subscribed`, `error: …` or `skipped: …`), with the time of the choice in
  `newsletter_at`.
- **Designs** are saved in the account as projects (see *Projects* below).
- **Notifications to you:** every new account and every successful login send
  an email through Brevo to the addresses in `NOTIFY_EMAILS` (comma-separated;
  default `danielvdpalm@gmail.com`; empty sends none), from
  `BREVO_SENDER_EMAIL`, which must be a verified Brevo sender.
  - *New account:* name, email, account ID, creation time (UTC) and newsletter
    choice.
  - *Login:* name, email, account ID, time (UTC), IP address, browser (user
    agent), and how (password, or after resetting the password). Failed login
    attempts don't send anything.
  - Never included: passwords, password hashes or session tokens.
  - They need `BREVO_API_KEY`, not `BREVO_LIST_ID`. They are sent in the
    background with a 10-second timeout, so a slow or failing Brevo never
    delays registration or login; failures are logged as
    `[account-notification]` / `[login-notification]`, without retry.
  - The login notices contain your users' IP addresses: mention this in your
    privacy policy.
- **Forgot your password?** On the login form, people enter their email and
  get a link to choose a new password, sent through Brevo's transactional
  email (`POST /v3/smtp/email`, from `BREVO_SENDER_EMAIL`).
  - The answer is the same whether or not the address has an account, so the
    form can't be used to find out who is registered.
  - A link works once and for 60 minutes; asking again replaces older links.
    Only a SHA-256 hash of the token is stored (`password_resets` table). The
    page (`/reset-password`) takes the token out of the address bar, isn't
    indexed and sends no referrer.
  - Setting a new password logs the account out on all other devices, logs it
    in here, and sends a "your password was changed" email.
  - Limits: 3 reset emails per address and 10 requests per IP an hour; 20
    attempts to use a link per IP per 15 minutes.
  - Links are built from `SITE_URL` only (or the request's address on
    localhost while developing), never from the request's Host header, which
    anyone can fake. **Set `SITE_URL` in production**, or no reset emails are
    sent (the server logs a warning).
  - Without `BREVO_API_KEY` (e.g. developing locally), the reset link is
    written to the server log instead of emailed.
  - In Brevo, consider turning off click tracking for transactional emails
    (Transactional > Settings), so reset links go straight to your site
    instead of through Brevo's redirect.

Settings are in `.env` (see `.env.example` for all of them):

| Setting                          | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `BREVO_API_KEY`                  | Brevo > SMTP & API > API Keys                            |
| `BREVO_LIST_ID`                  | Brevo > Contacts > Lists (the list's ID number)          |
| `BREVO_SENDER_EMAIL`             | Verified sender for notifications and reset emails (default `info@droptoapp.com`) |
| `NOTIFY_EMAILS`                  | Who gets an email for each new account and login (default `danielvdpalm@gmail.com`) |
| `NEWSLETTER_CHECKED_BY_DEFAULT`  | Newsletter box ticked on the form (default `false`)      |
| `PORT`, `HOST`                   | Where the server listens (default `127.0.0.1:3000`)      |
| `DATABASE_PATH`                  | SQLite file (default `data/droptoapp.db`)              |
| `SESSION_DAYS`                   | How long a log-in lasts (default 30)                     |
| `SITE_URL`                       | Public address, e.g. `https://droptoapp.com`: SEO, and needed for password-reset links |
| `SHINYLIVE_URL`                  | Where **Run** runs apps (default `https://shinylive.io`) |
| `COOKIE_SECURE`, `TRUST_PROXY`   | Set both to `true` in production behind nginx + HTTPS    |

To see who signed up: `sqlite3 data/droptoapp.db "select email, newsletter, brevo_status, created_at from users"`.

## Projects (designs saved in the account)

Every design is a project in the user's account, so it is there on any
computer they log in on. The name of the open project is in the toolbar; it
opens **My projects**, where projects can be opened, renamed, duplicated and
deleted. *New*, *Templates…* and *Open…* each start a new project; the
previous one stays in My projects. *Download* saves the design as a file.

- **Saving** is automatic: about a second after a change, to the account
  (`PUT /api/projects/:id`). The status bar says *Saved to your account*,
  *Saving…*, or what is wrong.
- **A copy stays in the browser** as well, written immediately and when the
  page closes. Without a connection the editor keeps working on that copy
  (*Offline: kept in this browser*), retries every few seconds, and sends it
  as soon as the server is reachable again, also after a reload. Leaving the
  page only asks for confirmation when neither the account nor the browser
  could store the latest changes.
- **Edits in two places.** Each save says which version it builds on. If the
  project was saved elsewhere in the meantime (another tab or computer), the
  save is refused and the editor offers *Keep both* (your version becomes a
  new project), *Keep mine* or *Use the other*. Nothing is overwritten
  without asking.
- **What opens at the start:** the project this browser was working on (the
  account's version if it changed elsewhere and this browser has no unsaved
  changes); otherwise the most recently edited project, e.g. from another
  computer. The first time after upgrading, a design that was only in the
  browser becomes the user's first project, so nothing is lost. A new user
  starts with the Old Faithful example as their first project.
- **Undo history** belongs to the open project and starts fresh when you open
  another one.

API (JSON, logged-in users only; another user's project answers 404):

| Request                        | Does                                                                   |
| ------------------------------ | ---------------------------------------------------------------------- |
| `GET /api/projects`            | List: id, name, version, created/updated time (newest first)           |
| `POST /api/projects`           | Create: `{ name, project }`                                            |
| `GET /api/projects/:id`        | One project, with the design                                           |
| `PUT /api/projects/:id`        | Save `{ project, baseVersion }` (409 if changed since; `force: true` overrides), or rename `{ name }` |
| `DELETE /api/projects/:id`     | Delete                                                                 |

Limits: 1 MB per design, 500 projects per user, names up to 120 characters.
Projects are in the `projects` table of the same SQLite database and are
deleted with the user's account; back up `data/droptoapp.db` regularly, it
now holds your users' work.

## Landing page and SEO

Logged-out visitors get a landing page at `/` (logged-in users get the editor at
the same address). It is `server/login.html`: a hero with the login and
registration form, a screenshot, features, how it works, the supported
components, who it's for, an FAQ and a call to action. `/login` shows the same
page and is still where the editor sends you when a session expires.

For search engines and link previews it has:

- a title and meta description, a canonical link to `/`, Open Graph and Twitter
  card tags with a 1200×630 preview image;
- JSON-LD structured data: `SoftwareApplication`, and a `FAQPage` that matches
  the visible FAQ (a test checks they stay in sync);
- `/robots.txt` (everything except `/api/`) and `/sitemap.xml`;
- images in `server/public/`, served without logging in at `/static/…`.

Set `SITE_URL` (e.g. `https://droptoapp.com`) so the canonical link, preview
image and sitemap use your real address; without it the address comes from each
request. `/` is sent with `Cache-Control: no-store` and `Vary: Cookie`, so a
CDN never mixes up the landing page and the editor.

After deploying, add the site to Google Search Console and submit
`https://droptoapp.com/sitemap.xml`.

## Template gallery

The templates live in `src/model/gallery.ts`: a title, a summary, a few
paragraphs, highlights, tags and the complete `app.R` for each. The same list
feeds three places:

- **The editor:** *Templates…* (`src/ui/TemplateGallery.tsx`), and
  `/?template=<slug>`, which opens a template once and then removes the
  parameter. Logged-out visitors land on the login page first and get the
  template after signing up.
- **Public pages** for search engines and sharing (`server/gallery.ts`):
  `/templates` lists them all, `/templates/<slug>` has a screenshot, the
  description, the Shiny functions and packages used, the full highlighted
  `app.R` with *Copy* and *Download* (`/templates/<slug>/app.R`), *Run it in
  your browser* (shinylive) and *Open in DropToApp*. Each page has its own
  title, description, canonical link, Open Graph image and JSON-LD
  (`SoftwareSourceCode`, `BreadcrumbList`). All of them are in `sitemap.xml`,
  and the landing page links to the first three.
- **Screenshots** in `server/public/templates/`: `<slug>.webp` (1200×750, for
  the cards and pages) and `<slug>.png` (1200×630, for link previews). They
  are pictures of the template on the editor's canvas.

Each template's code is exactly what the editor generates for it, so the page,
the editor and a Run show the same code (`tests/gallery.test.ts` checks this,
and that every template is fully visual, uses only shiny, bslib, DT and
plotly, and has its screenshots). To add or change a template: write the app,
open it in the editor, paste the generated `app.R` into `gallery.ts` with its
texts, and save a screenshot of the canvas under both names.

## Deploying on Ubuntu

1. Install Node.js 22.13+ (e.g. from NodeSource) and nginx.
2. Copy the project to the server (e.g. `/opt/droptoapp`), then:
   ```bash
   npm ci && npm run build
   cp .env.example .env   # fill in Brevo and SITE_URL; set COOKIE_SECURE=true and TRUST_PROXY=true
   ```
3. Run it as a service, `/etc/systemd/system/droptoapp.service`:
   ```ini
   [Unit]
   Description=DropToApp
   After=network.target

   [Service]
   WorkingDirectory=/opt/droptoapp
   ExecStart=/usr/bin/npm start
   Restart=on-failure
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now droptoapp` (make sure `www-data` can write to `data/`).
4. Let nginx forward to it (and add HTTPS with `certbot --nginx`):
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;
       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
5. Back up `data/droptoapp.db` (it holds all accounts).

## Supported components

| Group   | Components                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Pages   | `page_sidebar`, `page_navbar` (pages are `nav_panel`s, optional shared `sidebar`), `page_fillable`, `page_fluid` |
| Layout  | `card`, grids (`layout_columns`, built with *Column*, *Row*, *2 columns*, *2 rows*), cells (`div()`), `navset_card_tab`, `nav_panel`, `accordion`, `accordion_panel`, `conditionalPanel`, `value_box` |
| Inputs  | `sliderInput`, `numericInput`, `textInput`, `textAreaInput`, `selectInput`, `radioButtons`, `checkboxInput`, `checkboxGroupInput`, `dateInput`, `actionButton`, `fileInput` |
| Outputs | `plotOutput`, `tableOutput`, `textOutput`, `verbatimTextOutput`, `DT::DTOutput`, `plotly::plotlyOutput` (each with its `render*()` code), `downloadButton` (with `downloadHandler()`) |
| Content | headings, paragraphs, `hr()`, `tooltip()` (wraps one component), and **R code** blocks for any other UI expression |

DT and plotly outputs are written with their package prefix (`DT::DTOutput`,
`DT::renderDT`), so they work without `library()`. Code that uses the short
names after `library(DT)` / `library(plotly)` is recognised too.
`downloadHandler(filename = "…", content = function(file) { … })` is shown as
the download button's *File name* and *Server code*; other forms (e.g. a
filename computed by a function) are kept as written in *Other server code*.

## How it's built

```
src/
  model/              pure TypeScript with no React (easy to test and reuse)
    types.ts          UINode tree + project file format
    components.ts     component registry: fields, defaults, nesting rules, R emitters
    tree.ts           immutable tree operations (insert / move / remove / duplicate)
    codegen.ts        UINode tree -> app.R (ui + server)
    fromR.ts          app.R -> UINode tree (the other direction)
    rparse.ts         parser for the R language, with source positions and line/col errors
    rcode.ts          helpers for R strings, vectors and styler-like call formatting
    validate.ts       problems shown in the UI
    rHighlight.ts     small R tokenizer for syntax colouring
    templates.ts      blank project and the "Old Faithful" starter design
    gallery.ts        the template gallery: texts and app.R of each template
    shinylive.ts      Run: shinylive links (app.R in the #fragment), packages used
    lzstring.ts       lz-string compression, as used by shinylive links
    debug.ts          browser(): breakpoints in the code view, and the debugger used by Run
  state/store.ts      reducer with undo/redo history (design + exact code) and edit coalescing
  ui/                 React components (canvas, palette, outline, properties, code view)
    platform.ts       file save/open, clipboard, storage (swap for Electron/Tauri APIs)
    autosave.ts       the browser copy: debounced, flushed on page hide/close, reports failures
    cloudSave.ts      saving the open project to the account: retries offline, detects edits elsewhere
    projects.ts       projects API client, and which project to open at the start
    ProjectsDialog.tsx  My projects
    auth.ts           current user and server settings, log out
    RunPanel.tsx      the live app (shinylive iframe), restart and links
    TemplateGallery.tsx  the Templates… dialog
server/
  index.ts            entry point (npm start)
  app.ts              routes: landing page, /templates, /static, robots.txt, sitemap.xml, /api/*, the editor
  gallery.ts          the public template pages (/templates, /templates/<slug>)
  auth.ts             scrypt passwords, sessions, rate limiting, cookies
  db.ts               SQLite schema (users, sessions, projects, password resets)
  passwordReset.ts    single-use, expiring reset tokens (stored hashed)
  reset-password.html the page the reset email links to
  projects.ts         projects in the account: list, open, create, save (with version check), delete
  brevo.ts            Brevo: newsletter sign-up, and transactional emails (account and login notices, password reset)
  config.ts           settings from .env
  login.html          the landing page with the login / registration form
  public/             images for the landing page and link previews; templates/ has the template screenshots
tests/                node:test tests (model, components, app.R round-trips, undo history, projects API, templates, browser() debugging, shinylive links, server), run with tsx
```

**To add a component:** add one entry to `defs` in `src/model/components.ts`
(fields, defaults, R function name, formals and argument specs), then add a
preview case in `src/ui/previews.tsx`. The same argument specs drive both
code generation and parsing, so the palette, properties panel, code
generator, `app.R` import and round-trip tests pick it up automatically.

The design is a tree of `UINode`s:

```ts
{ id, type: 'card', props: { header: 'Histogram', full_screen: true }, children: [...] }
```

That tree is the single source of truth. The canvas, outline and generated
code are all derived from it.

## Roadmap

1. **Sharing.** Share a project read-only by link, or with another account.
2. **More from Run.** Upload data files (CSV) alongside `app.R`, show R
   errors from the running app inside the editor, and optionally self-host
   shinylive and the webR packages.
3. **Better code editor.** Swap the built-in editor for CodeMirror or Monaco
   (autocomplete for `input$...` IDs, folding, search), and scroll the code
   to *any* selected component, not only inputs and outputs.
4. **More components:** `uiOutput`, `input_switch`, `popover()`, icons in value
   boxes, `nav_menu()`, and so on. More templates (maps, time series, reports).
5. **Keep comments inside `ui`** by attaching them to the nearest component.
