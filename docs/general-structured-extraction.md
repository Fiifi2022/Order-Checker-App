# General Auditor: structured extraction before comparison

The current website flow is **Run Order Verification Audit → internal extraction → comparison → results**. Extraction details are not displayed. The internal submission does not assert CCA approval; genuine uncertainties remain actionable audit findings. See the current presentation rule below. Earlier implementation notes describe the original preview design and retained server safeguards.

## Root causes

- The website previously offered no editable pre-audit stage; extraction and comparison started together.
- Request wording such as “Please additional [approved product] needed” could remain unresolved even with a separate labelled quantity. The new General-specific wrapper strips that wording only when the remaining description is supported by the catalogue. A separate quantity is associated only with one unquantified product and one unambiguous count.
- Short FS preparation headings without “for delivery” could hide an otherwise valid product entry. The wrapper separates those entries before comparison.
- An unread product line could disappear while other parsed entries matched. The structured final gate now retains a product-extraction review until the source entry is corrected or confirmed through the existing CCA flow.

No example names, facilities or medicines were hardcoded.

## Data and comparison

`POST /api/general/extract` is authenticated and General-only. It parses both sources independently using the existing extraction utilities, catalogue vocabulary and facility references. Source-supported FS-assisted name recovery runs only when needed. The response contains separate orderer, facility and individual product/count/unit fields, original order wording and extraction statuses: extracted, not detected, ambiguous or parsing failure. No Gemini call or history write occurs during preview extraction.

The website submits the preview fingerprint, catalogue revision and explicit corrections to `/api/verify`. The server re-extracts and validates the current source and references. Corrected structured fields are projected into the existing General Auditor matcher. Product identity, clinical attributes, quantities, stockout, order-limit and companion rules remain in that matcher; preview confirmation does not establish an uncertain clinical equivalence or waive an unrelated discrepancy.

A product retains its fulfilled quantity and FS-recorded requested quantity separately. Stock headings are preserved per product so partial-stockout context cannot leak between entries. Unknown identical products can pass without catalogue registration or AI. Missing, extra, strength, formulation and quantity differences remain independently checked.

Field extraction and product parsing have separate fallback/error boundaries. A failed field is not labelled missing. Independent available fields remain visible and auditable. Unread product extraction cannot issue GO-AHEAD merely because the other rows match.

## Corrections and privacy

- Edit names, products, counts or units in the preview. Ambiguous identity extraction supports Confirm, Edit and Reject. Uncertain product entries can be edited or rejected.
- Manual changes require acknowledgment and a brief reason. The server records the original extracted values, corrected values, actor and timestamp. Manual extraction history is visible with the audit result and remains available in saved records.
- A source fingerprint and catalogue revision prevent applying corrections to stale messages or aliases.
- The untouched pasted messages remain only in browser memory for reference. Once comparison starts, active sources and saved records contain patient-filtered order text. The original patient-containing draft is not put in local storage, audit history or an AI prompt by this workflow.
- Irrelevant patient names, ages and contacts are removed before extraction JSON, matching, optional Gemini fallback and history persistence. The saved correction evidence contains only the relevant extracted fields and patient-filtered source.
- AI remains an existing fallback after local extraction and matching; its output cannot override deterministic quantity or clinical rules.

## Changed files

- `shared/generalStructuredExtraction.ts`: preview, submission, product/status and correction-history types.
- `server/generalStructuredExtraction.ts`: General-specific normalization, independent extraction, source validation, correction history, structured projection and final review gate.
- `server/generalExtractionPreview.ts`: authenticated, non-persistent preview endpoint handler.
- `server.ts`: endpoint registration and opt-in structured website comparison boundary.
- `src/components/GeneralExtractionPreview.tsx`: structured preview and inline correction controls.
- `src/App.tsx`: mandatory website preview before comparison, cancellation/stale-response handling, session-only original drafts and correction history display.
- `src/utils/generalAuditTypes.ts`: optional saved structured-extraction metadata.
- `server/generalStructuredExtraction.test.ts`: extraction, privacy, UI, CCA correction, quantity/clinical, stockout, unknown-product, quota and final-gate regressions.
- `server/companionVaccine.test.ts`: actual `/api/verify` handler exercised with the structured website submission and in-memory persistence; protected extension flow remains unchanged.

## Validation and limitations

Executed validation:

- `npm test`: **2,071 tests; 2,070 passed, 0 failed, 1 skipped** on the final run (80.83 seconds).
- `npm run lint`: passed.
- `npm run build`: passed, with the existing bundle-size advisory.
- `node --import tsx --test server/generalStructuredExtraction.test.ts server/companionVaccine.test.ts`: 56 focused tests passed after the final extraction changes.

 The new focused suite includes the real preview handler, existing engine, actual verification route, mounted React correction controls and saved-record privacy assertions. The malformed/unread-product clearance regression failed before the final gate was added and passed afterward.

A six-run warm local known-product benchmark measured a median **59 ms extraction + 124 ms comparison**, **183 ms combined engine time**, with **zero AI calls**. These measurements exclude human preview time, network/authentication, database latency and production hosting. Reference freshness is checked again at comparison instead of trusting a stale editable client snapshot.

The new website uses the structured submission. Existing API/extension callers remain backward compatible and do not receive this preview workflow. Vaccine Checker, Blueprint, fulfilment-only and Chrome extension integration behavior were not changed. Existing shared utilities were reused without altering their behavior.

No production deployment, push, live Firebase write or paid live AI request was performed. Local API tests use in-memory persistence; they do not verify Railway/Firestore availability. Ambiguous or absent source evidence still requires CCA action. Arbitrary unsupported narrative formats can remain unresolved; this is not a guarantee of perfect extraction.
# Current presentation rule — 4 November 2026

Extraction is internal in the website General Auditor. **Run Order Verification Audit** performs independent extraction and automatically submits the structured fields for comparison. There is no extraction preview, second comparison button, raw-draft panel or extraction-history panel in the normal interface. The existing extraction endpoint, source fingerprints, server re-extraction, original evidence and final validation remain in use.

Internal submission contains no manual edits, no confirmed fields and no CCA acknowledgment. Uncertain fields remain uncertain and use the normal audit findings and decision controls. Internal patient-data sanitization must not invalidate or abort its own audit; actual user input changes still invalidate outstanding work. The detailed extraction state remains available to the engine, and the “What we understood” diagnostic panel is hidden in website and extension report rendering.

The implementation notes below describe the earlier editable-preview design and its underlying server safeguards; this presentation rule supersedes that user-facing step. Browser regression coverage now verifies automatic continuation, invisible extraction details and sanitization without cancellation.

Validation for the internal flow: 2,090 tests passed, zero failed and one optional emulator test skipped; build and TypeScript passed. All 12 real React/Express Chromium scenarios passed, including sanitization without self-cancellation and a patient-only source returning to an enabled audit button without sending a comparison.

Railway deployment `d0aa03c4-878c-42fb-9445-45a2005b90ac` reached SUCCESS. Its build independently passed the same 2,090 tests. Production health passed, and served asset `index-DLUq4b9D.js` contains the single audit button and no extraction-preview, second-comparison, “What we understood” or manual-extraction-history panel strings. No Git push was made. Installed extension files require their usual reload/update to pick up the report-rendering change; the website update is live.
