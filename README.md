# TruthEditor: a Shiny UI designer (proof of concept)

TruthEditor lets you design an R Shiny user interface by dragging and dropping
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

`npm run dev` starts both the account server (port 3000) and Vite (port 5173,
with hot reload); Vite forwards `/api` and `/login` to the server.

Other scripts:

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm test`          | Unit tests: model, R code generator, round-trips, accounts API   |
| `npm run typecheck` | TypeScript type check                                            |
| `npm run build`     | Production build of the editor in `dist/`                        |
| `npm start`         | Production server: login page, accounts API and `dist/`          |

To run the generated app, click **Export app.R** and then, in R:

```r
install.packages(c("shiny", "bslib"))   # once
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
- **Page settings:** `page_sidebar`, `page_fillable` or `page_fluid`, and
  Bootswatch themes.
- **Responsive preview** at desktop, tablet and phone widths.
- **Undo/redo**, save/open designs (`*.shinydesign.json`), and autosave in
  the browser.

Keyboard: `Del` deletes · `Ctrl+Z` / `Ctrl+Y` undo/redo · `Ctrl+D` duplicates ·
`Alt+↑/↓` reorders · `Esc` selects the page.

### Visual and code editing

The design and `app.R` are two views of the same app, and you can switch
between them at any time.

- **Typing in the code view updates the canvas as you type.** Your text is
  kept exactly as written, including formatting and comments.
- **While the code has a syntax error,** the canvas shows the last valid
  version and is read-only. A banner shows the line and column of the error;
  *Go to error* jumps there and *Discard edits* throws the edits away.
- **A visual edit regenerates `app.R` from the design.** Code outside the UI
  (setup code, server code) is kept as written. Formatting and comments
  *inside* the `ui` call are normalised, and the code view says when that is
  about to happen (*Edited by hand*; *Reformat* does it on request).
- **Undo and redo** work across both: typing in the editor is one undo step
  per burst of typing. `Ctrl+Z` inside the editor uses the editor's own undo.

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
enforces this: without a valid session it only serves the login page, so the
editor's code is never sent to anonymous visitors.

- **Accounts** live in a SQLite database (`data/trutheditor.db` by default,
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
- **Designs** are still autosaved in the browser, now separately per account.

Settings are in `.env` (see `.env.example` for all of them):

| Setting                          | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `BREVO_API_KEY`                  | Brevo > SMTP & API > API Keys                            |
| `BREVO_LIST_ID`                  | Brevo > Contacts > Lists (the list's ID number)          |
| `NEWSLETTER_CHECKED_BY_DEFAULT`  | Newsletter box ticked on the form (default `false`)      |
| `PORT`, `HOST`                   | Where the server listens (default `127.0.0.1:3000`)      |
| `DATABASE_PATH`                  | SQLite file (default `data/trutheditor.db`)              |
| `SESSION_DAYS`                   | How long a log-in lasts (default 30)                     |
| `COOKIE_SECURE`, `TRUST_PROXY`   | Set both to `true` in production behind nginx + HTTPS    |

To see who signed up: `sqlite3 data/trutheditor.db "select email, newsletter, brevo_status, created_at from users"`.

## Deploying on Ubuntu

1. Install Node.js 22.13+ (e.g. from NodeSource) and nginx.
2. Copy the project to the server (e.g. `/opt/trutheditor`), then:
   ```bash
   npm ci && npm run build
   cp .env.example .env   # fill in Brevo; set COOKIE_SECURE=true and TRUST_PROXY=true
   ```
3. Run it as a service, `/etc/systemd/system/trutheditor.service`:
   ```ini
   [Unit]
   Description=TruthEditor
   After=network.target

   [Service]
   WorkingDirectory=/opt/trutheditor
   ExecStart=/usr/bin/npm start
   Restart=on-failure
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now trutheditor` (make sure `www-data` can write to `data/`).
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
5. Back up `data/trutheditor.db` (it holds all accounts).

## Supported components

| Group   | Components                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Layout  | `card`, grids (`layout_columns`, built with *Column*, *Row*, *2 columns*, *2 rows*), cells (`div()`), `navset_card_tab`, `nav_panel`, `value_box` |
| Inputs  | `sliderInput`, `numericInput`, `textInput`, `textAreaInput`, `selectInput`, `radioButtons`, `checkboxInput`, `checkboxGroupInput`, `dateInput`, `actionButton` |
| Outputs | `plotOutput`, `tableOutput`, `textOutput`, `verbatimTextOutput` (each with a `render*()` stub)                    |
| Content | headings, paragraphs, `hr()`, and **R code** blocks for any other UI expression                              |

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
    templates.ts      blank project and the "Old Faithful" example
  state/store.ts      reducer with undo/redo history and edit coalescing
  ui/                 React components (canvas, palette, outline, properties, code view)
    platform.ts       file save/open, clipboard, storage (swap for Electron/Tauri APIs)
    auth.ts           current user, log out
server/
  index.ts            entry point (npm start)
  app.ts              routes: /login, /api/register, /api/login, /api/logout, /api/me, the editor
  auth.ts             scrypt passwords, sessions, rate limiting, cookies
  db.ts               SQLite schema (users, sessions)
  brevo.ts            newsletter sign-up via the Brevo API
  config.ts           settings from .env
  login.html          the login / registration page
tests/                node:test tests (model, app.R round-trips, accounts API), run with tsx
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

1. **Designs in the account.** Save designs on the server per user, so they
   follow people across browsers and devices.
2. **Live preview in R.** Start `Rscript -e "shiny::runApp(...)"` from the
   shell and show the running app in a second webview, reloading on change.
3. **Better code editor.** Swap the built-in editor for CodeMirror or Monaco
   (autocomplete for `input$...` IDs, folding, search), and scroll the code
   to *any* selected component, not only inputs and outputs.
4. **More components:** `page_navbar`, accordions, `uiOutput`, DT and plotly
   outputs, `input_switch`, icons in value boxes, and so on.
5. **Keep comments inside `ui`** by attaching them to the nearest component.
