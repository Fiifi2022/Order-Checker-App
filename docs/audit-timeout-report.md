# Compliance Auditor timeout and performance report

Date: 19 October 2026. All implementation and verification described here was local. Nothing was deployed and no live Gemini/Firebase performance test was performed.

## A. Root cause and evidence

The previous implementation treated the three-second objective as a failure at three independent layers:

- `src/App.tsx` started a 3,000 ms timer before audit preflight, aborted the request, cleared findings and displayed the reported alert.
- `src/utils/authFetch.ts` imposed another 3,000 ms timeout, including token acquisition. The companion imposed the same deadline.
- `server/auditBudget.ts` allowed only 2,800 ms across authentication, catalog loading and reference reads.

An otherwise valid audit could therefore be discarded while waiting for authentication, Firestore or the response network. These layers are proven causes of cancellation; there is no live evidence identifying which external service was slow in a particular failed customer audit.

The optional Gemini limit was 600 ms. Six synthetic 900 ms responses all exceeded that limit. Input that needed interpretation then failed instead of producing an actionable review result.

Local CPU profiling also identified repeated facility normalization and metadata lookups. Facility comparison scanned the served directory repeatedly, normalizing official names/aliases and extracting district/region within record filters. The AI eligibility gate extracted identities/products again and normalized the whole known-product vocabulary for every audit. Fallback paths repeated extraction and original-identity checks. The portal additionally fetched `/api/products` and `/api/osu` before verification even though the server used its current catalog and stock register again.

Gemini was already optional before this task. Straightforward deterministic audits did not call Gemini; this behavior is preserved. Quantity, stock and vaccine validations were not removed to meet a target. There is no measurement proving that React rendering, orderer identification or a cold host caused a specific production failure.

## B. Solution implemented

Three seconds now triggers a progress message and continues verification:

> Your audit is taking slightly longer than expected. Please wait while we complete the verification.

The default hard deadlines are 20 seconds in the portal/companion and 18 seconds on the server. Optional Gemini interpretation has up to four seconds within the remaining server budget, with one attempt and no automatic retry/model switching. These bounded defaults allow the measured 900 ms interpretation case and reserve time for required reference reads and response transit. They are configurable starting values, not a claimed optimum based on production latency.

At the hard deadline the browser preserves both inputs, clears any obsolete result, cancels supported work and offers retry. Server cancellation stops later reads and propagates to Gemini on timeout or disconnect. Late SDK responses cannot establish a new passing result. Atomic allocation-confirmation transactions retain their existing lifecycle and are not cancelled midway by verification deadlines.

Other changes:

- Reuse request-local identity/product evidence for the deterministic eligibility gate.
- Cache stable normalized reference vocabulary, with mutation signatures and catalog/vaccine-version invalidation. Stock, allocations and audit decisions are not cached.
- Build indexed facility candidates once per comparison; extract geography once per side.
- Reuse original deterministic results after AI failure and avoid repeating original-identity validation on unchanged raw inputs.
- Fetch the catalog once on the server; return that same vocabulary to the requesting portal for reconciliation. Existing revision checks still work for older clients. The response-only catalog is not written into audit history.
- Remove the redundant portal stock-register preflight; server stock evidence and confirmation quantities remain authoritative.
- Read managed facility state and optional Blueprint identity information concurrently. Managed removals remain mandatory/fresh; optional enrichment has a 1.2-second bound and retains review when evidence is insufficient.
- Bound optional history persistence wait to 200 ms, retain warnings and let the write finish.
- Prevent same-frame duplicate General Auditor submissions; cancel obsolete browser and companion verification work.
- Scope AI evidence caches to the authenticated account and vocabulary version.
- Provide configurable numeric diagnostics and remove raw order/header logging from the audit route and General Auditor debug hooks.

## C. Files changed for this request

Earlier local changes for facility management, administrator navigation and other user requests remain in the workspace. The list below describes this timeout/performance task, not every earlier uncommitted change.

| File | Purpose |
|---|---|
| `shared/auditPerformance.ts` | Soft/hard timeout policy, validated configuration, safe timing collector and abort-aware waits. |
| `shared/generalVaccineCatalog.ts` | Detect vocabulary changes; avoid rebuilding identical vaccine identity configuration. |
| `server/auditBudget.ts` | Configurable request deadline, disconnect cancellation, read budget and optional SDK aborts. |
| `server.ts` | Stage timings, fresh single catalog handoff, concurrent identity reads, bounded history wait and privacy-safe audit logs. |
| `server/generalOrderInterpretation.ts` | Reuse parsed evidence; cache normalized vocabulary safely; scope and cancel AI extraction. |
| `server/generalSemanticAudit.ts` | Deterministic-first timing, evidence reuse and actionable review on failed interpretation. |
| `server/auditSemantics.ts` | Bounded/cancellable vaccine-language fallback, account-scoped evidence and transient-failure cache eviction. |
| `src/utils/generalFacility.ts` | Index reference candidates and cache normalization while observing edits. |
| `src/utils/generalAuditor.ts` | Opt-in facility/orderer/product/quantity/final-validation timing and extraction handoff. |
| `src/utils/generalAuditDebug.ts` | Content-free diagnostics instead of dumping customer payloads. |
| `src/utils/authFetch.ts` | Configurable hard timeout covering authentication and fetch; caller cancellation. |
| `src/App.tsx` | Soft progress state, hard timeout/retry/input preservation, duplicate-click guard and catalog handoff. |
| `src/components/VaccineAllocationChecker.tsx` | Shared delayed-progress message, obsolete-request cancellation and ownership-safe loading state. |
| `src/vite-env.d.ts` | Vite configuration types. |
| `extension/auth.js` | Configurable hard deadline including token wait; cancellation propagation. |
| `extension/backend.js` | Honor caller cancellation and release abort listeners. |
| `extension/popup.js` | Delayed-progress text, cancel stale verification and remove duplicate catalog request. |
| `extension/background.js` | Regenerated background bundle from the updated shared request code. |
| `server/auditPerformance.test.ts` | Updated soft/hard deadline expectations and bounded-read checks. |
| `server/auditReliability.test.ts` | Actual auth-fetch tests, >3-second backend completion, cancellation, review safety, privacy, cache isolation/edit detection. |
| `server/generalAuditRequest.test.ts` | Actual General Auditor handler: delayed completion, duplicate clicks, timeout retry and stale-result rejection. |
| `server/auditSemantics.test.ts` | Updated optional AI timeout assertion. |
| `server/companionVaccine.test.ts` | Updated extracted-route test dependencies. |
| `server/vaccineAuditDeduction.test.ts` | Updated cancellation dependencies in the existing deduction test harness. |
| `extension/backend.test.js` | Updated hard-deadline/token-lookup expectation. |
| `scripts/benchmark-audit.mts` | Repeatable synthetic performance cases and aggregate statistics. |
| `docs/audit-performance-results.json` | Measured before/after results and benchmark provenance. |
| `README.md`, `docs/audit-timeout-report.md` | Configuration, architecture, findings and operational limits. |

## D. Processing architecture

1. Authenticate and authorize using the existing Firebase controls.
2. Load the current catalog. Read managed facility changes and optional official identity enrichment without caching operational balances.
3. Extract source identities/products and run deterministic facility, orderer, clinical identity, stock, quantity, order-limit and vaccine-pair rules.
4. If the input is resolved, return those findings without Gemini. A deterministic discrepancy does not by itself justify an AI call.
5. Otherwise use one bounded, evidence-validated Gemini interpretation attempt or compatible account-scoped extraction evidence. Do not accept invented values or use AI to override official identifier conflicts or quantity rules.
6. Revalidate interpreted evidence. On quota/network/timeout/malformed output, preserve available deterministic findings and mark unresolved information for manual review. If malformed quantity text cannot be read safely, return a clear validation error instead of a pass.
7. Return the current result and exact catalog used, with any persistence warning. The portal rejects stale results and preserves authoritative identity evidence during reconciliation.

For existing vaccine verification, shared timeout/cancellation changes apply; allocation and pairing business rules remain in their existing engine. Confirming and deducting remain separate atomic operations. Blueprint editing, balances, sheet formatting, existing roles and extension integration were not redesigned.

## E. Test results

- Full suite: **562 tests; 561 passed; zero failed; one skipped**.
- Skipped: Firestore emulator persistence integration, because no emulator was running.
- `npm run lint`: passed (TypeScript no-emit check).
- `npm run build`: passed; existing large frontend-chunk warning remains.
- Final server bundle rebuilt after log redaction.
- `git diff --check`: passed.

Coverage includes perfect matches and actual facility/orderer/product/quantity discrepancies; synonyms and clinical qualifiers; zero-supply/out-of-stock and partial stock; explicit/unconfirmed order limits; vaccine/diluent/dropper exceptions and allocation boundaries; malformed/missing inputs; delayed/unavailable/quota-limited/malformed AI; multiple products; hard timeout/input preservation/retry; duplicate submissions; cancellation and late responses; authorization; and existing Blueprint/extension behavior. A real >3-second backend-wait test completes successfully. Browser request and actual General Auditor handler tests exercise soft-target survival without waiting for wall-clock hard deadlines.

## F. Before/after performance

Repeatable local engine benchmark, same synthetic cases and environment: 24 deterministic samples and six AI samples per version, one warm-up excluded, all 1,509 facility references. AI was mocked with a fixed 900 ms response delay. Medians use the standard middle-pair average and p95 uses nearest rank.

| Metric | Before | After |
|---|---:|---:|
| Deterministic average | 54.35 ms | 5.46 ms |
| Deterministic median | 42.98 ms | 5.02 ms |
| Deterministic p95 | 117.72 ms | 7.03 ms |
| Deterministic Gemini calls/audit | 0 | 0 |
| Deterministic timeout frequency | 0/24 | 0/24 |
| Deterministic completed audits | 24/24 | 24/24 |
| Deterministic verified-match rate | 50% | 50% |
| Deterministic manual-review rate | 0% | 0% |
| Mocked AI average | 749.34 ms (cut off) | 993.11 ms (completed) |
| Mocked AI median | 748.63 ms | 990.69 ms |
| Mocked AI p95 | 768.72 ms | 1,008.50 ms |
| Mocked AI calls/audit | 1 | 1 |
| Mocked AI timeout frequency | 6/6 | 0/6 |
| Mocked AI completed verified matches | 0/6 | 6/6 |
| Mocked AI manual-review rate | 0% (errors) | 0% (valid evidence) |

Half the deterministic fixtures intentionally contain discrepancies; the 50% verified-match rate is expected, not a processing failure. AI outage/ambiguity behavior is covered by separate correctness tests, not represented by the successful mock fixture rate. The longer AI duration is intentional: it now waits for valid evidence rather than failing early. No real model speedup or end-to-end latency improvement is claimed from a fixed-delay mock.

The baseline was a saved pre-task workspace snapshot, including earlier local changes. Runs were sequential. Raw aggregate data and the benchmark SHA-256 are in `audit-performance-results.json`. Run the current benchmark with:

```sh
node --import tsx scripts/benchmark-audit.mts
```

The measurements exclude real authentication, Firestore reads/writes, deployment network, server cold starts, screenshots and React rendering. They ran on the available Node 18.20.4 environment; the repository declares Node >=22.12.0. CI/deployment should use the declared version. Local timing and small-sample p95 are not production service-level guarantees.

## G. Remaining limitations and deployment

No production audit trace, deployed hosting metrics or live Gemini latency/quota measurements were available. The code demonstrates why three-second cancellation occurred; identifying a particular production service delay requires the new numeric diagnostics. A slow or cold host can still reach the configurable hard deadline.

Deploy backend and frontend together: the new portal expects the verified catalog in the audit response. Existing clients that send a catalog revision remain supported. Rebuild/reload the companion for its new timeout and progress behavior. No credentials or Firebase security rules need replacing.

Configuration:

| Setting | Default | Valid range |
|---|---:|---:|
| Backend `AUDIT_HARD_TIMEOUT_MS` | 18,000 ms | 4,000–60,000 ms |
| Backend `AUDIT_AI_TIMEOUT_MS` | 4,000 ms | 100–15,000 ms; clamped to remaining request budget |
| Frontend build `VITE_AUDIT_HARD_TIMEOUT_MS` | 20,000 ms | 4,000–60,000 ms |
| Companion config `auditTimeoutMs` | 20,000 ms | 4,000–60,000 ms |
| Backend `AUDIT_PERFORMANCE_LOG` | disabled | `true` enables numeric logs |

Keep client timeouts above the backend timeout. Unsupported configuration values fall back to defaults. Firebase calls already dispatched may finish after cancellation; the application stops awaiting them and prevents subsequent verification/AI steps. Firestore writes already submitted may also complete later; storage warnings report an unconfirmed/delayed save. Allocation transactions are not falsely reported as cancelled halfway through a deduction.

## H. Recommended next steps

1. Deploy the backend/frontend together and reload the rebuilt companion.
2. Temporarily enable `AUDIT_PERFORMANCE_LOG=true`; measure authentication, catalog, facility reads and AI durations on representative real audits without logging their contents. Tune hard/AI deadlines from real p95 and cold-start observations.
3. Run the skipped persistence integration test against a local Firestore emulator using `npm run test:firestore`, and run CI on Node >=22.12.0.
4. Address the existing frontend bundle warning separately if deployment measurements show page load/rendering affects operators; it is not proven to cause the reported audit cancellation.
