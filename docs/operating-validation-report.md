# Operating validation and product-specific ambiguity correction

Date: 19 October 2026. Runtime: Node 24.21.0, which satisfies the repository's supported runtime requirement.

**Recommendation: production readiness is not established.** The controlled browser workflow and regression checks pass, but the actual configured Firestore service returned `RESOURCE_EXHAUSTED`, a usable Gemini API key was not available, and no deployed URL or approved end-user test session was supplied. No production data, users, credentials or security controls were changed.

## Confirmed product bug and reusable correction

The exact request `Multivitamin Syrup — 5 bottles` and the identical fulfilment line already parsed and matched deterministically when tested alone. The reproduced failure arose when another line required interpretation: the AI failure path created one “Ambiguous Product” review whose source was the **entire customer order**. Its display therefore included the correctly matched syrup. The rich AI interpretation path could also remove ordinary deterministic product evidence when the model labelled that evidence ambiguous.

The correction applies to all products:

- Exact, confidently parsed product identities and known catalog names are evaluated first. Specifications and quantities remain in the deterministic comparison.
- AI failure generates reviews for only the affected source lines, independently on the customer and fulfilment sides. It never uses the entire order as an ambiguous-product label.
- Unparsed surrounding text is labelled **Manual Review Required — Unresolved Text**, separately from product ambiguity and confirmed product discrepancies. Verified product rows retain their match. An unresolved line still blocks whole-order approval.
- Deterministically resolved source product lines cannot be deleted, demoted to ambiguity or assigned altered quantities by a rich model response. A valid-looking response that omits unrelated text still leaves that specific line under review.
- Explicit clinical variants of a recognized identity are routed to deterministic comparison without discarding strength, form, concentration or packaging. A differing specification remains a discrepancy. The missing-quantity/concentration guard remains intact.
- Broad clinical descriptions such as “cough syrup” remain subject to the existing ambiguity rules, even when their wording is identical on both sides.

The new regressions cover the exact Multivitamin Syrup example; multiple other products; an unrelated unresolved customer or fulfilment line; quantity/unit/volume/formulation/strength differences; an AI response attempting to demote a verified product or change its quantity; and genuinely broad clinical names. The real React app also exercised the exact syrup example and the mixed resolved/unresolved case through the complete local backend.

## Directory validation across all 1,509 records

A complete directory sweep exercised labelled names, capitalization/spacing differences, names inside sentences, different-facility pairs, and duplicated names without geography.

| Check | Result |
|---|---:|
| Supplied records exercised | 1,509 / 1,509 |
| Matrix cases after fixes | 4,531 / 4,531 passed |
| False verified matches in this matrix | 0 |
| Labelled comparisons against the pre-optimization matcher | 1,509 |
| Changed labelled decisions against that baseline | 0 |
| Previously unnecessary prose reviews discovered | 309 |

The 309 failures were conservative false reviews, not false verified matches. A shorter typed name or locality within a complete official facility name was counted as another facility—for example `Fosuansa CHPS` within `Fosuansa CHPS (CR)`, or `Abuakwa South` within `Akokoo (Abuakwa South) CHPS`.

Extraction now counts overlapping text spans once when the complete official record is explicitly present. A shorter name mentioned separately is retained. Tests verify that two separate facilities still require review, different official identifiers remain discrepancies, and Kotoso RHC/RCH is not accepted without verified alias evidence.

These are consistency checks against the supplied directory and explicit test evidence. They do not independently establish that every source record, alternative spelling or unrecorded alias is correct.

## Actual browser-to-backend-to-results measurements

The validation ran **Chromium, the actual React app and AuthGate, authFetch, and the complete Express server**, using real loopback HTTP and real result DOM rendering. The build used isolated, synthetic Firebase identity/storage providers. No browser response was substituted for `/api/verify`; the real backend matching and validation code produced the findings. The production authentication middleware remained in the test server, validating only the deliberately synthetic provider's tokens. This does **not** validate real Firebase end-user sign-in or Firestore latency.

Nine normal scenarios plus one controlled slow-backend scenario passed. Measurements include the catalog application, all 1,509 references, browser parsing/reconciliation and result display. The test harness instruments response parsing and DOM updates; it is a local test build, not a deployed production-bundle or hosting benchmark.

| Normal local scenarios, n=9 | Average | Median | p95* |
|---|---:|---:|---:|
| Frontend click to request start | 1.53 ms | 1.50 ms | 2.10 ms |
| Backend request through response finish | 120.34 ms | 87.35 ms | 298.53 ms |
| Browser request to response headers | 122.94 ms | 92.30 ms | 300.10 ms |
| Response headers to results DOM | 66.06 ms | 57.50 ms | 100.00 ms |
| **Total click to results DOM** | **190.53 ms** | **151.00 ms** | **402.20 ms** |

*Nearest-rank p95 with nine samples equals the largest observed value. The first request includes process-local initialization; stages can overlap. Do not add backend time to browser request time, or add response-body parsing time again to the response-to-DOM interval. DOM readiness is not a measurement of the completion of every CSS animation or of hosting/network conditions.*

| Scenario | Click to results | Backend | Expected decision observed |
|---|---:|---:|---|
| Exact Multivitamin Syrup | 402.20 ms | 298.53 ms | Match; no AI call |
| PCM / Paracetamol synonym | 191.00 ms | 96.42 ms | Match |
| Quantity difference | 140.70 ms | 81.10 ms | Discrepancy |
| Partial stock / zero fulfilment | 143.20 ms | 80.90 ms | Available products match; shortage classified separately |
| Matched syrup + unresolved other line | 257.20 ms | 175.58 ms | Syrup match retained; only the other line requires review |
| Different product specification | 139.60 ms | 81.88 ms | Discrepancy |
| Facility mismatch | 151.00 ms | 87.35 ms | Discrepancy |
| Orderer mismatch | 153.50 ms | 98.87 ms | Discrepancy |
| Unverified Kotoso RHC / RCH | 136.40 ms | 82.40 ms | Manual facility review; no approval |
| Controlled 3,300 ms backend authentication delay | 3,485.90 ms | 3,407.08 ms | Waiting message shown after 3 s; valid result completed |

The injected delay is a controlled resilience test, not an observed Firebase latency. The old three-second failure did not appear in any browser scenario. Initial local app readiness was 670.07 ms; this is not a hosted cold-start measurement.

The actual extension HTTP client also called the full local backend successfully in 94.28 ms. It used synthetic stored credentials; Chrome Web Store installation and real extension sign-in were not tested.

After the fix, a separate in-process engine benchmark on Node 24 measured 24 deterministic samples at 3.45 ms average, 3.26 ms median and 5.48 ms p95, with zero AI requests. This excludes frontend/network/storage and is not directly comparable to older runs using a different Node runtime or catalog initialization state. Six fixed-delay mocked AI samples still completed correctly. **No real Gemini processing time is available.**

## Functional checks and accuracy limits

The controlled browser/backend checks passed:

- Exact product matching, clinical synonyms, real quantity/specification differences, facility/orderer identity, zero-supply/partial stock and scoped manual reviews.
- Unconfirmed shortfalls stayed blocked. Clicking the existing order-limit Yes control updated the result and persisted the acknowledgement through the actual endpoint.
- Allocation Blueprint loaded its fixture row and Vaccine Checker rendered.
- Full vaccine verification accepted OPV with its dropper and BCG with diluent. Confirmation changed the in-memory Blueprint balance from 20 to 17; retrying the same confirmation left it at 17, demonstrating the real service's idempotent behavior with the isolated provider. This does not establish real Firestore transaction persistence/concurrency.
- Missing and forged-token requests were rejected with HTTP 401 by the actual middleware.
- No browser page errors occurred in the final run. Production builds exclude the synthetic provider modules.

Full regression suite on Node 24: **569 tests, 568 passed, zero failed, one skipped**. The skipped test requires a local Firestore emulator, which was not available. Type checking, production build and `git diff --check` passed. The existing frontend bundle-size warning remains.

The suite includes clinical qualifiers, missing quantities, out-of-stock formats, order limits, vaccine/accessory rules, allocation boundaries and persistence behavior with test storage, stale/cancelled responses, role restrictions, spreadsheet/Blueprint operations, facility management and extension integration. Passing these cases is evidence against the covered regressions, not a population-wide clinical accuracy estimate.

## Real external checks and unavailable validation

All external probes were read-only. No real audit records, accounts or allocation balances were created or modified.

| Service / capability | Actual observation |
|---|---|
| Firebase configuration | Admin private key parsed; configured project matched the portal configuration. Values were not printed. |
| Firestore read | Reading the existing catalog document failed with service code **8, RESOURCE_EXHAUSTED**. The final attempt took about **2.90 s**, including SDK initialization. The specific exhausted resource/quota was not identified. |
| Firebase Auth service | A read for a randomized nonexistent synthetic UID returned the expected `auth/user-not-found` in about **1.07 s**. This establishes service reachability, not user login, role assignment or token revocation behavior against live accounts. |
| Real Gemini | **0 requests**. The configured value did not pass the expected API-key format check. Validity and available quota could not be established. |
| Deployment | No approved deployed/staging URL or signed-in test account/session was supplied. Real TLS/CORS, Firebase authorized domains, deployed revisions, hosting cold starts and production latency were not tested. |
| Firestore emulator persistence | Not executed: emulator/JVM tooling was unavailable in this environment. |
| Chrome extension | Actual client-to-local-server request passed; installed extension against the real Fulfilment System was not exercised. |

Do not hide the Firestore problem with stale operational caches or bypass authentication to make a live audit pass. Resolve the service condition and repeat the real workflow before release approval.

## Exact steps to complete live validation

1. Use the supported Node runtime already installed, or another runtime satisfying `>=22.12.0`. Confirm `node --version`; run `npm run lint`, `npm test` and `npm run build`.
2. Check the configured Firebase project's Firestore resource/usage/quota diagnostics and database availability. Resolve the cause of `RESOURCE_EXHAUSTED`; code 8 alone does not prove whether billing, a particular quota or another resource limit caused it. Keep the existing project/database, security rules and roles intact.
3. Configure a valid Gemini API key through the existing secret/environment mechanism and confirm the intended project has usable quota. Do not paste credentials into chat, reports or source control. Re-run the bounded read-only check, which permits at most one model request:

   ```sh
   node --import tsx scripts/validate-external-services.mts --firebase-read-only --gemini-once
   ```

   Results go to `/tmp/ordercheck-external-validation.json` by default. Set `ORDERCHECK_VALIDATION_OUTPUT` to change that path. A model timeout, 429 or malformed output must produce review, not approval. Do not retry model probes repeatedly to force a passing result.

4. With a local Firestore emulator and its prerequisites installed, start the isolated demo project in one terminal:

   ```sh
   firebase emulators:start --only firestore --config firebase.emulator.json --project demo-ordercheck-extension
   ```

   In another terminal:

   ```sh
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 npm run test:firestore
   ```

   The script rejects non-local emulator targets. Confirm persistence and idempotent retries pass after service reload.

5. Deploy the matching frontend/backend revisions to an approved staging environment. The frontend expects the catalog returned by the current backend. Provide the staging URL and an approved test-account session through the normal login process; do not impersonate production operators or mint replacement sessions for them.
6. Enable `AUDIT_PERFORMANCE_LOG=true` temporarily in staging. Use synthetic orders and approved test allocation rows. Run at least 30 deterministic and a small explicitly budgeted number of AI-required samples. Measure click-to-results from browser performance tooling and compare it with the numeric server-stage logs. Record median/p95, timeout/manual-review rates, exact verdicts and the number of actual model requests. Distinguish cold and warm runs.
7. Repeat the documented exact-match, mismatch, stock, units/specification, order-limit, ambiguous facility, AI failure, cancellation/retry, Blueprint and vaccine cases. A three-second wait must show progress; the configured hard deadline must preserve inputs and reject late results. Verify all affected matched product rows stay green while unrelated unresolved lines remain blocked for review.
8. Test the installed companion against the approved Fulfilment System origins using the normal test-account sign-in. Verify facility autofill, displayed quantities, role restrictions and idempotent allocation confirmation. Do not use real dispatch orders for these tests.
9. Re-run affected historical orders after deployment. Stored old audit findings are not rewritten by this correction. Approve production readiness only after live service access and all outstanding checks pass.

## Repeating the controlled local validation

The browser script creates an isolated `/tmp` build and substitutes providers only in that test build. It never modifies production authentication or points its writes at Firestore. Install Playwright/Chromium in a temporary testing location if not already available, then run:

```sh
ORDERCHECK_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node --import tsx scripts/validate-browser-workflow.mts
node --import tsx scripts/validate-facility-directory.mts
```

Optional `ORDERCHECK_VALIDATION_DIRECTORY` and `ORDERCHECK_VALIDATION_PORT` isolate concurrent browser runs. The directory sweep accepts `ORDERCHECK_BASELINE_PATH` pointing to a preserved pre-change `generalFacility.ts` module for decision comparisons. Without it, current-directory checks still run but no baseline comparison is claimed.

Machine-readable results: [validation/operating-results.json](validation/operating-results.json). The included screenshot, [verified-multivitamin-audit.png](validation/verified-multivitamin-audit.png), is from the synthetic local account and controlled slow-backend case.

## Files changed for this follow-up

Application fixes: `server/generalOrderInterpretation.ts`, `server/generalSemanticAudit.ts`, `src/utils/generalAuditTypes.ts`, `src/utils/generalAuditor.ts`, `src/utils/generalFacility.ts`, `src/components/GeneralAuditDetails.tsx`, `src/components/GeneralFulfillmentSummary.tsx`, `src/App.tsx`.

Regression coverage: `server/generalProductReviewIsolation.test.ts`, `server/servedFacilityDirectory.test.ts`.

Validation tooling/evidence: `scripts/validate-external-services.mts`, `scripts/validate-facility-directory.mts`, `scripts/validate-browser-workflow.mts`, `scripts/validation/firebase-client.fixture.ts`, `scripts/validation/firebase-admin.fixture.ts`, this report and `docs/validation/*`. Existing shared bundles are regenerated by the normal build when their dependencies change. No deployment settings, credentials or authentication policies were changed.

All changes remain local and uncommitted; earlier unrelated workspace edits were preserved.
