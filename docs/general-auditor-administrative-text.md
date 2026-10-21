# General Auditor administrative-text classification

## Root cause

The General Auditor's unresolved-text detector used a short list of broad prefix exceptions. An expected-delivery window and a customer-service footer did not match those exceptions, so each became an `unparsed_text` review. The confidence calculation then counted those two reviews as two failed checks: **six passed mandatory checks / eight total checks = 75%**. This was not a product matching failure.

The issue was reproduced before editing with the exact two-product example. A combined single-line footer produced 86% (one unresolved review). A related error was also reproduced: `Customer service: 0800719102` was parsed as a product named “Customer service” with a large quantity and as the orderer's telephone, generating three false discrepancies when the customer's actual phone was present.

## Reusable classification and safeguards

The General-only pipeline now distinguishes:

- **Mandatory order information:** existing source-backed orderer, facility and product/quantity extraction. Its original matching and clinical verification remain authoritative.
- **Optional order information:** existing delivery/drop-area and district extraction and comparison. Missing values remain optional; genuine two-sided conflicts require review.
- **Administrative information:** complete recognized delivery date/time/window notifications, service-contact instructions, standard acknowledgements, courtesy messages, automated-message notices, common support-team signatures and routine disclaimers.
- **Unresolved order information:** unknown products/quantities/identities, explicit order changes and all other text that cannot confidently be classified.

The shared classifier runs before General product, metadata and telephone extraction and before unresolved-text routing. Administrative numbers therefore cannot become quantities or the orderer's telephone. Full sentences are checked, rather than allowing a recognized prefix to hide arbitrary trailing content. Recognized administrative sentences can be excluded from a mixed line while relevant text and line positions remain available.

Date/time notices require a specific temporal label and recognizable time/date vocabulary or structure. A number, date or delivery word alone does not establish that text is irrelevant. Service contacts require service/support context; an ordinary `Phone:` field is still compared under the existing rules. Personal signatures containing possible orderer names are not blanket-ignored.

Explicit changes take precedence over administrative classification, including quantity amendments, cancellation, different facilities, revised quantities, and new dropsites. They remain source-specific unresolved reviews until safely verified. The previous broad greeting/acknowledgement skips have been narrowed so messages such as “Thank you. Change the quantity from 5 to 10” cannot disappear. Numeric changes inside `Notes:` are checked before the metadata exemption.

Gemini remains a bounded, optional second step for genuinely unresolved information. Rich and legacy interpretations cannot turn confidently administrative source lines into products or product ambiguity reviews. Original change directives are rechecked after interpretation. Duplicate source-line reviews are counted once. Summary rebuilds, including order-limit acknowledgement, also exclude administrative reviews; they retain real unresolved changes.

Confidence uses the existing explicit field/product check totals. No fixed confidence boost or unconditional 100% result was introduced. Missing mandatory identities, genuine discrepancies and unresolved order information still prevent approval. Omitted optional fields remain outside the failed-check count.

The existing field-results component displays a collapsed **IGNORED — ADMINISTRATIVE INFORMATION** section with the source text. Product rows, required-field warnings, discrepancy panels and the existing layout are retained.

## Before and after: actual local runs

The before values were captured before code changes on 20 October 2026. The after values are repeatable with Gemini deliberately unavailable; no remote API request was made.

| Input added to otherwise matching required information | Before | After |
| --- | --- | --- |
| Two-line delivery window and service footer | 75%, two unresolved reviews, manual review, one attempted AI fallback | 100%, zero discrepancies/reviews, verified match, zero AI calls |
| Same footer combined on one line | 86%, one unresolved review, manual review, one attempted AI fallback | 100%, zero discrepancies/reviews, verified match, zero AI calls |
| Customer-service phone with the customer's actual phone in the request | 67%, false extra product/ambiguity/phone errors, three discrepancies | 100%, no extra product, no false phone mismatch, zero discrepancies or AI calls |

The required orderer and facility match in every successful example. A matching product list alone cannot approve an audit.

Machine-readable measurements: `docs/validation/administrative-text-results.json`. Re-run:

```bash
node --import tsx scripts/benchmark-administrative-text.mts
```

The script explicitly labels its before values as historical observations; only its after results and timing samples are re-measured. Its warm timing samples are local General Auditor processing, not Render/network or live Firebase performance.

## Validation

- **38 new regression tests** cover split/combined footer forms, service contacts, notifications, signatures, mandatory omissions, actual product/quantity/clinical errors, unknown products, stock, order limits, optional omissions/conflicts, mixed operational instructions, AI misclassification, line provenance and stale-review summary rebuilds.
- Full suite: **639 tests, 638 passed, zero failures, one skipped**. The skipped test requires an unavailable Firestore emulator.
- TypeScript check and production build passed; the existing chunk-size warning remains.
- Actual local Chromium → React/AuthGate → Express → final display passed with zero browser errors. The administrative-footer audit verified in **128.6 ms** from click to result DOM; the footer plus a real quantity-change instruction stayed under review (**175.1 ms**). These small local samples are not deployment latency guarantees.
- The browser harness also retained the required/optional parameter checks and existing product, stock, limit, facility/orderer mismatch and >3-second valid-audit checks. Extension-client verification passed. Vaccine confirmation changed the isolated balance from 20 to 17; retry left it at 17.

The browser harness uses isolated synthetic Firebase identity/storage providers. Actual production sign-in, live Firestore transactions and Render behaviour were not tested by this task. No production documents were written and no real Gemini requests were sent. The previous Firestore read reductions and timeout budgets remain in place; this change adds no Firestore queries.

## Modified files for this task

Runtime classification and results:

- `src/utils/generalTextClassification.ts` — new shared General-only classifier and provenance-preserving administrative filtering.
- `src/utils/generalAuditor.ts` — early filtering for products/metadata/telephone extraction, source change reviews, administrative annotations and summary filtering.
- `src/utils/generalAuditTypes.ts` — optional administrative-information annotations.
- `server/generalOrderInterpretation.ts` — classification-aware unresolved detection and rich/legacy AI safeguards.
- `server/generalSemanticAudit.ts` — deduplication of source-specific reviews.
- `src/components/GeneralAuditDetails.tsx` — collapsed ignored-information display in the existing result component.
- `extension/order-limits.js` — regenerated by the existing production build to keep shared General acknowledgement rules aligned; connection/authentication code unchanged.

Tests and repeatable evidence:

- `server/generalAdministrativeText.test.ts` — new regression tests.
- `scripts/benchmark-administrative-text.mts` — new local before/after report generator.
- `scripts/validate-browser-workflow.mts` — added administrative-footer and real-change browser scenarios.
- `docs/general-auditor-administrative-text.md` — this report.
- `docs/validation/administrative-text-results.json` — measurements.
- `docs/validation/administrative-text-browser.json` — isolated browser validation evidence.

Other pre-existing workspace changes were retained. Vaccine Checker, Allocation Blueprint, editing-history logic, clinical synonym/quantity rules, Firebase authentication/rules/credentials, dependencies and Render configuration were not edited for this task.

## Remaining limitations and deployment

Classification is deliberately conservative and primarily English. Unfamiliar footer templates, nonstandard service contacts and possible personal signatures can still require review rather than being broadly discarded. Actual order-change directives are not silently applied to quantities or destinations; human verification is required until the intended change is resolved. Additional trusted footer patterns should be added with regression tests protecting mixed-in operational instructions.

The changes are local and uncommitted. Nothing was pushed to GitHub or deployed to Render. Use the existing release workflow only with the user's approval; deploy the matching frontend/backend and refresh existing sessions. Post-deployment confirmation is still needed before making an operational-readiness claim.
