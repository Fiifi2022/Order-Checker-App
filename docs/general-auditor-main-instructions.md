# General Auditor: instructions imported from main

Source: `Fiifi2022/Order-Checker-App`, `origin/main`, commit
`a64ec94d64fbbed6511ff308d53079b925a60c83`, `server.ts`,
`SYSTEM_INSTRUCTIONS` (starts near line 214). Inspected after fetching main;
no branch merge, commit or push was performed. Target: `addition_of_vaccine`.

The adapted instructions are exported as `GENERAL_AUDITOR_INSTRUCTIONS` in
`server/generalAuditorInstructions.ts`. They supplement the existing extraction
or research task; they do not replace response schemas or deterministic checks.

## Scope

Only website requests explicitly selecting `general_auditor` receive this policy.
Extension, companion audit modes, Vaccine Checker and ordinary order checking
retain their existing client and instructions. Saved-audit follow-up research uses
the saved origin, not a client-supplied mode switch. Website policy caches have a
versioned scope to prevent cross-mode reuse. The singleton Gemini SDK client,
model selection, timeouts, cancellation and accounting are not mutated.

## Imported and retained rules

- Compare facility, orderer, product identity and quantities only. Parse source
  fields independently. Dates, phone, delivery location, time and district do
  not affect clearance.
- Compare actual normalized product names first, then current catalogue names,
  approved aliases and supported clinical terminology. Matching unknown names
  are valid without catalogue registration or Gemini.
- Recognize medicine, blood component, diagnostic, vaccine and consumable
  terminology while preserving ingredients, strength, formulation, route,
  presentation, blood group and device specifications.
- Preserve exact/reordered names and verified abbreviations; uncertain person
  or facility equivalences remain CCA decisions.
- Keep missing, extra and quantity mismatches distinct. Positive shortfalls
  need approved supporting evidence or a per-product order-limit decision.
- A mentioned zero-supply product is out of stock, not missing. Preserve
  shortages even alongside other discrepancies; stockouts alone do not lower
  confidence or count as packing discrepancies.
- Use approved packaging and explicit unit evidence. All **215** main-prompt
  internal-quantity entries already exist unchanged in the current **218**-row
  packaging reference; no catalogue or database edit was necessary.
- Existing General Auditor companion rules recognize legitimate diluents and
  droppers and flag genuinely missing, orphaned or unequal components.
- Keep concise, source-supported explanations and corrective actions. Uncertain
  Gemini suggestions require confirmation; final deterministic validation
  remains authoritative. Existing same-audit confirmation/rejection is retained.
- Website General Auditor order-limit controls now read **Order Limit
  Confirmation Required**, **Confirm Order Limit**, **No, Keep Discrepancy**.
  The shared component's default labels remain unchanged for other callers.

## Main rules deliberately not copied literally

- The broad universal-text mode and comparison of phone/location/date do not
  fit the four-field medical audit baseline.
- Main's broad ACT=AL, TT=Td, COVID-brand and giving-set equivalences cannot
  establish clinical interchangeability. Existing approved mappings and
  attribute validation take precedence; unverified terms are research leads.
- Removing every facility-type suffix can merge distinct facilities. Current
  verified records, aliases and controlled confirmation remain authoritative.
- Main's conversion-by-numeric-multiple rule can hide genuine mismatches without
  unit evidence or with conflicting package factors. Current guarded conversion
  remains in force; historical facility-specific data is not overwritten.
- Main converts stockout statuses to `match` when other discrepancies exist.
  This would hide shortage visibility, so current amber stockout statuses remain.
- Main's dose-for-dose companion phrasing is not substituted for the existing
  configured vial/component rules. Vaccine allocation behavior is unchanged.
- Model-generated scores or a schema-valid response never authorize dispatch.
  Existing deterministic confidence and final gate remain authoritative.

## Files changed for this request

1. `server/generalAuditorInstructions.ts` — dedicated policy, origin selection,
   lazy scoped client and cache namespace.
2. `server.ts` — website General Auditor and saved research boundary wiring.
3. `server/productResearchActions.ts` — optional saved-record research context;
   default behavior unchanged.
4. `server/generalIdentityResearch.ts` — optional cache namespace;
   default behavior unchanged.
5. `src/components/GeneralFulfillmentSummary.tsx` — optional order-limit labels.
6. `src/components/GeneralInventory.tsx` — enables website General Auditor labels.
7. `server/generalAuditorInstructions.test.ts` — 18 regression/isolation tests.
8. `docs/general-auditor-main-instructions.md` — this report.
9. `server/companionVaccine.test.ts` — supplies the new imported dependency to
   the existing VM route harness; assertions and protected-module code unchanged.

Existing uncommitted workspace changes from earlier work were preserved.
No extension source/bundle, vaccine/Blueprint/allocations/deductions, shared
catalogue/aliases, Firebase schema/authentication or FS integration file was
edited for this request. Of 159 checksummed protected files, the only change is
the route test harness dependency above; all protected runtime files remain
unchanged, including extension bundles regenerated by the release build.

## Validation and limits

The new tests cover direct/alias/unknown matches, differing identities,
missing/extra items, quantities, confirmed/declined limits, stockout visibility,
package conversion, required vaccine components, same-audit approval/rejection,
and website-versus-extension policy/cache isolation. Existing regressions are
retained; `npm run verify:release` runs build, TypeScript and the complete suite.
Final local release result: **1,898 tests, 1,897 passed, 0 failed, 1 skipped**
(optional Firestore emulator integration). All 18 new tests passed. The focused
actual-route and order-limit suite also passed all 60 tests.

No model, environment, billing or Firebase migration changes are needed.
Tests use mocked Gemini responses; live provider quota/availability and
unrecognizable input still require normal fallback or human clarification.

## Deployment

Railway production deployment `087b7fd4-c3dd-431b-a968-7b5671c550bd` succeeded
on 2026-11-04. Railway independently passed the same 1,897 tests with zero
failures and one optional skip. The live `/api/health`, website and new asset
`/assets/index-CogLA8La.js` all returned HTTP 200; the asset contains the new
General Auditor order-limit labels. No operational audit or allocation deduction
was performed during production verification.

## Follow-up: postfix requests and stale browser tab

The reported ASV order exposed a parser gap, not a missing alias. The live
catalogue already maps ASV and Snake Venom Antiserum to one product. However,
`Please ASV needed` was not recognized as a product request, so its separate
`Quantity needed: 2 vials` line had no product to attach to. Importing Gemini
instructions alone did not fix that deterministic extraction failure.

The website General Auditor now explicitly opts into catalogue-guarded postfix
request grammar (`PRODUCT needed/required/requested`). It removes only the
request wording when the complete remaining description is a known product or
a known quantified product. Existing deterministic association then attaches
the sole unambiguous quantity, including across patient/clinical metadata.
Negated, unknown and multi-product ambiguous phrases remain unresolved. Neither
patient age/contact nor FS quantities may supply a missing requested count.

`Yezesi Health Center` versus `Yizeisi HC` remains a facility spelling question:
the directory contains Yizeisi HC, Mamprugu Moagduri, North East, but no approved
alias established the requested spelling. The website shows the directory
candidate alongside the existing Confirm/Reject controls. Confirmation resumes
the same audit; product/quantity findings are preserved. No alias was saved by
this investigation and no production audit was created for testing.

Additional touched files: `server/generalOrderExtraction.ts` (optional
website-only grammar), `server/generalProductNameAudit.ts` (passes that option),
`src/components/GeneralIdentityCard.tsx` (optional candidate display), and
`server/generalPostfixRequest.test.ts` (12 regression tests). Existing scoped
server/inventory/instruction wiring was updated; extension and vaccine callers
retain their defaults. All 12 new targeted tests passed, including generic
non-ASV phrasing, missing/conflicting counts, negation, same-audit confirmation
and protection of unrelated quantity discrepancies.

The user's open Chrome tab was also observed running an older asset
`index-B0tdg2LC.js`, despite the successful newer deployment. A page remaining
open retains its loaded JavaScript until refreshed; a deployment does not
automatically replace that in-memory code.

Follow-up release validation: **1,910 tests, 1,909 passed, 0 failed, 1 optional
Firestore-emulator skip**. Railway deployment
`e10f80ac-e7be-4df0-95b7-f782085cbec7` succeeded and passed its health check.
The website, `/api/health` and new asset `index-BcsXj2sp.js` returned HTTP 200.
The existing Chrome tab was refreshed onto this asset, both input messages were
preserved, and the obsolete displayed result was cleared without submitting an
audit or deleting its history.
