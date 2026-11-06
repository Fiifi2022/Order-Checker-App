# General Auditor vaccine accessory correction

## Scope

This change is enabled only for the website General Auditor's customer-request versus fulfilment comparison. Vaccine Checker, Blueprint allocation and deductions, fulfilment-only and companion modes keep their existing rules. No production catalogue records were changed, and nothing was pushed or deployed.

## Root causes

The supplied order reproduced five false accessory findings. The vaccine-list instruction was classified as an unread product. That made independently recognizable FS accessories fail identity reconciliation, after which pairing validation ignored those entries and reported them as missing. The reconciliation graph also grouped the requested Measles vaccine with both the FS MR vaccine and its diluent. Finally, the catalogue's approved ampersand wording did not resolve the conjunction variant consistently.

## Correction

- Parse all FS entries before comparison and accessory validation. Recognized vaccine-list headings are removed as instructions, while explicit list count units are retained; explicit individual units take precedence.
- Build an audit-specific identity snapshot using the current catalogue, approved aliases, existing cross-checker counterparts and existing clinical pairing configuration. Different strengths, presentations and unrelated identities remain separate. Contextual, rejected and deactivated aliases do not establish accessory identity.
- Keep vaccine and accessory identities separate in reconciliation. A recognized FS accessory remains accounted for independently of uncertainty about the customer's vaccine wording.
- Check pairing against canonical FS identity and actual supplied quantities, using the existing dose/vial conversion and pairing rules. A present accessory with an incorrect count produces a quantity finding. An ambiguous mapping remains a review with relevant candidates rather than a fabricated missing finding.
- Recognize the closed punctuation/conjunction variation only when it identifies a unique approved target. Duplicate catalogue mappings remain unresolved; no records are deleted or automatically merged. Permanent mapping corrections continue through the existing authorized catalogue workflow.
- Reuse the existing inline CCA source-confirmation, rejection and Search Again actions. Confirmation rebuilds the affected comparisons on the same audit, retaining independent quantity and identity findings. Known accessory and local vaccine candidates do not require AI.
- Show a read-only vaccine/accessory association table in the structured preview and results. Preview statuses are explicitly awaiting comparison. After manual preview edits, the original association table is hidden until comparison recalculates it.

## Supplied order

Five requested vaccine lines and all ten FS entries are extracted. Joseph Gumah and Gbimsi CHPS match. Men A, Yellow Fever, Rota and OPV each have the correct accessory and quantities. The MR accessory is also present with the correct count. No diluent or dropper is reported missing.

The seeded repository retains distinct Measles and Measles-Rubella records, so the MR vaccine remains a CCA identity choice. Confirming that source match clears this same example audit without repeating extraction or making a permanent clinical equivalence. Rejecting it does not clear the audit.

## Files

New implementation:

- `shared/generalAccessoryCatalog.ts`: per-audit canonical identity snapshot and association rows.
- `server/generalAccessoryAudit.ts`: scoped parsing, accessory identity resolution and local CCA candidates.
- `src/components/GeneralVaccineAccessories.tsx`: association table.

Updated integration:

- `server/generalProductNameAudit.ts`, `server/generalFsSuggestions.ts`: General comparison, candidate scoping and final summary integration.
- `server/generalStructuredExtraction.ts`, `shared/generalStructuredExtraction.ts`: preview extraction and association data.
- `server/generalSourceProductConfirmation.ts`, `server/generalCatalogueConfirmation.ts`, `server/productResearchActions.ts`: same-audit continuation and local research.
- `src/utils/generalVaccinePairing.ts`, `src/utils/generalAuditor.ts`, `src/utils/generalAuditTypes.ts`: optional General-only identity context, pairing and reconstruction.
- `src/components/GeneralExtractionPreview.tsx`, `src/components/GeneralInventory.tsx`: preview and result table placement.
- `server/generalAccessoryAudit.test.ts`, `server/companionVaccine.test.ts`: focused regression coverage and actual website `/api/verify` route.

The build also regenerates the existing extension bundle from shared sources; protected modes do not receive the new General-only context.

## Verification

Focused tests cover all-present, missing diluent/dropper, wrong count, entry ordering, approved aliases, conflicting duplicate mappings, Measles/MR review and confirmation, unknown vaccines, stockouts, approved order limits, saved-result reconstruction, dose/vial headings, rendered preview/results, local Search Again and rejection with AI unavailable. The real website route is exercised with the structured submission and persistence fixture; a companion request verifies that protected modes do not receive the new context and Blueprint balances are unchanged.

Validation on 2026-11-04:

- Focused accessory and actual route suite: 56 passed, 0 failed.
- `npm test`: 2,086 passed, 0 failed, 1 skipped (2,087 total).
- `npm run lint`: passed.
- `npm run build`: passed, with the existing large frontend bundle warning.

Tests use local fixtures; production data, live Gemini and live browser interactions were not used to claim validation. Genuine catalogue ambiguity still needs CCA review or an authorized catalogue correction. Historical audits are retained as historical records; new comparisons calculate their own results.
