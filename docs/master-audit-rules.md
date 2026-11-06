# Master audit baseline

General Auditor compares the original Customer Request with the original FS
Confirmation. Only facility, orderer, products and quantities determine clearance.
District and drop location remain informational. Catalogue membership is not a
clearance requirement.

## Direct comparison

Each source is parsed independently. `shared/generalDirectProduct.ts` creates an
audit-local identity for matching written descriptions, preserving word boundaries,
numbers, decimals, ratios and clinical qualifiers. Case, spacing and harmless
punctuation do not introduce a discrepancy. Explicit clinical/device attribute
conflicts prevent direct equivalence. Existing catalogue IDs are reused when
appropriate; the source identity is never presented as a catalogue ID.

Unknown matching descriptions therefore pass normal deterministic quantity
validation without Gemini, a registration write or a forced catalogue edit.
Duplicate lines aggregate quantities. Product order is immaterial. Unexplained
quantity differences remain discrepancies; existing stockout and approved order-limit
exceptions continue to apply. An unknown product omitted entirely from the other
readable source remains a genuine omission. Unknown alternate descriptions remain
uncertain rather than being paired by elimination.

## Suggestions and confirmation

When direct comparison is insufficient, existing catalogue identities, approved
aliases and facility references resolve safe matches first. Controlled local
suggestions, cached evidence and bounded Gemini research support unresolved cases.
Optional public grounding retains the existing medical-term privacy boundary;
customer identity research never uses public search.

Both interfaces have one Review Suggestions section for uncertain facility,
orderer and product comparisons. It reuses the existing inline identity/product
controls, presents actual source values, explanations and evidence, and provides
confirmation, rejection and Search Again. Existing verified results remain visible.

Uncatalogued alternate product descriptions can be explicitly confirmed against
an actual FS entry. The approval records the CCA, time, original values and source
fingerprint on the same audit. It never registers a product or silently adds a
clinical equivalence. Confirmation reuses deterministic reconciliation and summary
validation; it cannot waive quantities, missing/extra products or unrelated identity
findings. Old unresolved provenance and diagnostic flags are replaced with current
evidence. Rejection/Keep Discrepancy cannot result in clearance.

Existing catalogue-backed approvals still save aliases through the transaction
and reuse them in later audits. New products need no registration to complete a
valid audit. Permanent unknown-to-unknown equivalences are not invented: an
administrator can explicitly create a verified catalogue entry and aliases using
the existing catalogue workflow when desired.

CCA-confirmed facility aliases persist only when exactly one active, verified
facility reference can anchor the alias. Conflicting IDs, ambiguous references and
rejections do not create aliases. Change Decision on the originating audit withdraws
its learned alias while retaining history. Directory removal prevents reuse.
Customer partial-name confirmations remain audit-specific; prior evidence can
suggest a future match but does not automatically identify another person.

## Final validation

The shared `summarizeGeneralProducts`/`generalFourParameterRecord` gate remains
authoritative. Required identities, source readability, accounted-for products,
deterministic quantities, clinical conflicts, pending confirmations and approved
exceptions determine the outcome. Finishing research or approving a product name
does not itself grant clearance. Both original messages and the audit ID remain
unchanged through confirmation.

## Changed implementation

- `shared/generalDirectProduct.ts`: direct identity and audit-local confirmed pairs.
- `server/generalProductNameAudit.ts`: direct comparison, no automatic product
  registration, genuine omissions, quantity validation and current provenance.
- `server/generalSourceProductConfirmation.ts`: source candidates and same-audit
  approval without catalogue registration.
- `server/productResearch.ts`, `generalCatalogueAi.ts`, `productResearchActions.ts`:
  guarded source suggestions, research and original-value metadata.
- `server/generalCatalogueConfirmation.ts`: retain source approvals and refresh
  response verdict fields when a catalogue match is confirmed.
- `server/generalIdentityResearch.ts`, `server.ts`: bounded identity retry, source
  approval transactions and verified facility alias persistence.
- `server/generalFacilityAliasApproval.ts`, `generalFacilityDirectory.ts`,
  `shared/generalFacilityDirectory.ts`: anchored aliases and withdrawal/history.
- `shared/productResearch.ts`, `productResearchClient.ts`, `generalResolutionQueue.ts`:
  optional source candidates, identity retries and confirmed-state reporting.
- `src/utils/generalAuditor.ts`, `generalAuditTypes.ts`, `generalProductEvidence.ts`:
  numbering, approval evidence and accurate source-match labels.
- `src/App.tsx`, `GeneralInventory.tsx`, `GeneralAuditDetails.tsx`,
  `GeneralCatalogueSuggestions.tsx`, `extension/general-report.js`, rebuilt bundles:
  consolidated inline suggestions in both clients.

## Verification and limits

`server/generalMasterRules.test.ts` adds 34 regression cases. Facility alias tests
cover uniqueness, reuse, rejection, withdrawal and preservation through directory
edits. The production confirmation callback is also exercised with simulated
transactions, including source approval without catalogue writes. Existing tests
were retained; cases that previously required registration or rejected identical
unknown descriptions now enforce this master rule. Presentation-only unresolved
tests use genuinely different source descriptions instead.

The release gate builds the app/extension/server, type-checks and runs the full
regression suite, including vaccine companions, Blueprint deductions, stockouts,
order limits, unavailable grounding, 429 errors, timeouts and confirmation races.
Tests use mocks; no real Gemini searches, production audits or deductions are made.

No new package, API credential or billing plan is required. Google Search remains
opt-in. Message/OCR extraction is still bounded and can require clarification when
the source is unreadable. Uncertain clinical equivalences require CCA verification.
Automatic product registration is disabled in the audit path. Existing manually
managed catalogue entries are unchanged. This update has not been deployed.
# Comparison-first follow-up — 2026-11-04

## Wrapped FS administrative text fix

The reported `BY537XPG5D` example was found verbatim in the nominal dispatch
scenario. PDF/copy line wraps split receipt, preparation and support-contact
sentences into fragments. The extraction completeness check incorrectly treated
those fragments as unread product information.

`server/generalFourFieldInput.ts` now projects complete standard FS phrases
across whitespace wraps before the website General Auditor extracts fields.
Receipt/order-ID, tracking, delivery-window, support-contact, SMS and generic
stock-remainder notifications cannot become product reviews. Person/facility
names in the greeting, product lists, stockout headings and actual amendments
to the four required fields remain available. Original source messages on the
saved audit are not rewritten. The existing scoped General Auditor pipeline
and instruction version were updated; other audit callers keep their defaults.

`server/generalFourFieldInput.test.ts` adds ten regressions, including the exact
nominal scenario, arbitrary whitespace wraps, wrapped stockouts, correct
identity retention, and preserved customer/facility/product/quantity errors.
All ten passed without live Gemini calls. This fixes the parser rather than
hiding the review card or permitting unread actual products to clear.

The full local release gate passed: **1,929 passed, zero failed, one optional
Firestore-emulator skip**. Railway deployment
`4458bde9-3fd7-44dc-9f91-e0f0b70c24fa` succeeded on 2026-11-04 and the live
health endpoint returned HTTP 200. Existing saved results are historical;
rerun their original messages to apply this corrected parsing.

The mandatory baseline remains the customer request versus the fulfilment
confirmation: facility, orderer, product names and quantities. Catalogue absence
is not a failure. Identical normalized source products still pass without Gemini
or registration, while quantity differences and unrelated identity discrepancies
remain blocking until correctly resolved.

The website General Auditor previously excluded any catalogue-`recognized`
description from suggestion research, including labels that matched multiple
products and therefore had no resolved identity. Its dedicated website profile
now distinguishes **recognized** from **resolved**. Ambiguous source descriptions
with overlapping approved aliases receive a local selectable source suggestion.
They are not automatically matched. No Gemini request is needed to show that
supported local relationship. The agent can Confirm & Resume or reject it using
the existing controls. The confirmation applies to this audit and cannot waive
quantity, facility, customer or other product findings. Conflicting clinical
attributes and rejected alias mappings cannot authorize these suggestions.

Changes: `server/generalComparisonSuggestions.ts`,
`server/generalProductNameAudit.ts`, `server/generalAuditorInstructions.ts`,
`server/generalComparisonPriority.test.ts` and this report. Default extension,
Vaccine Checker and other non-profile callers retain their prior behavior.
No database migration, API endpoint, allocation logic, catalogue data or UI
redesign was introduced. The removed progress bar remains removed.

Validation: build and TypeScript passed; all **1,919 tests passed**, with zero
failures and one optional Firestore-emulator skip. Railway independently passed
the same checks. Production deployment
`62f80a48-b113-4072-8c82-c8af167e8850` succeeded, including its health check;
the live `/api/health` returned HTTP 200. No production audit or allocation
deduction was submitted for verification.
