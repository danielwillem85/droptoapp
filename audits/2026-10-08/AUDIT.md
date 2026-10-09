**Workflow audit — DropToApp, 8 October 2026**

The complete happy path works: import an R app, edit visually and in code, save a design, reopen it, recover through normal autosave, export `app.R`, and run that export in R. The most useful next milestone is protecting handwritten work during errors, undo, and navigation.

Audited source revision: `0244f337bd521d578cbf747ecff4a23e492fd10d`. Application source was not changed. The audit added only this folder; the production build generated ignored `dist/` files. Tests used headless Chrome 154.0.8037.98, Node 22.14.0, the installed R runtime with Shiny/bslib, a temporary SQLite database, a synthetic account, and isolated browser storage. No real account or newsletter subscription was used. Audit server, browser, and R processes were stopped.

**Representative document and verified journey**

[representative-app.R](C:/Apps/git/TruthEditor/audits/2026-10-08/representative-app.R) is a 14-component cars dashboard using `mtcars`. It contains a sidebar, computed select choices, a slider with an extra R argument, a reset button, an asymmetric grid, a computed value box, Plot/Data/Notes tabs, plot/table/text outputs, a reactive helper, an unsupported UI expression, comments, quotes, and Unicode.

| Stage | Observed result |
| --- | --- |
| Register and open editor | Passed through the real production login/registration UI, declining newsletter signup. |
| Import existing R | Source retained byte-for-byte; design reports no validation problems. |
| Visual editing | Page title and slider default changed; custom expressions, setup code, reactive logic, button code, and Unicode survived. |
| Duplicate/delete | Duplicate received the distinct `rows1` ID; undo restored a deleted component; redo removed it. |
| Save and reopen | Downloaded `.shinydesign.json` reopened with matching generated source. Handwritten source also survived save/reopen exactly. |
| Normal reload | After autosave settled, both valid designs and invalid code drafts recovered. |
| Syntax correction | Error banner identifies line/column; Go to error focuses the editor; correcting the source clears the error. |
| Export and reimport | Download matched displayed source exactly and reopened unchanged as R. |
| Execute exported app | R parsed the export and Shiny started. Summary displayed the edited default of 12 cars; Reset changed it to 10; table rendered 10 rows; plot rendered. |

The existing 43 tests and production build passed. The final browser audit recorded **24 passing checks, five failing checks grouped into four findings below, and one observed documented limitation**. There were no uncaught editor browser errors. These counts describe this document and scenario, not general release coverage.

**1. P1 — Property edits discard an invalid code draft**

Reproduce: open [invalid-draft.shinydesign.json](C:/Apps/git/TruthEditor/audits/2026-10-08/invalid-draft.shinydesign.json). Its source ends with an unfinished `new_helper <- function(x) {` function. The canvas correctly says it is read-only. Change the page Title in the still-enabled Properties panel. The unfinished function disappears, the source is regenerated from the last valid tree, and the error banner clears without an explicit discard action.

Cause: the canvas has a visual lock, but [PropertiesPanel.tsx](C:/Apps/git/TruthEditor/src/ui/PropertiesPanel.tsx:15) still dispatches changes, and [store.ts](C:/Apps/git/TruthEditor/src/state/store.ts:95) clears the draft on visual commits.

Recommended fix: guard visual mutation actions centrally while a code error exists, and disable the corresponding property/palette/keyboard actions. Keep correcting, saving, exporting, and explicitly discarding the draft available. Acceptance: a property edit cannot remove the unfinished helper, and only an explicit discard action can abandon it.

Evidence: [before property edit](C:/Apps/git/TruthEditor/audits/2026-10-08/02-invalid-draft.png), [after property edit](C:/Apps/git/TruthEditor/audits/2026-10-08/03-after-property-edit.png).

**2. P1 — Undo does not restore the original handwritten source**

Reproduce: open the representative R document, change its page title visually, then click Undo. The title returns, but the original formatting and UI comment do not. [after-undo.R](C:/Apps/git/TruthEditor/audits/2026-10-08/after-undo.R) contains regenerated code instead of the original document.

Cause: [history stores only trees](C:/Apps/git/TruthEditor/src/state/store.ts:30); [Undo](C:/Apps/git/TruthEditor/src/state/store.ts:205) and Redo clear `codeDraft` and `codeError`. The README already documents UI comment loss on visual regeneration. The additional recovery defect is that Undo cannot reverse that loss.

Recommended fix: history snapshots should include the design, exact source draft, and parse state. Acceptance: import → visual edit → Undo restores source byte-for-byte, and Redo restores the edited state. Include invalid drafts and source-only comment edits in regression coverage.

**3. P2 — Autosave can lose the latest edit and does not report failure**

Two checks failed. First, editing Title and immediately reloading restored the previous title; the latest change was lost. Second, in a separate browser context where `localStorage.setItem` threw `QuotaExceededError`, editing produced no save-failure indication.

Cause: [App.tsx](C:/Apps/git/TruthEditor/src/ui/App.tsx:66) waits 300 ms before saving and cancels the pending timer during cleanup. [platform.ts](C:/Apps/git/TruthEditor/src/ui/platform.ts:49) catches storage failures without returning a result or surfacing an error.

Recommended fix: expose pending/saved/failed state, persist the latest pending draft on appropriate page lifecycle transitions, and provide a visible manual-download fallback when storage fails. Acceptance: immediate reload preserves the last edit; simulated quota failure displays a persistent message while the current document remains downloadable. A lifecycle flush alone should not be claimed to guarantee recovery from a browser/process crash.

Evidence: [storage failure screenshot](C:/Apps/git/TruthEditor/audits/2026-10-08/05-storage-failure.png) and the named checks in [results.json](C:/Apps/git/TruthEditor/audits/2026-10-08/results.json).

**4. P2 — A computed value box overflows the phone preview**

Reproduce: open the representative app and choose Phone. The value preview displays the literal `format_count(nrow(cars))` expression. The value-box container extends about 55 pixels beyond the frame (right edges: 1032.5 versus 978 in the audit viewport). This makes the narrow preview unreliable for this content.

Recommended fix: allow shrinking and wrap or truncate expression placeholders within the component, with the full expression available on inspection. Acceptance: the box and expression stay within the 400-pixel preview. The editor uses placeholder output previews; this observation does not establish a responsive defect in the exported Shiny app.

Evidence: [phone preview](C:/Apps/git/TruthEditor/audits/2026-10-08/04-phone-preview.png); relevant rendering is in [previews.tsx](C:/Apps/git/TruthEditor/src/ui/previews.tsx:268) and styling in [styles.css](C:/Apps/git/TruthEditor/src/ui/styles.css:1288).

**Reproduction assets and limits**

[run-audit.mjs](C:/Apps/git/TruthEditor/audits/2026-10-08/run-audit.mjs) repeats the workflow with a fresh local database and browser context. From the repository root, build first, then run `node --disable-warning=ExperimentalWarning --import tsx audits/2026-10-08/run-audit.mjs`. It expects the current machine's Chrome/R paths and `playwright-core` in `%TEMP%/trutheditor-workflow-audit-runtime/node_modules`. It records product failures as diagnostic results rather than terminating at the first failed check; a harness exception does set a failing exit code.

The [exported app](C:/Apps/git/TruthEditor/audits/2026-10-08/exported-app.R), [saved design](C:/Apps/git/TruthEditor/audits/2026-10-08/saved-design.shinydesign.json), [handwritten design](C:/Apps/git/TruthEditor/audits/2026-10-08/handwritten-design.shinydesign.json), screenshots, and JSON results are retained beside this report. [Live R screenshot](C:/Apps/git/TruthEditor/audits/2026-10-08/06-live-shiny.png) shows the running export. R logged locale startup warnings, but parsing, startup, and the tested reactive behavior succeeded.

This audit did not cover drag-and-drop interactions, every component, large documents, multiple browsers, real mobile-device interaction, or a full accessibility assessment. The phone check was the editor's simulated-width preview. Fixes are recommendations; application behavior remains unchanged.

