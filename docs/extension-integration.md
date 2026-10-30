# Inline FS allocation: Companion v2.3.47

Catalogue editors can select an existing product and use Delete product in the website or extension. Confirmed deletion uses the existing role-protected, revision-checked catalogue save transaction. It removes only that entry, clears inbound sync links, deactivates its aliases with history, and leaves counterpart products, past audits and allocation records intact.

Choose District first, then District cycle / month. The month dropdown lists only cycles saved for that district. Switching districts retains a shared valid month; an unavailable month is cleared visibly to Automatic and the backend preference is cleared before refreshing FS advice. No month from another district is substituted.

A District selector groups facilities independently of subdistrict display metadata. District/cycle/search filters show the matching count against all saved records, and Show all facilities clears all three filters (including the saved cycle preference). Saved Blueprint rows without allocation IDs remain browsable for quantity inspection but cannot authorize audits or deductions. Facility selection uses the exact list entry rather than treating empty IDs as interchangeable. The established MMD abbreviation is normalized to Mamprugu Moagduri for listing and FS matching, preserving explicit different districts and region checks; no saved sheet data is rewritten.

Vaccine Checker lists all active saved Blueprint facility records, including facilities without entered allocations. A visible Allocation cycle selector filters this list by any saved cycle; Automatic keeps all facility records visible and uses the latest started cycle for live FS advice. The choice is saved separately for each configured backend and sent with authenticated FS reads. An explicit selected cycle (including a future one) overrides automatic cycle resolution; missing facilities never fall back to another cycle. Changes clear prior audit/quantity displays and refresh the live FS badge without writing allocations. Cycle changes are blocked during an active audit/deduction. The audit still uses the real facility allocation ID and cycle.

The FS context endpoint automatically resolves repeated monthly records for the same exact facility and geography to the latest saved cycle that has started, using the server’s UTC month (Ghana time). It excludes future cycles, never sums balances across cycles, and keeps zero balances authoritative. Same-cycle duplicates, unknown conflicting cycle labels and conflicting geography remain review cases. Future-only allocations are unavailable until that cycle starts. Without an explicit selected cycle, the policy ignores stale manual facility choices and requires no open Blueprint page. The activation popup shows the selected saved cycle. Structured saved month values are authoritative; reporting sheet titles are not used to rewrite dates.

Facility search reads active rows from the saved Allocation Blueprint through `/api/vaccine/companion/facilities`. It preserves the real allocation-record ID used by vaccine verification and lists facilities without vaccine quantities with an allocation-not-set notice. No allocation ID is invented. Archived/disabled records are excluded, cycles remain separate, and the list refreshes when returning to facility selection. Search accepts facility/district/region/cycle words and HC/Health Centre spellings. An authoritative empty Blueprint never falls back to an unrelated saved list; authentication and service failures remain visible. Facility discovery no longer depends on product-catalogue access, and no stock is deducted by listing or selecting a facility.


Selecting a Blueprint facility now reads its saved vaccine quantities through authenticated `GET /api/vaccine/blueprint-districts/:id/facility-quantities?name=...&rowId=...&cycle=...`. The backend reads exactly that sheet, verifies the facility row and cycle, and returns allocated, taken and available values without catalogue access or deductions. Blank quantities remain unknown and zero remains zero. The extension displays these values immediately, supports refresh, clears stale values on read failures, and discards responses from earlier selections. Exact source IDs take precedence over same-name facilities in other months.

The FS connection diagnostic section is hidden in the side panel. Its automatic connection, facility detection and script synchronization remain active.

Clicking FS **Add Order** (including the plus icon) opens OrderCheck’s side panel directly from the user click. The worker calls [Chrome’s sidePanel.open API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel#method-open) before any asynchronous work. Product Add buttons do not trigger this action. The visible `scripts-tabpane-*` panel’s generated text beside **Edit script** automatically fills both General Audit’s fulfilment log and Vaccine Checker’s fulfilment confirmation, preserving line breaks. Hidden scripts, edit controls and surrounding page text are excluded. Script changes update both fields; a new order clears previously copied script text, and late saved-input restoration cannot overwrite the current FS script. No audit or allocation deduction is triggered by opening or copying.


Live GH3 inspection confirmed two detection issues: Facility’s `for="facility"` targets an empty `.d-none` `facilityId` input, and Product renders its selected `.notranslate` icon/text directly beside the React Select search input without a `singleValue` wrapper. Labels now skip hidden targets; that direct selected product node is recognized only inside the React Select control and outside options/live regions. The read-only detector was verified on the actual open GH3 page: Buzulungu CHPS, East Mamprusi, North East, Bacille Calmette-Guerin Vaccine, quantity 1.

v2.3.47 reads facility selections independently of product-form mounting and shared form roots, and includes field detection details in the activation popup. It shows a dismissible activation popup on FS with the detected facility and lookup errors. Extension installation/reload reinjects into already-open, permitted FS tabs. The side panel propagates raw facility selections immediately (including missing or ambiguous Blueprint matches); only a unique verified Blueprint record can be audited. Canonical source sheet/row identities link advisory matches to the facility picker, and stale facility responses cannot replace a newer selection.

The Buzulungu CHPS screenshot regression covers read-only React Select search inputs, selected text in `singleValue` nodes (including an icon-bearing product label), separate facility/product cards, and inline bold District/Region captions. Detection reads the selected value rather than an empty read-only search input, and the form scope must include both cards. Stock/reservation badges are never allocation evidence.

Some saved sheets use a reporting title such as `East Mamprusi Oct Allocation` in their district field. Advisory reads recognize this only when a unique exact facility-name entry in the existing served-facility directory corroborates the district and region, and the suffix consists solely of known reporting/month/year terms. Explicit row districts and conflicting regions are never overridden; duplicate sheets/cycles still require selection. This changes lookup metadata in memory only, leaving saved sheets, cycle names, balances, and deduction rules untouched.

The content script uses `fs-adapter.js` to find confirmed Facility/Product selections through labels, accessible relationships, selected React Select values, and hidden IDs. Bootstrap `.d-none` validation inputs are excluded from visible control detection. For React Select builds with hashed value classes, a nonempty identity mirror and a unique rendered value confirm selection; typed search, validation messages, live-region announcements and menu options cannot confirm it. `inline-allocation.js` inserts `order-checker-vaccine-allocation` inside the existing Product `.input-group`, immediately after the React Select container, preserving the label and validation feedback. Forms without this wrapper retain the field-group placement fallback. Namespaced flex classes and a closed shadow root isolate the badge; React-managed controls stay in place. Narrow rows may wrap controls without covering the Product dropdown.

The existing authenticated `GET /api/vaccine/companion/context` endpoint reads `vaccine_districts` and the product catalog. It uses FS facility IDs where mapped, otherwise unique normalized facility names with district/region constraints. Duplicate facilities/cycles remain unresolved until explicitly selected through the existing interface. Vaccine aliases and presentation restrictions remain deterministic. Balance comes from the existing Blueprint calculation, including explicit persisted balances; no AI or second allocation store is used. The response also supplies allocation, distribution, carryover, and existing update timestamps for the tooltip.

Visible tabs refresh every 30 seconds by default, on focus/connection recovery, and after confirmed extension deductions. In-flight equivalent lookups share a request; cached balances expire; selection revisions reject late responses. Each refresh removes the displayed balance while it verifies the current selection. Failures show a grey unavailable state rather than zero. Non-vaccines and missing allocation records hide the badge. `FS_ALLOCATION_LOW_THRESHOLD` and `FS_ALLOCATION_REFRESH_MS` configure newly downloaded packages; see `.env.example` for defaults and limits.

The FS lookup also includes legacy Blueprint rows without persisted row IDs, matching the portal's existing support. A sheet-scoped normalized-name reference identifies these rows for advisory selection only; it is never saved as a row ID or accepted as deduction authority. Duplicate normalized rows remain ambiguous even after manual selection. This change must run on the backend selected in the installed extension.

This indicator sends advisory reads only. Selecting products, changing quantities, and pressing FS Add never call a deduction endpoint. Existing confirmation authorization, verified source evidence, persisted receipts, atomic transactions and idempotency remain authoritative. Confirmed receipts trigger a refresh of advice, without a second deduction.

Validation covers DOM insertion, selected identities, quantity warnings, low/zero/unavailable balances, clearing, remounts, duplicate prevention, live refresh/recovery, request coalescing, cache expiry and existing authentication/confirmation regressions. Local Chrome fixture previews verified desktop alignment and narrow-screen wrapping. A real authenticated FS session and production Blueprint were not available: manually confirm actual React Select behavior, reset/Add/keyboard navigation, facility changes, and cross-user updates in each enabled FS origin before operational rollout. Rebuild with `npm run build`, serve the updated backend, download v2.3.47 from Extension, replace the installed files, reload the extension and refresh FS tabs.

# Audit-results display: Companion v1.5.6

A transaction receipt is authoritative when its ID and facility match the audited event, its persisted status is `confirmed` (or the compatible response declares `success: true` and `allocationStatus: "deducted"`), and its quantities/balances match the audited products. Response wrapper fields and a current `updatedFacility` projection are not required when the matching confirmed receipt exists. Conflicting identities, unconfirmed statuses and incompatible item quantities never establish success.

After an uncertain commit response, the extension calls only `GET /api/vaccine/allocations/commit/:orderId` with the original verification reference. If the receipt is confirmed, it shows successful deduction and removes the stale warning. If status remains unknown or the lookup fails, it shows **Allocation status pending verification**. **Check allocation status** performs GET only; it never posts a second deduction. Explicit HTTP input/permission errors retain their reason. A missing current allocation projection does not erase the backend's persisted transaction receipt.

Rows are filtered for presentation only: vaccines explicitly present in FS (including zero-supplied/out-of-stock lines), their included companions and relevant required companion rows are shown. Unrelated Blueprint vaccines are hidden before and after deduction. Required missing-pair errors and customer-request discrepancies remain visible. No validation, pairing, balance calculation, Firebase ownership/permission or deduction logic is changed.

Deploy the backend status-handler update and reload extension v1.5.6. The correct source is `/home/enochohene-darko/ordercheck (3)/extension`; verify Chrome Details references the installed folder. Testing uses isolated storage and never modifies production allocations.

# Verification reference fix: Companion v1.5.5

Vaccine verification now returns `verificationId` explicitly, alongside the matching `auditId` and `orderId`. The extension chooses the server-returned `verificationId`, then supported legacy `auditId`/`auditLogId`/`orderId` fields. It never creates an ID for deduction or uses a separate FS shipment reference in place of a returned verification reference. Missing/unsafe references stop before a write.

The commit endpoint accepts `verificationId`, `auditId`, `auditLogId` or `orderId` as a reference to its saved `vaccine_verified_orders` approval. Syntax only protects Firestore document paths; it is not proof of verification. An unknown reference is rejected with 404 even if its spelling resembles a valid ID. The server checks approval integrity, account ownership, permission, facility and source evidence, then revalidates the order inside its atomic Blueprint transaction. Client-generated General Auditor IDs do not grant allocation eligibility. Status lookup follows the same reference handling and requires ownership/permission. New audits still use stable `EXT-<sha256>` IDs for duplicate protection.

Regression coverage runs the actual extension adapter against the backend verification, commit and status handlers for both vaccine modes. It checks reference continuity, persisted balances and idempotent retries, plus legacy field names, non-eligible references, unsafe paths, mismatched facilities and permissions.

Deploy this backend and reload all files of extension v1.5.5 together, then run a fresh vaccine allocation audit. Earlier cached General Auditor results and FS shipment IDs are not saved allocation approvals. The Chrome loaded folder still must be verified in Chrome Details; this development environment cannot inspect the installed browser.

# Current workflow: Companion v1.5.4

The extension now matches the portal Vaccine Checker’s manual Audit action: **Audit & Update Allocation** verifies the order and updates allocation immediately if the audit passes and the authenticated account has permission. There is no separate confirmation dialog or `authorized` flag requirement. General Auditor remains read-only for vaccine allocations.

`POST /api/verify` is still read-only for allocation balances. The extension invokes the separate `POST /api/vaccine/allocations/commit` after its user-initiated vaccine audit, sending only `{ "orderId": "EXT-<hash>", "facilityId": "<selected-id>" }`. The backend independently checks the authenticated profile, effective roles, saved audit ownership, eligible evidence and facility. It revalidates quantities, pairing and current balances inside the same Firestore transaction as the deduction. Removing the extra flag does not remove account authorization or audit validation. Invalid/review-only audits never commit.

A lost response uses the same order ID. **Retry allocation update** first retrieves the saved receipt through `GET /api/vaccine/allocations/commit/:orderId`, then commits only if no prior deduction is recorded. A fresh audit of an already recorded event displays its receipt without another deduction. Quantity/balance results and the original transaction reference remain visible.

Build using Node 22.12+: `npm run lint`, `npm test`, `npm run build`. The local-only Firestore integration check is `FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 npm run test:firestore`. No production allocations are used in tests.

Redeploy Render with `npm ci && npm run build` and `npm start`. Replace all files in Chrome’s loaded extension folder and click Reload. The popup must show v1.5.4. The source folder is `/home/enochohene-darko/ordercheck (3)/extension`; this environment has no Chrome profile, so the actual installed folder still needs to be checked in Chrome Details. Portal downloads include the latest source files and disable caching.

The following notes describe earlier versions; the v1.5.4 workflow above supersedes their additional consent dialog and flag requirement.

# OrderCheck Companion v1.5.2 integration

## Root causes and changes

Before the v1.5.0 integration, the checked-in extension submitted only General Auditor requests to `/api/verify`. It required both text inputs and had no working vaccine audit-mode, facility selection, or allocation confirmation flow. That integration added `vaccine-api.js` and `vaccine.js`. The quoted “backend has no allocation endpoint” message is absent from this source tree; an installed package displaying it is a different or older build and must be replaced.

The subsequent compatibility errors had two concrete causes: the vaccine handler accepted only `customer_fulfillment`, whereas an installed companion sent `whatsapp_and_fulfillment`; and vaccine verification returned `isValid` without the `allMatch` field expected by the common extension result renderer. Version 1.5.2 maps both WhatsApp identifiers to the existing comparison workflow and returns the common result fields while retaining the vaccine-specific fields. The shared contract lives in `shared/companionAudit.ts` and is bundled into `extension/audit-contract.js`.

Selected facilities were also rejected when a legitimate older Blueprint row lacked a row ID. Verification now accepts such a row only when it resolves uniquely within the selected sheet/cycle. Stable facility IDs remain authoritative; stale IDs never fall back silently to name matching. HC, CHPS and DHD spelling variations normalize explicitly. Substring matches such as “Example North HC” versus “Example HC” are rejected. Duplicate names across cycles require a specific ID or sheet selection. No duplicate facilities or new row IDs are created as a workaround.

The backend already supports `orderSource: "fs_only"` through `/api/vaccine/validate` and persists atomic deductions through `/api/vaccine/confirm`. `/api/vaccine/allocations/commit` was absent. The new extension integrates with a server-verified contract at that requested path while reusing the existing parser, catalog aliases, vaccine pairing rules, facility resolver, confirmation service, and Blueprint transaction. Existing portal validation/confirmation endpoints remain available.

Allocation lists and Blueprint reads previously used a loader that stopped reading Firestore after its first successful load. They now reload the authoritative sheets for fresh requests, and an empty collection clears stale facilities. A misaddressed project setting referenced `firebaseConfig.projectId` instead of the nested `firebaseConfig.firebaseConfig.projectId`; this is corrected. Firebase Admin initialization now rejects credentials for a project different from the portal configuration. There was no verified evidence that production IAM permissions caused the reported issue.

## API contracts

All requests except `GET /api/health` need a Firebase ID token in `Authorization: Bearer <token>`. The existing authentication middleware verifies email and assigned roles and supplies the actor identity. The extension already sends and refreshes these tokens; it now uses that same request helper for vaccine operations.

`GET /api/vaccine/companion/facilities` refreshes Firestore and returns the current facility list with IDs, districts, cycles, and allocations. Select the facility by its ID, rather than guessing from duplicate names.

`POST /api/verify` continues to serve General Auditor. With `auditScope: "vaccine_checker"`, it accepts:

```json
{
  "auditScope": "vaccine_checker",
  "auditMode": "fulfillment_only",
  "facilityId": "selected-blueprint-facility-id",
  "whatsappMessage": "",
  "fulfillmentConfirmation": "Facility: Example Health Centre\nOPV [3/3]\nOPV Dropper [3/3]",
  "checkSource": "companion_extension"
}
```

For customer comparison, use `auditMode: "whatsapp_and_fulfillment"` and supply the customer request. `customer_fulfillment` remains accepted as the earlier spelling. With `auditScope: "vaccine_checker"`, both spellings reuse the existing vaccine comparison and allocation validator. Without an explicit scope, `whatsapp_and_fulfillment` uses the existing General Auditor for medical abbreviations and vaccine pairing rules; it verifies the selected facility against the Blueprint but does not deduct or impose vaccine balance rules on ordinary medicines. An explicit `auditScope: "general_auditor"` preserves that behavior as well. The earlier unscoped `customer_fulfillment` spelling retains its original vaccine allocation workflow. `fulfillment_only` always uses the allocation validator and never requires customer text.

Both verification workflows return `auditId`, canonical `auditMode`, `allMatch`, `items`, `discrepancies`, `facilityId` and `facilityName`. Vaccine responses also retain `isValid`, `errors`, `warnings`, `orderId`, `canAuthorize`, `canCommit`, `auditStatus`, and `allocationStatus`. Vaccine items expose `name`, string `requested`/`found`, `status` and `action` for the common renderer, alongside the original `vaccine`, `requestedQty`, `fsQty`, dose/balance fields, and `vaccineStatus`. For a two-vial IPV fulfilment-only confirmation with a sufficient allocation, the response includes:

```json
{
  "auditId": "EXT-<server-generated-hash>",
  "auditMode": "fulfillment_only",
  "allMatch": true,
  "isValid": true,
  "items": [{ "name": "IPV", "vaccine": "IPV", "requested": "0", "found": "2", "fsQty": 2, "status": "match", "vaccineStatus": "valid" }],
  "discrepancies": [],
  "facilityId": "selected-blueprint-facility-id",
  "facilityName": "Example Health Centre",
  "orderId": "EXT-<server-generated-hash>",
  "canCommit": true,
  "auditStatus": "passed",
  "allocationStatus": "ready"
}
```

`allMatch` is the authoritative overall result, including mandatory review checks. Unresolved fuzzy matching requires review and cannot commit, even if individual parsed quantities are valid. Missing/unavailable facility data returns an HTTP error with `allMatch: false`; a successful empty product list cannot clear an allocation audit. Partial fulfilment below the available balance is valid in Fulfilment Only. Unknown products and primary vaccines without allocations fail. Paired diluents/droppers can omit separate allocation rows; existing rows are checked and deducted. Catalog-recognized syringe/needle consumables without allocation rows are validated without deduction. If their rows exist, balances are checked and quantities deducted once. Unknown products and primary vaccines still require valid identification/allocation; they are never silently ignored. A prior recorded event cannot clear a newly changed customer request: only the same verified source evidence receives its original saved receipt.

`POST /api/vaccine/allocations/commit` accepts only an explicitly authorized, server-verified event:

```json
{
  "orderId": "EXT-<server-generated-hash>",
  "facilityId": "selected-blueprint-facility-id",
  "authorized": true
}
```

The server derives quantities from its saved verification, so caller-supplied product lists cannot substitute a different deduction. It checks the account, facility, sheet, row, source evidence, product identities, pairing rules, and current balances again. The response includes `success`, the persisted `transaction`, `updatedFacility`, `updatedBlueprint`, and `allocationStatus: "deducted"`.

Invalid inputs return 400; missing authentication 401; forbidden account/role 403; missing facility or verification 404; changed evidence/allocation 409; unavailable reads/writes 503. Backend failures, non-JSON responses, network failures, and timeouts retain useful messages. A failed or timed-out commit preserves the same audit ID for retry. It must never be replaced by a generic assertion that the endpoint is missing.

## Explicit FS confirmation in v1.5.2

The error `Explicit fulfilment authorization is required before deduction` comes from the commit endpoint rejecting any request whose `authorized` field is not the boolean `true`. The prior source adapter already sent that flag, so seeing this error with that source also calls for checking the installed extension and deployed backend versions. The prior UI lacked the requested second confirmation dialog and a read-only retry lookup; v1.5.2 supplies both without removing the backend check.

After a passed vaccine audit the popup displays **Awaiting FS confirmation** and **Confirm FS Entry & Deduct Allocation**. The dialog explains the deduction and offers Cancel or Confirm & Deduct. Only the latter authorizes a request. Failed audits cannot open the dialog. Changed inputs, facility, account, backend, or mode discard the pending dialog and consent. Duplicate submissions are disabled while processing. Authorization failures, insufficient balances, and other failures retain the actual server message.

Confirmation posts `{ "orderId": "EXT-<hash>", "facilityId": "<selected-id>", "authorized": true }` to the existing `/api/vaccine/allocations/commit`. The handler independently checks the effective server profile through `assignedRoles`: an explicit `roles` array is authoritative, including an empty array, and legacy `role` records remain supported. Existing CCA, administrator, warehouse and DCO permissions remain unchanged; Compliance-only profiles cannot confirm. Caller-supplied role fields have no authority.

`GET /api/vaccine/allocations/commit/:orderId` retrieves a persisted confirmation status without writing balances or implicitly authorizing fulfilment. It requires an authenticated, currently permitted account that owns the saved approval. It returns `orderId`, `facilityId`, and `allocationStatus: "awaiting_confirmation"` before commit, or `allocationStatus: "deducted"`, `success: true`, `transaction`, and `updatedFacility` afterward. The transaction retains its original timestamp/items; `updatedFacility` is the current persisted allocation projection. A confirmed retry first calls this endpoint and displays the saved receipt if present. Otherwise it reposts the original confirmed audit ID. If status lookup fails, retry does not proceed to a write.

The Firestore transaction rechecks the actual sheet and facility row. Explicit `active: false`, `isActive: false`, archived/deleted flags or statuses, and sheets marked `worksheetRole: "other"` block new deductions. Legacy allocation sheets without lifecycle flags remain eligible; choosing a portal tab does not activate/deactivate a cycle. Existing receipts remain readable after deactivation. The selected sheet/cycle must match the saved audit evidence. No new ledger or lifecycle collection is introduced.

After success the popup shows **Allocation Deducted**, transaction reference and timestamp, deducted quantities and recorded remaining balances, and refreshes the facility list. The existing Blueprint GET endpoints read Firestore afresh, so the portal's next refresh and subsequent audits use committed balances. Browser storage is never the allocation authority.

## Firestore and retry behavior

`vaccine_districts` is the allocation authority. Verification saves immutable approval evidence in `vaccine_verified_orders`. Confirmation uses an Admin SDK transaction to read the current sheet, persisted transaction, and approval before staging any writes. It updates the sheet, its `vaccine_allocations` projection, `vaccine_transactions`, and the confirmation `activity_logs` entry atomically. Reporting uses the existing vaccine activity/transaction formats. Transaction callbacks do not publish deductions or audit counters before commit succeeds.

The event ID hashes the selected facility ID and normalized confirmation text. Repeated audits, popup reloads, and retries of the same confirmation reuse that identity. A saved transaction returns its existing result without further deduction, including after a lost response or backend restart. Two legitimate separate shipments with identical quantities must have distinct fulfilment order references included in their confirmation text. Do not alter a confirmation to bypass duplicate protection. This implementation cannot infer whether different confirmation texts describe the same external shipment without an authoritative external fulfilment event ID.

The extension has no separate allocation ledger and no Admin or Gemini secrets. The server uses the portal's configured Firebase project and Firestore database. Admin SDK writes use server IAM credentials; the browser never writes allocation documents directly. Do not loosen client Firestore rules for this integration.

## Build and tests

Use Node 22.12 or newer:

```sh
npm ci
npm run lint
npm test
npm run build
```

The default suite runs isolated transaction-store tests, extension adapter/DOM tests, permission tests, existing General Auditor/Vaccine Checker tests, and package checks. New coverage includes normal comparison, fulfilment-only partial allocation, aliases, missing allocations, facility/product mismatch, pairing errors, excess quantity, dialog cancel/confirm, authoritative role arrays, inactive sheets/rows, concurrent orders, tracked companions/untracked consumables, receipt lookup, explicit authorization, duplicate clicks/audits/commits, stale inputs, changed balances, read/write failures, a lost response after commit, role restrictions, and cache reloads. These tests do not touch production allocations.

The Firestore integration test uses only a local emulator with project `demo-ordercheck-extension`. It refuses non-local emulator addresses and never imports production credentials. Install Java 21+ and Firebase CLI, then run in separate terminals:

```sh
npx firebase-tools emulators:start --only firestore --project demo-ordercheck-extension --config firebase.emulator.json
```

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 npm run test:firestore
```

It verifies saved sheet and allocation balances, the transaction and activity record, and idempotency after clearing the service cache. Its test documents are deleted afterward. The test skips in the default suite when no emulator is configured. Firebase documents the [local Firestore emulator and demo-project isolation](https://firebase.google.com/docs/emulator-suite/connect_firestore).

The local implementation was tested with an actual Firestore emulator, plus isolated failure simulations. Live Render connectivity, production service-account IAM, Chrome's installed-popup behavior, and external fulfilment events still require a deployment smoke test. No production allocation was deducted during development.

## Deploy to Render and update Chrome

1. Commit the changes and deploy the complete repository to the existing Render Web Service. Use `npm ci && npm run build` as the build command and `npm start` as the start command. Include `extension/` and `firebase-applet-config.json`.
2. Configure `APP_URL` to the service HTTPS origin. Confirm `FIREBASE_PROJECT_ID` matches `firebase-applet-config.json`, and configure `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` only on the server. Preserve existing `GEMINI_API_KEY` and authentication settings. The service account needs Firestore read/write access to the configured database. Do not set emulator variables on Render.
3. After deployment, check `/api/health`, sign into the portal, and verify the facility/cycle list and Allocation Blueprint load. Check Render logs if any read or authentication request fails.
4. Download the new packed ZIP from the portal's Extension tab, extract it, replace the installed extension files, and click Reload in `chrome://extensions`. Confirm the extension version is 1.5.3; refresh capture tabs. For a source-folder installation, select `extension/`, save the correct backend origin, and sign in.
5. Use an approved test facility or isolated staging project for the smoke test. Verify normal General Auditor, vaccine customer comparison, and Fulfilment Only. Select a specific facility/cycle and include that facility in the FS confirmation. An audit alone must leave the Blueprint unchanged.
6. With explicit authorization, confirm one test fulfilment. Refresh the extension and portal and verify identical saved balances. Retry the same event and verify no further deduction. Confirm Compliance users can audit but cannot deduct, and inspect the persisted transaction/activity history. Only then use the extension for authorized real fulfilments.

## Main files

- `server/companionVaccine.ts`: verification, common response fields, immutable evidence, identity, permissions, and commit contract.
- `server/companionFacility.ts`, `server/blueprintFacility.ts`: stable facility resolution, abbreviation normalization and ambiguity safeguards.
- `shared/companionAudit.ts`, `extension/audit-contract.ts`, `extension/audit-contract.js`, `scripts/build-extension.mjs`: shared mode mapping, response types and bundled browser contract.
- `server.ts`: routes, fresh allocation reads, project setting, and reporting integration.
- `server/blueprintConfirmation.ts`: transactional authorization and activity hooks.
- `server/vaccineService.ts`: snapshot revalidation and safe, unique deduction quantities.
- `server/firebaseAdmin.ts`: Firebase project consistency check.
- `extension/vaccine-api.js`, `extension/vaccine.js`, `extension/popup.js`, `extension/popup.html`: modes, facility selection, audit/status rendering, explicit confirmation, and retry controls.
- `extension/backend.js`: accurate HTTP and network errors.
- `extension/manifest.json`, `server/extensionPackage.ts`, `src/App.tsx`: version 1.5.2 and complete packaging.
- `server/companionVaccine.test.ts`, `server/companionVaccine.firestore.test.ts`, `extension/vaccine.test.js`, `server/extensionPackage.test.ts`: regression, persistence, and packaging tests.
- `scripts/test-firestore.mjs`, `firebase.emulator.json`, `package.json`, `README.md`: safe emulator runner and operating instructions.

## v1.5.3 confirmation rejection and loaded-folder check

This update fixes the unconditional retry label after a rejected confirmation. The backend marks a missing/non-boolean authorization with HTTP 400, `code: "FS_CONFIRMATION_REQUIRED"`, `confirmationRequired: true`, and `allocationStatus: "awaiting_confirmation"`. The extension clears consent and restores **Confirm FS Entry & Deduct Allocation**. It also recognizes the earlier deployment's exact error text. HTTP 401/403 clears consent too. A retry label is reserved for a previously confirmed attempt whose outcome remains uncertain; a successful audit alone never calls commit.

The commit response must identify the same `orderId`, `facilityId`, transaction ID and updated facility as the approved audit, with `success: true` and `allocationStatus: "deducted"`. Permissions and the saved audit are checked by the server; the browser's flag is never a replacement for those checks. Blueprint transaction safeguards and business rules are unchanged in this update.

The source extension is `/home/enochohene-darko/ordercheck (3)/extension`; its manifest and popup show v1.5.3. Portal ZIP downloads contain these exact current module bytes and use `Cache-Control: no-store`. To verify the installed copy, open `chrome://extensions`, turn on Developer mode, open OrderCheck Details, and inspect its unpacked extension path and version. Reload that folder after replacing all files, then reopen the popup. Merely rebuilding another source directory does not update Chrome's loaded files. If a ZIP was extracted elsewhere, that extracted folder is the installed source until Chrome is pointed at this workspace's `extension` folder.

The development environment has no running Chrome process or Chrome profile, so its loaded folder cannot be independently identified here. Two other local source copies were found at `/home/enochohene-darko/projects/ordercheck (2)/extension` and `/home/enochohene-darko/ordercheck-backup/extension`, both v1.2.0; they were not modified. No production allocations were used in testing.
