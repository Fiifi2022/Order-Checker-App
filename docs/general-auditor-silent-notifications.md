# General Auditor: silent administrative notifications

Validated locally on 2026-10-20 with Node v24.21.0. This supersedes the earlier visible “IGNORED — ADMINISTRATIVE INFORMATION” section.

## Implementation

The General Auditor recognizes complete routine SMS, tracking, and arrival-time templates using deterministic classification. Explicit product, quantity, identity, or destination changes take precedence. An unknown suffix is not accepted simply because the sentence contains SMS, delivery, or flight.

Recognized administrative sentences are removed from interpretation gaps and review entries before summary calculation. Mixed messages retain their operational sentences. Duplicate reviews are reconciled after cleanup. Ignored-information metadata and its UI section have been removed, including from summary rebuilds after order-limit acknowledgement. Original order inputs and source provenance remain available for traceability; ignored text is absent from review entries and the results interface.

Mandatory orderer, facility, and product checks remain intact. Optional district/drop-area omissions remain optional; explicit conflicts remain discrepancies. Product identity, clinical specification, quantities, stock handling, and order-limit rules are unchanged. No Firebase sign-in, security rules, Render configuration, or other-tab implementation was changed for this fix. The build refreshes the existing shared General rules in the generated extension bundle.

## Results

- Full regression suite: 662 tests; 661 passed, 1 Firestore emulator test skipped, 0 failures (47.07 seconds).
- Focused administrative/SMS suite: 61 passed, including 23 new notification regressions.
- TypeScript check: passed.
- Production build: passed; existing large-bundle warning remains.
- Real Chromium + React + Express local workflow: 18 cases passed, no browser errors.
- Routine SMS: verified, no review, AI skipped; click-to-render 150.8 ms.
- Routine arrival notice: verified, no review, AI skipped; click-to-render 134.9 ms.
- SMS plus requested Multivitamin increase: manual review retained only “Please increase Multivitamin Syrup to 10 bottles.”; SMS absent; click-to-render 196.7 ms. Separately matched product quantities were not silently rewritten.
- Quantity and clinical discrepancies, synonyms, out-of-stock rows, order-limit acknowledgement, mandatory identity checks, optional location conflicts, and ambiguous facilities passed browser checks.
- A deliberately delayed 3.3-second request completed successfully after showing progress. Vaccine Checker, live Blueprint refresh/deduction, extension client, and rejection of missing/forged authentication also passed in the isolated local workflow.

Evidence: [browser results](validation/sms-notifications-browser.json), [notification regressions](../server/generalSmsNotifications.test.ts), [administrative regressions](../server/generalAdministrativeText.test.ts).

## Limits and repeatability

These are local measurements with isolated in-memory Firebase providers and deliberately unavailable Gemini, not measurements of Render or live user sign-in. No external API costs or production database writes were incurred. The Firestore security-rule test requires an emulator. This work does not establish production readiness or claim to resolve pre-existing quota/login issues. Existing saved audit records are not migrated; rerun an old audit to compute a clean result.

Use Node >=22.12 and run `npm test`, `npm run lint`, and `npm run build`. For browser validation, set `ORDERCHECK_PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`, optionally set `ORDERCHECK_VALIDATION_DIRECTORY`, and run `node --import tsx scripts/validate-browser-workflow.mts`. The test starts and stops an isolated local server and uses test-only identities.

No commit, push, or deployment was performed.
