# General Auditor bug sweep — 30 October 2026

This review covered shared General Auditor results, Chrome extension explanations,
order-limit updates, saved-audit retries, audit ownership and manual resolutions.
It is a bounded regression and code review, not a guarantee that the app has no bugs.

## Confirmed issues fixed

| Problem | Root cause and correction |
| --- | --- |
| Order-limit decisions and reopened history could change dispatch readiness or leave stale summary values. | Shared result reconstruction omitted the catalogue comparison mode and top-level decision fields. Reconstruction now preserves the mode and recalculates the decision, verdict and counts. Catalogue audits retain their existing manual dispatch policy. |
| A resolved product could retain an identity-review badge. | Recalculation only set the review flag; it never cleared obsolete flags. It now clears them when the underlying review no longer applies. |
| Empty product evidence could claim verification. | An empty array passed the success condition. Verification text now requires actual validated items. |
| Extension explanations labelled review-only evidence and optional phone checks as discrepancies. | The explanation formatter mixed reviews with confirmed discrepancies. General audit reviews remain in the review interface, while genuine mismatches remain discrepancy messages. Vaccine explanations retain their existing behavior. |
| A storage retry could replace current inputs or order-limit decisions with a second stale response. | Only the first response was checked. Every accepted retry response now must match the retained sources and decision map. Equivalent decision maps compare independently of key order. |
| Saved-audit updates and stable-ID re-verification lacked consistent ownership checks. | Reads and mutations now validate the owner or assigned administrator. Audit writes also check ownership inside a Firestore transaction, and administrators preserve the original owner. Invalid stable IDs are rejected. |
| Concurrent verification, product confirmation, order-limit and resolution updates could race. | These operations now share the existing per-audit mutation queue. |
| An empty verification request could hang. | The handler listened for stream events after Express had already parsed the body. Empty requests now return a validation error immediately. |
| Manual resolution could report success after a database write failed. | The previous handler swallowed write failures and returned the old saved state. Resolution now uses confirmed storage states, retains notes locally during failures, and exposes pending/failed status. It never changes the underlying audit verdict. Legacy responses do not tell the client to clear inputs before persistence is confirmed. |

## Files changed for this sweep

- Shared result logic: `src/utils/generalAuditor.ts`, `src/utils/generalProductEvidence.ts`.
- Browser retry and display: `shared/auditStorageClient.ts`, `src/App.tsx`, `extension/explain.js`.
- Regenerated extension bundles: `extension/general-auditor.js`, `extension/order-limits.js`.
- Server routes and access: `server.ts`, `server/auditRecordAccess.ts`, `server/generalProductConfirmation.ts`, `server/orderLimitAcknowledgement.ts`, `server/auditResolution.ts`.
- Regression coverage: `server/generalBugSweep.test.ts`, `server/auditRecordAccess.test.ts`, `server/auditResolution.test.ts`, `server/companionVaccine.test.ts`.

Earlier uncommitted facility-sentence extraction fixes were preserved.

## Verification

- Seven result/retry regressions reproduced failures before the fixes and passed afterward.
- Added ownership, concurrent resolution, failed/pending persistence, invalid stable-ID and empty-request coverage.
- Full suite: **1,463 passed, 0 failed, 1 skipped** (1,464 total).
- TypeScript check: `npm run lint`.
- Production and extension build: `npm run build`.
- Whitespace check: `git diff --check`.

## Limits

- The Firestore emulator integration test requires an emulator and was skipped in this run. No live production writes or deployment were performed.
- Ownerless legacy audits retain their existing access policy; this change does not migrate historical ownership.
- The build still reports the existing large frontend bundle warning. This is not a build failure.
- Catalogue matching, genuine identity/quantity differences, stockout exceptions and vaccine allocation rules remain covered by the full suite.
