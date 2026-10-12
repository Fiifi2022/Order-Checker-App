# Local FS allocation integration

Implemented locally on 11 October 2026. Nothing was pushed or deployed. Existing uncommitted application changes were preserved.

## Behavior and architecture

The existing popup UI is also the Chrome side panel. Its audit controls, General Auditor, Vaccine Checker, authentication, and verified deduction workflow remain available. A separate live FS section shows the facility, district/region where provided, products actually in the order, the current draft, requested quantities, available balances, and required diluent/dropper reminders.

The FS content script reads the Add New Order form through scoped accessible labels, selected option values, selected custom-dropdown labels, and the Requested Products table. It never changes fields or submits orders. Mutation and input/change events update the selection with a 100 ms debounce. The adapter caches its form root. Passwords, patient details, and unrelated page text are excluded from live messages.

The module service worker coordinates authenticated GET requests using the existing Firebase token session and refresh code. States are isolated by tab; account/backend changes invalidate them. Older requests cannot replace newer contexts. Quantity-only updates reuse the last retrieved balance, without a new allocation request. Facility/product/order changes and explicit Refresh request current Firestore data. Verified extension deductions refresh known FS tabs. There is no continuous subscription to deductions made by other clients: use Refresh balances for those updates.

## Backend endpoints

- New: `GET /api/vaccine/companion/context?selection=<JSON>`; protected by existing authentication and role middleware. Reads current Firestore Blueprint sheets, excludes inactive/archived sheets and rows, and returns advisory data only. Cache disabled. No verification records, orders, allocation transactions, or histories are written.
- Existing: `GET /api/vaccine/companion/facilities`, `POST /api/verify`, `POST /api/vaccine/allocations/commit`, `GET /api/vaccine/allocations/commit/:orderId`. These retain their existing audit/deduction responsibilities. Live FS monitoring never calls the write endpoints.

Balances use the arithmetic extracted from the existing verified Blueprint snapshot into `blueprintAllocationNumbers`: stored balance takes precedence; otherwise carry-over + allocation − distributed, with the existing nonnegative fallback. Missing or malformed live data returns unavailable rather than an invented balance. FS stock and permissions remain separate from allocation advice.

## Matching

Facility IDs match only explicit `fsFacilityId`/`facilityId` values on Blueprint rows; FS IDs are not assumed to equal Blueprint row IDs. Otherwise facility names must match using the existing HC/Health Centre, CHPS, and DHD normalization, with district and known region constraints. Multiple active allocation cycles or duplicates require selection from the live panel. The extension never creates facilities or chooses a similar name. The audit facility selector synchronizes when the corresponding existing facility record is unique.

Live products use a new exact-alias entry point into the existing vaccine alias registry. Existing audit matching is preserved. Extra words never produce a substring match. Presentation/strength/brand qualifiers require an exact Blueprint product key where a generic antigen could be unsafe. Allocation keys keep different presentations separate in aggregate quantity checks. Product IDs are transported when the DOM exposes them; no stock-to-allocation mapping is guessed.

## Floating indicator and Add confirmation

The isolated Shadow DOM indicator displays the current draft product and retrieved balance. It stays visible during quantity entry and failed Add attempts, and validates positive whole quantities and cumulative order demand. It never alters the requested quantity. It checks available positions beside/around controls and native validation elements, and follows scroll/resize events.

An Add click records the product, quantity, facility, and existing table rows. The indicator hides only when the observed requested-product rows show the exact expected quantity increase for that product, matched by product ID when both sides have IDs, otherwise exact displayed name. An unchanged table, wrong product, wrong quantity, or unrelated mutation does not confirm success. Added rows remain in the panel after the draft is cleared; deleted rows disappear. If FS leaves the successfully added product selected, the old draft stays suppressed until the controls change.

## Files changed for this update

- `server.ts`, `server/fsAllocation.ts`, `server/fsAllocation.test.ts`: authenticated read-only endpoint, matching, and tests.
- `server/vaccineService.ts`, `server/blueprintConfirmation.ts`: exact live alias resolver and shared existing balance arithmetic.
- `extension/background.js`, `extension/fs-state.js`, `extension/fs-adapter.js`, `extension/fs-content-entry.js`, generated `extension/fs-content.js`, `extension/fs-panel.js`: live bridge, indicator, and panel.
- `extension/popup.html`, `extension/popup.js`, `extension/vaccine.js`, `extension/vaccine.test.js`: retained interface, live section, automatic facility selection, post-deduction refresh, and updated DOM mocks.
- `extension/manifest.json`, `extension/config.js`, `scripts/build-extension.mjs`, `server/extensionPackage.ts`: exact origin permissions, localhost defaults, bundled content script, and package contents. Downloaded packages also grant their explicitly configured backend origin.
- `extension/fs.test.js`, `extension/fs-integration.test.js`, `extension/fixtures/fs-add-order.html`: unit, DOM, service-worker, and panel fixtures.
- `package.json`, `package-lock.json`: LinkeDOM development dependency for DOM integration tests.
- This report.

## Validation

Passed TypeScript (`npm run lint`), JavaScript syntax checks, full `npm test`, and `npm run build`. The full runner reports 50 passing test files. The five DOM/service-worker/panel integration cases also pass directly. Existing tests exercise both audit modes and transaction safeguards. The isolated local Firestore emulator persistence test passed, including an atomic deduction and duplicate retry prevention; only emulator records were used.

Local backend connectivity was verified: `/api/health` returned HTTP 200 and an unauthenticated `/api/vaccine/companion/context` returned HTTP 401. Authenticated live lookup was exercised with mocked Firebase tokens and backend responses, and matching/calculation with Blueprint fixtures. The authenticated production Blueprint was not queried during testing.

Build emits the existing large frontend chunk warning. It still succeeds.

## Chrome reload and manual verification

1. Use Node 22.12+ (the checks used the installed Node 24 runtime), then run `npm run dev` for the local backend.
2. Open `chrome://extensions`, enable Developer mode, and Load unpacked → this project's `extension` directory, or click Reload on its existing entry.
3. Refresh the FS tab at either `https://fulfillment-gh1-production.platform.flyzipline.com/v3/orders/Draft` or `https://fulfillment-gh3-production.platform.flyzipline.com/v3/orders/Draft`.
4. Open the existing extension popup, confirm backend `http://localhost:3000`, sign in, and choose Open OrderCheck side panel. Firebase requires your approved verified account.
5. In an authorized test session, select Mumford HC, BCG, and a quantity. Compare advice with the active Blueprint. Exercise successful and rejected Add, a second vaccine, removal, facility changes, duplicate names, expired auth, and different viewport sizes. Do not submit a real order or process a production deduction as a test.

No Chrome executable or connected browser session was available, and the supplied FS URL was inaccessible through the web tool. Therefore **actual FS selectors, actual Add behavior, visual positioning, and loading via chrome://extensions have not been browser-verified**. The fixture models accessible controls and a Requested Products table; adjust `fs-adapter.js` only after inspecting the authorized real page if it uses different markup or abbreviated row labels. Native stock/facility rejection messages remain untouched.

The supplied Ghana 1 and Ghana 3 FS origins have live monitoring. WhatsApp capture remains available at `https://web.whatsapp.com`; the broad all-site injection has been removed. Requests from unrelated origins are rejected by the worker. Localhost is the development backend default. Additional FS origins require an explicit manifest/config update.

## 1.5.9 connection repair

The worker now derives allowed FS origins from the installed manifest and accepts older single-origin configuration schemas. The worker is bundled while keeping the runtime `config.js` external, so backend-generated configuration still applies and older package builders do not omit new worker dependencies. Unexpected origins receive an explicit rejection.

The adapter now supports div-based React screens, `aria-labelledby`, readonly Material-style widgets, nested React Select `singleValue` labels, optional/dynamically rendered quantity fields, Qty headers, and accessible table/grid rows. Tests check that the product field cannot read the facility's selected label from another control.

The popup/side panel displays **Check FS connection**. It reports script availability and boolean control-presence diagnostics. The worker reports unsupported form markup instead of silently returning empty context. No unrelated page text is collected. Version 1.5.9 is visible in the extension UI and manifest; existing downloaded/extracted extension copies must be replaced or load the current workspace `extension` directory.

The additional fixtures pass; actual FS markup remains unverified without an accessible browser session. Connection diagnostics are intended to identify the remaining blocker if the live page differs.

## 1.5.10 reconnect action

The popup and side panel now provide **Connect to FS**. The action requests Chrome site access from the user click, selects the focused FS tab (or the only open supported FS tab), and checks the content-script diagnostics. When the script is missing, it rechecks the tab's current origin and granted permission before injecting the bundled `fs-content.js`, then verifies the connection and requests fresh allocation advice. Multiple FS tabs require focusing the intended tab. Injection is guarded against installing duplicate bridges.

Reload version 1.5.10 from this workspace's `extension` folder, refresh the FS page, open Add New Order, and click **Connect to FS**. If Chrome requests site access, allow the supported FS site. The diagnostic message distinguishes a missing script from unsupported form markup and reports which controls were detected.

Validation on 11 October 2026: the existing full suite passed all 50 test files; the new connection regression test file also passed. Its cases cover an existing connection, repair of a missing script, diagnostics without injection, withheld permissions, navigation away from FS, and ambiguous/missing tab selection. TypeScript and the production build passed; the build retains the frontend chunk-size warning. `fs-connection.js` is included in downloadable extension packages. Actual Chrome loading, live FS markup, and visual positioning still require browser verification. Nothing was pushed or deployed during this continuation.

## 1.5.11 field caption support

Following a live diagnostic of facility detected but product/quantity missing, the adapter now recognizes exact plain React captions (`span`, `p`, or `div`) associated with a single nearby control, product/quantity placeholders, and dropdown buttons declaring `aria-haspopup="listbox"`. It supports Select product and Requested Qty captions. Ambiguous containers and captions beside a different field's label are rejected. Search text remains excluded from confirmed product selections. Regression fixtures cover these structures and protection against borrowing the facility widget.

This extends supported markup; the actual FS form has not been inspected here. Reload v1.5.11 and refresh FS to test the current page. If product/quantity are still missing, capture their exact visible labels or a screenshot of the product-entry area so the remaining markup can be identified.

Validation: all 51 test files, TypeScript, and the production build passed using the installed Node 24 runtime. The existing frontend chunk-size warning remains.

## 1.5.12 empty Requested Products state

The user clarified that Product is a table heading, the product picker and quantity controls are not visible, and the page says No requested products. The adapter now recognizes the order screen from its facility control together with a Requested Products heading or product/quantity table, even before entry controls mount. Empty-table message rows are excluded from order items. Connection diagnostics explain that the controls are not detected yet and suggest opening the FS picker; the live panel shows the empty order state. The adapter continues observing the order area when controls appear.

Fixtures verify the empty screen, a heading before table columns mount, opening the product/quantity controls, and retaining the added row after those controls close. The actual FS DOM remains uninspected; this change follows the reported screen structure.

Validation: all 51 test files, TypeScript, the production build, and diff whitespace checks passed. The build retains its existing frontend chunk-size warning.

## 1.5.13 messaging and facility synchronization repair (12 October 2026)

The reported FS URL is `https://fulfillment-gh3-production.platform.flyzipline.com/v3/orders/Draft?`. Its origin already matches both the installed-source manifest's FS injection patterns and `config.js`; no new browser permissions were added. The user reports Chrome loading `~/MyFiles/Downloads/ordercheck-compliance-companion` as v2.2.8. This workspace's source was v1.5.12 and is now v1.5.13. Updating this workspace alone does not replace that Downloads copy.

The general capture script previously returned `true` for all messages, including FS messages it never answered. It now handles only scrape messages synchronously and returns explicit capture errors. FS_REFRESH now responds asynchronously with its actual refreshed state. Worker listeners claim only their own message types and settle success, validation, storage, backend and tab failures through the Chrome 116-compatible literal-true/sendResponse pattern. Unsupported messages are ignored. Transport failures keep their original error detail; bounded deadlines prevent permanent Connecting states. Live GETs use a ten-second fetch timeout and twelve-second overall lookup deadline. The other audit/deduction request timeouts remain unchanged.

Top-frame FS messages target the focused supported FS tab, or the single supported FS tab if it is not focused. Multiple supported tabs require focusing the intended one. Diagnostics include an initial sanitized DOM snapshot and bridge version. The snapshot displays the selected facility while the worker reads allocation data. Reconnect rechecks the configured origin and existing site access before injection. It requests no additional permissions. Reinjection disposes the previous same-version bridge, observer, events and listener; extension-context invalidation prompts reloading FS. A worker restart rebuilds current state from a forced snapshot and session storage. Ordered writes and generation checks prevent stale responses or delayed writes from restoring removed-tab state. Token refresh alone no longer discards context; account/backend changes still do.

Facility metadata now supports selected accessible widgets and scoped label/value pairs for Facility, District and Region. The Gbangu CHPS fixture starts with District East Mamprusi and Region North East already selected, and verifies both initial capture and DOM-only changes. Mutation observation also detects replacement of the order subtree. The panel clears old Blueprint matches on facility/tab changes, displays the FS name/district/region independently of backend availability, selects a unique matching Blueprint record by its stable ID, and leaves ambiguous candidates for manual cycle selection. Empty orders remain advisory. No FS selection, Add or connection action calls audit/commit endpoints or writes allocation balances.

Connection reporting distinguishes Connected to FS, Waiting for facility selection, FS content script unavailable, FS tab not found, Backend unreachable, authentication/permission errors, missing Blueprint facilities, and ambiguity. Missing product-entry controls continue to be described as an empty/waiting state. Floating indicator and successful-Add detection are preserved.

Modified source: `extension/content.js`, `background-entry.js`, `fs-content-entry.js`, `fs-messaging.js` (new), `fs-connection.js`, `fs-adapter.js`, `fs-panel.js`, `vaccine.js`, `auth.js`, `backend.js`, `manifest.json`, `popup.html`, and `server/extensionPackage.ts`. The build regenerates `background.js` and `fs-content.js`. Regression coverage lives in `fs-messaging.test.js`, `fs-panel.test.js`, `fs-connection.test.js`, `fs-integration.test.js`, `vaccine.test.js`, the Gbangu fixture, `server/fsAllocation.test.ts`, and `server/extensionPackage.test.ts`.

The default backend remains `http://localhost:3000`. A fresh ZIP is built with that backend and the manifest's actual FS origins. Replace all files in the reported Downloads folder with the ZIP contents, reload its Chrome entry, confirm v1.5.13, and refresh the Ghana 3 FS tab. Alternatively load this workspace's `extension` directory directly. No GitHub push, Render deployment, or production allocation test is performed. The authenticated live FS DOM and Chrome UI are unavailable in this environment, so live-browser behavior still needs verification after replacing the installed copy.

Validation: all 53 test files passed, including the existing audit, authentication/role, deduction and Blueprint suites. TypeScript, production build and whitespace checks passed using Node 22.23.3. The frontend still emits its existing chunk-size warning. The deliverable is `dist/ordercheck-compliance-companion-1.5.13.zip`, packaged with the localhost default and current runtime modules. Confirm the popup backend remains localhost if the installed copy has a saved override.

## 1.5.14 Package & Script capture (12 October 2026)

The provided actual HTML has a script div with a generated ID followed by `button[aria-label="Edit script"]`. Earlier live snapshots contained only facility/products and never transported this text into the confirmation textarea. The new `fs-script.js` reader scopes to the detected order's form, dialog or main, prefers its Package & Script heading/container, and reads only the div beside that edit action (including a small action wrapper). IDs are not hardcoded or matched against a UUID value. Ambiguous actions, hidden content and candidates containing headings or controls are excluded. The scan never falls back to page/card text.

Chrome's rendered `innerText` preserves displayed punctuation and line breaks; DOM fixtures use a text-node/BR traversal. The full script is carried through the existing FS_SELECTION → session context → side-panel flow, independent of Blueprint availability. The live lookup request still sends only facility/products. Script-only updates reuse matched allocation advice. The existing debounced MutationObserver triggers snapshots; there is no page polling or FS editing.

The existing `fulfillmentText` field is now visibly labelled Fulfilment Confirmation → Customer Scripts. Source changes fill it, save the text with an origin marker, and invalidate the existing audit through its normal input-change path. Captured text clears on order closure/replacement, tab disconnection, or the Add Order action. After Add Order, unchanged text in the old script node is blocked until the new script DOM/text appears. Manual confirmation text remains available when it is not owned by FS synchronization, and delayed storage restoration cannot overwrite a fresh script or restore cleared captured text.

Modified: new `extension/fs-script.js` and `fs-script.test.js`; `fs-adapter.js`, `fs-state.js`, `fs-content-entry.js`, `fs-panel.js`, `popup.js`, `popup.html`, bridge/manifest version files, integration/panel tests, and `server/extensionPackage.ts`/its test. The generated worker and content bundles include the current snapshot contract. The ZIP is `dist/ordercheck-compliance-companion-1.5.14.zip` with localhost as its default. The implementation is tested against the supplied HTML structure; actual authenticated FS/browser behavior remains unverified here. Nothing is pushed or deployed.

Validation: all 54 test files passed, plus TypeScript, production build and whitespace checks. New script coverage includes line breaks, punctuation, generated ID changes, mutations, Edit script wrappers, empty/ambiguous content, replacing/starting orders, separate React cards and confirmation-field synchronization. Integration tests exercise content snapshots, worker persistence, script-only allocation-cache reuse, and side-panel callbacks. The existing frontend chunk-size warning remains.

## Backend context lookup repair and data findings (12 October 2026)

Read-only live Firestore inspection succeeded outside the network sandbox. The configured database contains Tuni CHPS only in the `west_mamprusi` September 2026 allocation sheet, under West Mamprusi; its BCG balance is 2. This sheet has `worksheetRole: allocation` and no explicit inactive/archive flag. No Tuni East Mamprusi row or Presbyterian/Namolgo row was found. The earlier October 4 recovery snapshot contained a Tuni East Mamprusi row, but it is not the current cloud authority. No cloud records were corrected or created. The requested East Mamprusi lookup must remain not_found until the data discrepancy is resolved.

The backend also had reproducible code defects: unit spacing (`0.05mL` versus `0.05 mL`) could label an existing allocation untracked; a facility suffix stored in `subDistrict` was not considered; success used `available` instead of the requested `ok`; advisory requests ran through catalog-seeding transaction middleware and sequential unbounded reads. New `server/fsContext.ts` handles the context/facility GETs with direct read-only catalog and Blueprint reads, shared 7.5-second authentication/read deadlines, JSON errors, no-store responses, and short request logs. `/api/health` now returns exactly `{ "status": "ok" }`. Facility-list IDs and projection format remain compatible with the existing audit/deduction workflow.

`server/fsAllocation.ts` adds formatting-only product tolerance while retaining strength and pack-size distinctions; facility matching supports explicitly stored sub-district suffixes, then district/region disambiguation. Stored numeric balance remains authoritative. A missing record returns untracked/null; ambiguous product identities return HTTP 409 and malformed allocated balances return HTTP 503, both with an error string. This is an explicit error-contract clarification: unknown balances are never represented as a number. For unresolved facilities the existing products-empty behavior remains; the input order/length guarantee is verified for matched facilities. It is not possible to return genuine numeric balances for unresolved or untracked records without inventing them.

No valid test-account Firebase ID token was available. Actual localhost health returned 200 and the protected me/facilities/context endpoints returned JSON 401 without a token. Authenticated 200 and permission 403 were tested using the real authentication middleware with an isolated fixture verifier; they are not claimed as live Firebase-account tests. `scripts/reproduce-fs-context.mjs` runs real curl against isolated loopback replay servers. `docs/fs-context-curl-results.json` contains complete before/after responses for the requested cases from the read-only cloud snapshot, plus corrected-district examples and explicitly synthetic formatting fixtures. The stored snapshot and baseline helper make the replay rerunnable without credentials or network access. `docs/fs-context-backend.diff` shows the matcher/handler implementation and authentication budget changes; the matcher/handler were already untracked/new files in the working tree.

Validation: the full suite passed 511 tests, with the isolated Firestore persistence test skipped because no emulator was configured. Focused contract/auth/matching tests passed, including a 7.5-second failure deadline. TypeScript and production build passed. All changes remain local; no extension source changes, production allocation deductions, GitHub pushes or Render deployments were made during this backend task.
