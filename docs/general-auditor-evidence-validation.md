# General Auditor evidence validation fix

Branch: `addition_of_vaccine`. Implemented locally on 2026-10-30. No commit, push, merge or deployment.

## Result for the reported request

For the customer message containing patient contact, NHIS status, age, Kpasenkpe Polyclinic and “Quantity needed: 2 vial”, compared with the Snake Venom Antiserum `[2/2]` confirmation:

- Facility matches when the directory contains the approved Kpasenkpe PC alias.
- Customer orderer and product remain absent; neither is copied from FS.
- The quantity declaration remains evidence requiring product association.
- Exactly one real FS product card appears, with the customer product marked “Not provided”.
- Requested product types: 0; FS product types: 1; confirmed discrepancies: 0.
- Verdict: **REVIEW REQUIRED**. Confidence stays below 100% because compulsory evidence remains unverified.
- Patient contact, NHIS status and age never become product cards or discrepancies.

## Root causes and fixes

1. Patient possessive contact labels and NHIS status were not classified as excluded metadata. Product extraction could interpret the contact number as a quantity or the insurance text as an unknown product. Shared classification now excludes these fields while preserving explicit product clauses in mixed text. Gemini snippets use the same exclusion step.
2. “Quantity needed” was not recognized as a quantity field. Quantity labels and standalone unit-bearing quantities now remain quantity evidence, never product identities. Deterministic association runs for quantity declarations, with ambiguous or unassociated quantities retained as reviews.
3. The name-only fallback accepted arbitrary ambiguous lines as products. It now requires structural product evidence or catalogue recognition. Genuine unknown product requests remain review candidates.
4. A missing customer product list made a real FS product appear to be confirmed extra cargo. This now requires customer-product confirmation, retaining the FS evidence without inventing a request.
5. Unresolved identity handling could also suppress a catalogue-backed explicit strength conflict. Confirmed clinical conflicts remain discrepancies; two descriptions lacking authoritative identities remain under review.
6. Final server and current client-response validation reject metadata-derived products and repeated assignments of the same source evidence. Confidence cannot reach 100% while a compulsory review or order-limit decision is pending.

Catalogue matching remains authoritative. Gemini proposals do not approve themselves or create permanent clinical equivalences. Stockout, partial-stockout, approved order-limit, facility/orderer, quantity and vaccine companion checks remain covered by the existing suite.

Existing expandable product cards now expose original source lines when uniquely identifiable, retained extraction provenance, canonical catalogue IDs, matching methods, requested and supplied quantities, FS reference quantities, operational exceptions and decision reasons. The website and extension use the same evidence formatter.

## Changed files

| File | Change |
| --- | --- |
| `src/utils/generalTextClassification.ts` | Metadata exclusion and explicit pre-audit line roles. |
| `src/utils/generalDocumentStructure.ts` | Quantity-needed labels and standalone quantity structure. |
| `server/generalOrderExtraction.ts` | Safe quantity association, original quantity evidence and orphan reviews. |
| `server/generalHybridExtraction.ts` | Shared metadata filtering before Gemini snippets. |
| `server/generalProductNameAudit.ts` | Catalogue-gated extraction, absent-request review, clinical conflict distinction, source evidence and final validation. |
| `src/utils/generalAuditor.ts` | Shared review classification, confidence guard and provenance fields. |
| `src/utils/generalAuditTypes.ts` | Confirmed clinical identity-conflict flag. |
| `src/utils/generalProductEvidence.ts` | New shared evidence validation and explanation formatter. |
| `src/utils/generalAuditRun.ts` | Validate current server product evidence before accepting a client result. |
| `src/components/GeneralInventory.tsx` | Expanded decision evidence and accurate absent-customer wording; preserves the earlier missing-verification crash fix. |
| `extension/general-auditor-entry.ts` | Export shared product decision evidence. |
| `extension/general-report.js` | Matching evidence and absent-customer wording in the extension. |
| `extension/general-auditor.js` | Regenerated shared audit/UI bundle. |
| `extension/order-limits.js` | Regenerated bundle containing the shared General Auditor rules. |
| `server/generalEvidenceValidation.test.ts` | 27 new regression tests covering the reported example and required safeguards. |
| `server/generalInventory.test.ts` | Preserved two uncommitted regression tests from the preceding render-crash fix. |
| `docs/general-auditor-evidence-validation.md` | This implementation and validation report. |

`server/generalAuditor.ts` continues to re-export the shared engine; no duplicate implementation was introduced.

## Validation

- `npm run lint`: passed.
- `npm test`: 1,423 tests; **1,422 passed, 0 failed, 1 skipped**.
- The skipped Firestore integration test requires `FIRESTORE_EMULATOR_HOST`; live Firestore persistence was not exercised by this run.
- The final focused inventory/evidence run: **33 passed, 0 failed**. This includes client mounting/rerun regression tests and both website and extension rendering.
- `npm run build`: passed, including regenerated extension helpers. The existing large JavaScript chunk warning remains.
- `git diff --check`: passed.

## Remaining limits

- An absent customer product or orderer still needs source correction or confirmation. FS information and AI guesses cannot supply missing evidence.
- Facility abbreviations depend on the approved directory mapping; this change does not create a global PC equivalence or modify live directory data.
- Unsupported product identities and ambiguous quantity associations remain reviews. Explicit catalogue-backed clinical conflicts remain discrepancies.
- No production deployment, Chrome installation reload, live allocation changes or live Firestore write was performed for this change.
