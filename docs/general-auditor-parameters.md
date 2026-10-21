# General Auditor: required and optional verification parameters

Implemented in the existing General Auditor pipeline. No new application or duplicate result component was created. No commit, GitHub push, Render service or deployment change was made.

## Validation rules

| Parameter | Requirement | Both values present | Either value absent |
| --- | --- | --- | --- |
| Name of Orderer | Mandatory | Existing case/spacing/punctuation and supported name normalization; actual differences are discrepancies | Missing Required Information; approval blocked; not a confirmed mismatch |
| Name of Health Facility | Mandatory | Existing 1,509-record reference, verified aliases, identifiers and facility-type safeguards | Missing Required Information; approval blocked; not a confirmed mismatch |
| Delivery/Drop Area | Optional | Deterministic formatting comparison; conflicting values produce Location Mismatch and require review | Optional — Not Provided, including the missing side; no warning, discrepancy or confidence penalty |
| District | Optional | Deterministic formatting comparison and explicit verified alias mappings; conflicting values produce District Mismatch and require review | Optional — Not Provided, including the missing side; no warning, discrepancy or confidence penalty |
| Products and Quantities | Mandatory | Existing clinical synonyms, specifications, units, quantities, stock and order-limit rules | Source-backed missing/extra product discrepancies retained; an absent product list is also marked missing required information; no fabricated quantities |

Missing mandatory identity information is now tracked separately from `issueCount` through `auditSummary.missingRequiredCount` and `reviewRequiredCount`. It lowers verification confidence and blocks `allMatch`, including after an order-limit answer. An omitted optional value is not counted as a passed check or a failed check. Genuine optional conflicts each contribute one discrepancy and request manual review. Multiple conflicting explicit values within an optional field require review when both sides provide the field; the auditor does not simply select a convenient value.

District comparison accepts punctuation/spacing and administrative naming suffixes such as “West Mamprusi” and “West Mamprusi District.” The same normalization is applied to district evidence used to identify facilities, avoiding false facility reviews for those formatting variations. Arbitrary spelling similarity is not accepted as an alias. A trusted reference can supply `facilityContext.districtAliases` with canonical names and verified aliases; no unverified real-world district aliases were invented or added to the data.

Customer names in explicit “This is …” / “I am …” orderer phrases can be extracted independently from the facility. A typed facility name, or the same facility value copied into both identity fields, is not accepted as an orderer's name. Placeholder values such as N/A, unknown, not available and not specified are treated as absent.

The existing identity/order result component now displays all five parameters and the requested statuses. Existing product-level details, stock groups, order-limit prompts and phone checks are retained. Missing optional fields use a neutral display. Unrelated unresolved text can block the whole audit for manual review while leaving the Products and Quantities parameter and confidently matched product rows verified.

The optional comparisons survive semantic fallback, accepted server-response reconciliation, duplicate-product repair and order-limit confirmation. Original source values are rechecked after semantic interpretation; Gemini or a server response cannot waive explicit location conflicts or required identity information. The legacy General-only semantic gate also still requests interpretation for an empty deterministic product extraction rather than treating an empty list as resolved.

## Scope and preservation

The clinical product matcher, quantity conversion tables, stock recognition and order-limit decision rules were not changed. Vaccine Checker and Allocation Blueprint source components, editing-history logic, authentication/sign-in files, Firebase rules, credentials, deployment configuration and dependencies were not edited for this task.

The normal production build regenerates `extension/order-limits.js` from the shared General Auditor acknowledgement rules. This keeps existing extension acknowledgements compatible with the new fields; no extension connection, authentication, messaging or Fulfilment System integration code was changed for this task. Existing operational final-status text for out-of-stock and order-limit outcomes remains intact.

The General rule-diagnostics self-checks were given explicit required names so those probes continue testing product/stock behaviour. History and analytics algorithms were not changed. Product-only automated fixtures likewise now supply required names; missing-information tests continue using the actual auditor without injected headers.

## Validation

- Full automated suite: **601 tests, 600 passed, zero failed, one skipped**. The skipped test requires a Firestore emulator unavailable in this environment.
- Added **25 parameter regression tests** covering all requested scenarios, both missing sides, placeholders, verified district-alias mappings, source enforcement, order-limit recomputation and unrelated unresolved text.
- All **1,509 facilities** exercised again: **4,531 checks passed**, no failures or false verified matches. This is directory consistency testing, not independent verification of the source data.
- TypeScript check (`npm run lint`) passed.
- Production build (`npm run build`) passed with the existing large-chunk warning.
- Actual Chromium → React/AuthGate → Express → rendered-results validation passed: omitted fulfilment location/district fields still verified the audit; both location conflicts appeared; a missing orderer blocked approval. Zero browser errors.
- The same local browser run also checked exact products without Gemini, synonyms, quantity and clinical-specification differences, stock, order-limit acknowledgement, facility/orderer mismatch, ambiguous facility review, a valid audit exceeding three seconds, the extension backend client, and vaccine confirmation/retry. The fresh allocation balance changed 20 → 17 and remained 17 on retry.

The browser tests use explicitly isolated synthetic Firebase identity/storage providers. They do not prove deployed Render behaviour, live-user sign-in or real Firestore transaction execution. No production documents were written and no real Gemini requests were made. These changes add no Firestore queries and retain the previous read/performance optimizations. No production-readiness claim is made from these local checks.

Machine-readable evidence: `docs/validation/general-parameter-results.json`. Browser raw output and facility sweep results are retained locally at `/tmp/ordercheck-parameters-browser/results.json` and `/tmp/ordercheck-parameters-facilities.json`.

## Files modified or added for this task

Runtime code and presentation:

- `src/utils/generalAuditor.ts`
- `src/utils/generalAuditTypes.ts`
- `src/utils/generalFacility.ts`
- `src/utils/generalAuditRun.ts`
- `server/generalSemanticAudit.ts`
- `server/auditSemantics.ts` — General-only empty-extraction fallback condition
- `server/generalAuditMonitoring.ts` — rule-diagnostics fixture headers only; history/analytics untouched
- `src/App.tsx` — General Auditor result badge and review guidance only
- `src/components/GeneralAuditDetails.tsx`
- `src/components/GeneralFulfillmentSummary.tsx`
- `src/components/GeneralVerificationConfidence.tsx`
- `extension/order-limits.js` — generated by the existing build

Tests and validation:

- `server/generalAuditParameters.test.ts` — new
- `server/generalProductTestFixtures.ts` — new product-only test helpers
- `server/auditSemantics.test.ts`
- `server/generalAuditConfidence.test.ts`
- `server/generalAuditFlow.test.ts`
- `server/generalAuditFulfillment.test.ts`
- `server/generalAuditPairing.test.ts`
- `server/generalAuditScope.test.ts`
- `server/generalAuditStockPresence.test.ts`
- `server/generalAuditUpgrade.test.ts`
- `server/generalAuditor.test.ts`
- `server/generalIdentityValidation.test.ts`
- `server/generalMedicalTerminology.test.ts`
- `server/generalOrderLimitConfirmation.test.ts`
- `server/orderLimitAcknowledgement.test.ts`
- `server/generalDiscrepancyBanner.test.ts`
- `scripts/validate-browser-workflow.mts`

Documentation/evidence:

- `docs/general-auditor-parameters.md`
- `docs/validation/general-parameter-results.json`

Other pre-existing uncommitted workspace changes have been retained. The list above identifies this task's changes rather than claiming the entire dirty working tree belongs to this task.
