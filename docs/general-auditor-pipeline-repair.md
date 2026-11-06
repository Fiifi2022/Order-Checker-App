# General Auditor root-cause repair and regression gate

## Confirmed failures

All three categories were reproduced with failing tests before their fixes, using local fixtures and no Gemini calls.

| Failure | Source | Why earlier checks missed it | Repair |
|---|---|---|---|
| Confirming an unread quantity restored a previously recognized MR diluent as an extra item and kept a valid audit uncleared. | `applyGeneralReviewConfirmation` used the ordinary catalogue resolver while initial comparison and name confirmation used the General accessory resolver. | Accessory tests covered initial comparison and product-name confirmation, but not the product-and-quantity confirmation path. | All three CCA product mutation adapters now use `revalidateGeneralAuditEvidence` and the same reconciliation core. |
| A current-engine response could display a green headline while its actual quantity checks still required confirmation, or retain a red headline after all checks passed. A stale `resolved` flag could also disagree with the recalculated result. | The current-engine early return in `completeGeneralAuditRun` checked evidence integrity but accepted separately stored summary fields. | Canonical-ID and duplicate-evidence checks do not validate headline/counter consistency. | Rebuild the four-parameter final gate from retained server checks before displaying current catalogue-engine results; synchronize the current run's resolved/pending state and clear obsolete clearance notes. |
| Product evidence displayed the normalized projection rather than the customer's original wording, e.g. `PCM - 2` instead of `1) PCM = 2`. | Structured preview was projected into comparison text, which became `sourceOriginalText`. | Original messages existed in the preview, but the per-item evidence display was not tested across the projection boundary. | Restore original source wording by source, product, quantity and occurrence at structured finalization. Keep parsed comparison evidence intact. |

The new tests are in `server/generalPipelineRegression.test.ts`. They are reusable flow tests, not new aliases or special cases for the reported customers. The quantity-confirmation test also verifies same-ID idempotency and current accessory association results.

## Production execution trace

The current website uses the following stages. Source text is parsed independently on each side; no FS customer name, product or quantity is used to fill an absent request value.

| Stage | Functions and modules actually used |
|---|---|
| Input and preview | `App.prepareGeneralExtraction` calls authenticated `/api/general/extract`; `generalExtractionPreviewHandler` calls `extractGeneralStructuredPreview`. |
| Separate source extraction | `cleanGeneralStructuredSource`, internal `extractSource`, `extractGeneralOrderDeterministically`, `recoverGeneralOrderer`, `locateGeneralCustomerFacility`, `locateGeneralSystemFacility`, `locateGeneralSystemOrderer`, `parseGeneralProducts`. Supporting modules: `generalDocumentStructure`, `generalSentenceExtraction`, `generalTextClassification`, `generalOrderRelevantText`, `projectFourFieldFulfillment`, and `prepareGeneralVaccineList`. Patient/contact data is removed before saved/AI data; district and dropsite remain non-audit fields. |
| Reviewed extraction submission | `GeneralExtractionPreview` → `App.compareStructuredExtraction` → `/api/verify`. The server recomputes extraction against current sources/catalogue and validates the fingerprint, catalogue revision and corrections using `applyGeneralExtractionSubmission`. `projectGeneralStructuredSource` supplies the reviewed fields to comparison. Original structured entries and correction history are retained. |
| Comparison normalization | `runGeneralProductNameAudit` applies four-field fulfilment projection, `projectGeneralFulfillmentSections`, blood-field projection where applicable, deterministic extraction/readability checks and its internal `extractNames`, which uses `parseGeneralProducts`. `generalVaccineListHeading` instructions are not product lines; explicit list units survive. |
| Direct identity and presentation separation | `directProductMatch` / `directProductKeys` and `catalogueProductVariantKeys` in `shared/generalDirectProduct.ts`. Identical unknown source names can pass without catalogue registration. Stated strength, size, concentration, formulation and syringe identity remain material. |
| Catalogue / approved alias lookup | `createGeneralCatalogResolver` / `resolveGeneralCatalogIdentity`, alias-decision filters, and `createGeneralAccessoryResolver`. `generalVaccineCounterpart` and `buildGeneralAccessoryCatalog` preserve approved primary/accessory relationships. Local candidates come from `localSourceComparisonSuggestions` / `generalVaccineIdentityChoices`, with `scopeGeneralFsSuggestion` limiting choices to relevant FS entries. |
| Product reconciliation | `reconcileCatalogueEvidence` → `compareAssignedGeneralProducts` → `assignGeneralProductGroups`. Matching identities consume their FS groups once. Ambiguous related descriptions remain review findings; they do not establish equality. `assertGeneralProductEvidence` checks conflicting identities/strengths and evidence reuse. |
| Numeric business rules | `compareAssignedGeneralProducts`, `generalQuantityBasis` / approved packaging factors, explicit stock-section/ratio handling, order-limit decisions, plus `reconcileGeneralQuantityStatus` and `calculateGeneralAuditSummary`. Neither AI nor a confirmed name match can approve an unrelated numerical mismatch. Existing 0/N, partial-stockout, list numbering and order-limit rules are retained. |
| Vaccine accessories | `prepareGeneralAccessoryItems` and `applyGeneralVaccinePairing`, using the complete FS list, canonical identities and existing `CLINICAL_PAIRINGS` / `vaccinePairingFailure`. Accessories are independent components, not vaccine aliases. Known accessories need no AI. |
| Identity checks | `compareGeneralFacilities`, `smartIdentityField`, `matchGeneralOrdererNames` / existing orderer comparison and `recoverGeneralOrderer`. Reordered meaningful names and verified aliases follow existing rules; uncertain names stay subject to CCA decisions. |
| Final discrepancy publication | `summarizeGeneralProducts` generates product/identity findings, counts, confidence and the final four-field gate. `finishGeneralStructuredAudit` retains unresolved extraction and original per-item evidence, then calls `generalFourParameterRecord`. `completeGeneralAuditRun` now revalidates the current catalogue-engine summary before rendering. |
| Rendering | `GeneralInventory`, `GeneralCatalogueSuggestions`, `GeneralIdentityCard`, `GeneralReviewConfirmation`, `GeneralAuditDetails` and `GeneralVaccineAccessories` render the resulting comparisons and inline actions. |
| CCA continuation | Name equivalence: `applySourceProductConfirmation`; durable approved aliases: `applyCatalogueConfirmation`; source quantity review: `applyGeneralReviewConfirmation`. All use `revalidateGeneralAuditEvidence` → the same `reconcileCatalogueEvidence` core and final summary. No raw-message re-extraction or AI call is introduced during a decision. Identity decisions use `applyIdentityDecision`; order limits retain their existing deterministic decision handler. |

### AI paths and legacy implementations

Optional initial extraction assistance uses `resolveGeneralOrderExtraction` / `generalHybridExtraction`. Unresolved product analysis uses `generalCatalogueAiCandidates`, catalogue AI instructions, `researchProduct`, `researchProducts`, and optional `groundResearchGroup`. Facility/orderer assistance uses `suggestGeneralFacility` and `resolveGeneralOrdererName`. Deferred UI research uses `productResearchActions` and `researchPendingIdentities`. Suggestions never establish numerical equality or independently approve catalogue aliases.

The legacy `runGeneralAuditor` still supplies identity/scaffolding to the catalogue auditor and serves compatibility paths. Its preliminary product array is replaced by catalogue reconciliation before the current-engine result is returned; only relevant order-change reviews are carried forward. Older browser response compatibility remains separate. This repair does not remove those modules or redirect Vaccine Checker/fulfilment-only processing through the General pipeline. The new final publication behavior applies to `general-catalog-v3`, preserving the older product-name-only compatibility branch.

### State and cache controls

Catalogue resolution caches use catalogue signatures/revisions. CCA revalidation rebuilds from the current catalogue and rejects deactivated/rejected aliases. Retained source evidence, stock exceptions and order-limit decisions survive a same-audit update. Source fingerprints, mutation locks, decision revisions, audit-run revisions and abort checks continue protecting against changed inputs and late AI responses. The new publication check addresses stale result summaries; it does not accept AI interpretation as business-rule authority or rewrite historical audit records.

## Files changed in this repair

- `server/generalAuditRevalidation.ts`: one post-extraction product revalidation adapter.
- `server/generalReviewConfirmation.ts`, `server/generalSourceProductConfirmation.ts`, `server/generalCatalogueConfirmation.ts`: reuse that adapter.
- `server/generalStructuredExtraction.ts`: original per-entry evidence survives projection.
- `src/utils/generalAuditRun.ts`: recalculate current-engine publication and synchronize current status.
- `server/generalPipelineRegression.test.ts`: failing-before / passing-after flow regressions.
- `scripts/test-general-auditor.mjs`, `package.json`: `npm run test:general` automatically includes every General test plus catalogue/research/real-route/shared dependency controls.
- `scripts/test-general-auditor-browser.mts`, `scripts/validation/firebase-admin.fixture.ts`: real Chromium + React + Express workflow, using existing isolated authentication/storage fixtures; fixture now supports the SDK's document-reference method used by confirmation transactions.
- `.github/workflows/ci.yml`: browser workflow gate follows the existing build/type/full-test release gate.
- This report. The build regenerates the existing extension bundle; no vaccine/allocation policy or catalogue data is changed.

## Regression and browser gates

`npm run test:general` covers 111 suites: standalone Osman Ishak, Joseph Gumah accessories, Folic acid scoped candidates, aliases, name reversal/spelling, unknown identical products, clinical differences, ratio counts, stockouts, limits, omissions/extras, CCA actions and stale asynchronous decisions. Existing tests remain in place. `npm run verify:release` continues building the current generated engine, type-checking and running all server/extension tests. Both CI and Docker already use that full gate.

`npm run test:general:browser` builds the actual application and complete Express server against isolated Firebase providers. Chromium submits text, opens the structured preview, compares it, selects the relevant vaccine candidate, confirms inline on the same audit, retains a product discrepancy, approves an explicit order limit and checks rendered results. Gemini is deliberately unavailable. It runs in CI after browser installation; any assertion failure gives a failing job. Repository branch-protection settings were not changed or verified.

The older broad `scripts/validate-browser-workflow.mts` contains historical UI/optional-location expectations and is not the authoritative General workflow gate. The new narrow gate follows the current structured-preview flow without rewriting its Blueprint coverage.

## Production verification limits

A read-only request to `https://ordercheck-production.up.railway.app/api/health` returned `{"status":"ok"}`. Its HTML referenced `index-NNPvuqZp.js` / `index-DikT78PQ.css`, different from the local tested build. Production therefore has not been verified as this tested frontend. The health response has no backend commit identifier, so the deployed backend's exact source revision cannot be established through that endpoint.

No production audit, allocation, catalogue, authentication or Gemini operation was used as a test. Browser Firebase providers are synthetic, not live Firebase authentication or a Firestore emulator. Live model availability, live persistence, deployed backend/frontend correspondence and production proxy/browser-cache behavior remain unverified. No push, merge or deployment was performed.

## Final results — 4 November 2026

- Failing-before evidence: the new quantity-confirmation test and both stale-headline tests failed before repair. The original-wording test failed separately (`PCM - 2` versus `1) PCM = 2`). The stale resolved-state assertion also failed before its correction.
- Focused initial confirmation/accessory/suggestion suites: **56 passed, 0 failed**.
- Dedicated General gate (`npm run test:general`): **1,524 passed, 0 failed** across 111 suites.
- Final complete release gate (`npm run verify:release`): production website/server/extension build passed, TypeScript passed, **2,090 tests passed, 0 failed, 1 skipped** (2,091 total). The skipped test requires an explicitly running Firestore emulator. The existing frontend bundle-size warning remains.
- Final Chromium gate (`npm run test:general:browser`): **10 scenarios passed**, no browser errors. It checks standalone and reversed names, identical unknown products with numbered ratio quantities, stockout, all vaccine accessories with MR identity review, inline same-audit confirmation, product-scoped Folic acid suggestions, retained CCA discrepancy, unapproved quantity reduction, explicit saved order-limit approval, and strength differences. The final rendered result is also captured after its entrance animation completes.
- The complete suite includes protected Vaccine Checker, companion/fulfilment-only, extension, Blueprint, allocation and deduction controls. No policy or data changes were made to those modes.
- Local final frontend assets: `index-BE4lWo6Y.js` / `index-CHoBXqVy.css`; the read-only production response referenced different assets. Environment differences can also affect asset hashes; this is not backend revision attestation.

Local browser artifacts: `/var/folders/vf/vfwm1skn7mg5wz760gswxlq00000gp/T/general-audit-browser-2tDlze/` (`results.json`, `final-results.png`, `server.log`). These are isolated test artifacts, not production audit records.

No required tests remain failing. Live Firebase/model behavior, exact deployed backend revision and production correspondence remain unverified as described above. These controls prevent the reproduced regression categories; they do not constitute a guarantee of zero future bugs.

## Authorized production deployment — 4 November 2026

After the user authorized deployment, the workspace was uploaded directly to the existing Railway production service. No Git push or merge was performed.

The first build (`80ff9515-1d40-479b-a6fd-d2b0cbf36c6c`) was correctly blocked by a timing regression test. `server/generalAuditSpeed.test.ts` mocked `Date.now`, but the production budget uses `performance.now`; a slower build worker therefore exhausted real test time before the expected second call. The test now controls the correct monotonic clock. Production deadlines and audit rules were not relaxed. Its nine focused tests and TypeScript checks passed before retrying.

Deployment **`4df63396-7d28-4240-b0dc-a5effbff4378`** reached **SUCCESS** on the existing `ordercheck` production service. Its Docker build passed the production build, TypeScript and all **2,090 tests**, with zero failures and one optional emulator test skipped.

Post-deployment checks at `https://ordercheck-production.up.railway.app`:

- Health endpoint: HTTP 200, `{"status":"ok"}`.
- Production page: HTTP 200.
- JavaScript `index-bxyPGYIN.js` and CSS `index-DikT78PQ.css`: HTTP 200 and both match the asset names emitted by this exact Railway deployment's build. Local and container asset hashes differ, so verification used the container build output.
- Anonymous Product Catalogue access: HTTP 401, preserving authentication.
- Real Chromium on the production URL rendered “Welcome to OrderCheck” with zero browser errors.

This follow-up supersedes the pre-deployment status above. Authenticated production audits, live Gemini responses and real Firestore audit writes were not tested or created during deployment. Local isolated browser coverage remains the evidence for those interaction flows.
