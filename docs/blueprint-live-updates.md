# Blueprint live updates and saving — 2 November 2026

The active saved district/month now receives Firestore document updates through
an authenticated server stream. It no longer polls every three seconds.
Confirmed Vaccine Checker transactions, extension confirmations and direct
Blueprint saves all update the same document, so they reach visible viewers
without separate notification writes or refreshing every district sheet.

## Saving direct edits

- **Autosave after typing** is on by default. Each edit restarts a 1.2-second
  timer. Pausing typing sends the latest draft through the existing save API.
- Turning Autosave off keeps changes local until **Save** is clicked.
- Save can also flush a pending autosave immediately.
- Writes are serialized. Their optimistic version checks use the last confirmed
  server version. An earlier save response cannot clear a newer unsaved draft.
- Incoming sheet changes wait while edits or resizing are pending; stale events
  and events for a different sheet are not applied. A conflicting save retains
  the draft and reports failure rather than overwriting another user's update.
- **Check updates** provides an explicit fresh-read fallback when there are no
  unsaved changes. Existing before-unload protection remains.

## Read usage and authorization

One selected-document Firestore listener is shared by viewers of that sheet on
each server process. Listeners close when their last viewer disconnects; hidden
browser tabs disconnect and reconnect when visible. Network failures reconnect
with backoff, rather than a tight polling loop. Keepalive frames are local
network traffic and do not read Firestore.

Each delivered sheet snapshot rechecks the token and current stored roles.
Unavailable or revoked access never falls back to a cached permission grant.
Listeners and successful snapshot reads appear in the existing read diagnostics.
Initial snapshots, changes, reconnections and permission checks still consume
reads; this reduces unnecessary polling, not all Firebase usage.

Existing server-side fulfilment confirmation, idempotency, transaction checks,
stock accounting and cycle protections remain authoritative. Merely running an
audit or receiving a live update does not deduct stock.

## Validation

Full suite: **1,492 passed, 0 failed, 1 skipped** (Firestore emulator integration).
TypeScript, production website/extension/server builds and whitespace checks
passed. New tests cover shared listeners, authorization revocation, disconnection,
visibility, reconnect behavior, latest-value autosave, manual mode, overlapping
saves, save failure, draft protection and stale/cross-sheet events.

Railway deployment `26b81adc-e275-40cc-b486-44051db36f7d` is confirmed
`SUCCESS`. Public checks verified health, the built frontend and JavaScript,
the new Autosave control, and anonymous requests being rejected by the live
stream endpoint. A fresh, read-only Firestore catalogue probe returned HTTP 200;
the earlier quota block was no longer present at verification time.

Changed sources: `server/blueprintLive.ts`, `server/catalogReadPolicy.ts`,
`server/firestoreReads.ts`, `server.ts`, `src/utils/blueprintLive.ts`,
`src/components/VaccineAllocationBlueprint.tsx`. Regression coverage is in
`server/blueprintLive.test.ts`, `server/blueprintSaveQueue.test.ts`, and
`server/firestoreReads.test.ts`.

Live multi-user editing and real fulfilment confirmation were not exercised:
no user was impersonated and no test deduction or operational-data write was
made. Existing dependency and bundle-size warnings remain outside this change.

## Excel range paste
The Blueprint scroll area owns paste capture, including selected ranges whose
keyboard focus is outside a cell input. A range starts at its visible top-left
cell and is applied once. Ordinary text selection within a cell remains native.
Excel plain TSV is preferred; HTML-only tables are read in an inert template as
text, retaining blank cells, merged-header offsets and quoted cell line breaks.
No clipboard-read permission or external HTML insertion is needed.

Paste targets follow the displayed filtered/sorted rows. Extending beyond that
view appends rows without overwriting hidden records. Numeric mapping is
validated against the actual detected layout before changing any rows or queuing
a save. Accounting negatives, comma/space thousands separators, decimals and
blank placeholders retain their values. Ordinary text columns cannot be mistaken
for allocation columns merely because the copied width matches a compact layout.
Invalid quantities and column overflow reject the full range with a visible
message. Closed cycles and calculated balances retain their existing protection.
Successful edits use the existing dirty-state/autosave/manual-save queue and undo
history. Regression tests exercise the real component paste handlers with mocked
save calls; no production allocation data is written by tests.

Blueprint cells also provide **Copy** and **Paste** in the right-click menu. Right-click within a highlighted range to copy the range or paste at its top-left cell; right-click another cell to target that cell. Copy preserves empty cells and embedded tabs/newlines for Excel. Paste uses the same validation, calculated-balance protection and closed-cycle rules as keyboard paste. Browser clipboard permission may be required; if denied, the status message offers Ctrl/Cmd+V. A pending clipboard read cannot apply to a different sheet after navigation.

Clipboard reliability update: keyboard Copy/Cut now uses native clipboard events, without asynchronous clipboard permissions. Shift-click selects spreadsheet cells without the browser's native input-text selection collapsing the range. The sheet keeps clipboard focus and displays save/paste errors beside the grid. **Paste data** in the sheet toolbar and **Paste from Excel…** in the right-click menu open a normal paste box; paste the range there and apply it. Right-click Paste automatically offers this box when browser clipboard access is blocked or empty. Blocked right-click Copy offers selected text for normal keyboard copy. Both paths retain existing numeric validation, closed-cycle protection and save handling.

Browser regression: `npm run build && npm run test:blueprint-browser` runs the real Blueprint component against fixture-only local APIs. Install Playwright Chromium with `npx playwright install chromium` if Chrome is unavailable, or set `CHROME_EXECUTABLE`. It covers native range paste/copy, Shift-click, context actions, denied clipboard permissions, manual paste, atomic rejection, and saved fixture values. It never contacts production APIs.

Automatic paste: the separate Paste sheet button and preview are removed. Normal Ctrl/Cmd+V, right-click Paste and the existing Paste data fallback all use the same automatic path. Tables with facility/product headings arrange and upsert immediately after validation, including on an empty grid. Raw cell ranges expand the visible grid with new rows and independent extra columns as needed. Extra columns use stable IDs and retain their values through editing, copying and saving. Closed cycles, malformed quantities, duplicate facility identities, calculated balances and conflicting district/month metadata remain protected. Invalid pastes never leave partially created rows or columns. Existing facilities outside a named table are retained.

Spreadsheet layout: the Blueprint alone uses the full application width; other tabs keep their existing centered layouts. The sheet height fits the available viewport, and Full screen fills the display. A dedicated sticky column ruler uses A, B, C… labels and a separate sticky gutter uses 1, 2, 3… row numbers. Row and column selectors continue to select data ranges for copy/paste. The gutter is outside the allocation schema, so formulas, data coordinates, Excel exports and saved records do not acquire an extra data column. Frozen rows account for the column ruler, and frozen columns account for the gutter width. The browser suite verifies ruler scrolling, selection, full-screen entry/exit and a narrow mobile viewport, alongside clipboard regression coverage.

Cell colours: select a cell or range and use **Fill colour** or **Text colour**. **No fill** removes manual, imported and automatic status backgrounds from the selected cells, leaving a white background; it does not change quantities or stock status. Text reset restores a readable default. Header labels support the toolbar controls; right-click any header (including a merged vaccine header) for Fill colour or No fill. Row/column selections and independent extra columns use the same formatting controls. Body and header colours save with the sheet and participate in undo/redo. Closed cycles remain locked. The browser regression covers visible fills/text, calculated balances, header/merged-header formatting, persistence and closed-cycle protection.

## Confirmed extension deductions and visible balances

A confirmed vaccine audit increases **Distributed** and reduces **Balance**.
The original **Allocation** and **Carry-over** columns retain their recorded values.
Returning from FS now rechecks the selected saved document on focus, visibility,
or network restoration, even if the event stream is still open but silent.
Concurrent recovery reads are combined; hidden/unmounted sheets cancel reads.
Stream failures also attempt a saved-document read. This does not poll all
districts and never resubmits a deduction.

Live delivery compares the displayed grid as well as the sheet list. A queued
deduction can therefore update the grid after a save response has already
updated the list. Older versions, other cycles, and unsaved local edits retain
their existing protection. If edits are unsaved, the sheet explicitly reports
that the incoming saved update is waiting.

`npm run build && npm run test:blueprint-live-browser` checks the real component
and live transport in Chrome against isolated local APIs. It covers live BCG
deductions, missed OPV event recovery, unchanged original allocations, no duplicate
writes, stale/cross-cycle events, and unsaved edit preservation. These tests do
not create production fulfilments or deductions.
