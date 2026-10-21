# Firestore read investigation and reduction

## Finding and evidence boundary

The supplied Firebase console figures (50,825 reads / 50,000 daily allowance, 108 writes, zero deletes) are the production baseline supplied by the operator. No production per-route breakdown was available. This investigation therefore identifies expensive query shapes and frequencies from the source and validates changes locally. It does **not** attribute all historical reads to a particular component or claim an observed reduction in Render's billed reads.

The 1,509 distinct served facilities are already a backend-only bundled reference (`server/data/served-facilities.json`). They are not 1,509 separate Firestore document reads on startup, typing, or every audit. The managed additions/removals use one revisioned Firestore document. Blueprint facility names/IDs/verified aliases are also read as supplementary identity evidence from district sheet documents; one sheet can contain many facility rows. Facility-row count and billed document count are different units.

## Sources inspected

- Client Firebase code, all frontend fetches/effects, timers, catalogue reminders, AuthGate and React StrictMode.
- Express authentication, all direct Admin SDK queries and transaction reads, catalogue middleware, managed facilities, audit/history/KPI routes, Blueprint, DHD inventory and companion endpoints.
- Extension popup receiving reminders, background/FS message handlers, connection repair and live lookup paths.
- Firebase rules, Admin credentials initialization and existing deployment/start/build configuration.

There are **zero Firestore `onSnapshot` listeners** in the application. The `onSnapshot` callback in extension connection helpers describes a Chrome tab snapshot, not a Firestore subscription. There were no duplicate Firestore listeners to remove. StrictMode stays enabled; the existing polling timer cleans up on unmount. Product text is interpreted locally in the portal; typing does not query the facility database. Elapsed-time UI timers do not make database requests. The extension does make debounced receiving-hint requests; see batching below.

## Expensive read paths and changes

| Component / operation | Before | After |
| --- | --- | --- |
| Visible Blueprint, every 3 seconds | All `S` district documents, role lookup, registration metadata join, and product catalogue | One current sheet document and one current role lookup; no catalogue lookup |
| Authenticated API request | Fresh role query plus registration-profile query when a role exists | Fresh role query; registration details loaded by `/auth/me` when displayed |
| Process startup | Activity log hydration (up to 150), all activity logs and vaccine transactions for history, all Blueprint sheets | Only the bounded activity log hydration; history and sheets load when their feature needs them |
| App startup as administrator | Whole role collection and profile collection via automatic `/roles` request | No automatic team-directory request; still loaded when role management is opened |
| Portal receiving hints, two panels | Independent catalogue request per mounted panel, including concurrent StrictMode effects | One in-flight request shared by the same Firebase user object; subsequent completed requests revalidate |
| Concurrent product/directory reference reads | Duplicate independent reads | Only in-flight reference reads shared; no TTL and no completed/stale fallback cache; successful managed edits invalidate pending readers |
| Extension hints with both fields populated | Two sequential authenticated requests and two catalogue reads per debounced update | One batched request and one current catalogue read; legacy single-text API remains supported |
| KPI filter controls | Four collection scans for every intermediate filter change | Filters explicitly applied together; Refresh and Export remain available |
| Raw vaccine transaction/audit history and DHD inventory reads | Unrelated product catalogue read before returning saved data | Catalogue read skipped where no product interpretation occurs |

The Blueprint refresh interval is **still three seconds**. The new endpoint is `GET /api/vaccine/blueprint-districts/:id/current`. It reads Firestore each time and sets `Cache-Control: no-store`. It does not cache balances or replace the server's full allocation state with a partial sheet. The UI updates only the active sheet and preserves other local sheets and unsaved edits. It compares the returned sheet itself, so a balance change is detected even when a writer fails to change `updatedAt`. Failed reads keep visible data with an explicit stale-data warning and last successful check time. Timers, focus listeners and in-flight UI requests are cleaned up.

Removing eager history hydration also required on-demand hydration in the Vaccine Dashboard and vaccine audit-log route. Existing atomic confirmation reads and idempotency checks remain intact. No allocation confirmation transaction was replaced by a cached decision.

## Read estimates

Let `S` be the number of saved district sheet **documents**, `A` saved audit documents, `L` activity documents, `T` vaccine transaction documents, `R` role documents and `P` registration documents. Empty queries have a minimum read charge; SDK retries and index-entry charges can add reads. See the [official Firestore pricing documentation](https://firebase.google.com/docs/firestore/pricing). The estimates below assume successful queries, an existing catalogue, one returned authorization role and no retries.

| Operation | Before minimum estimate | After minimum estimate |
| --- | ---: | ---: |
| General audit backend request | `max(1,S) + 4` | `max(1,S) + 3` |
| Blueprint refresh request | `max(1,S) + 3` | `2` |
| Two-field extension receiving-hint update | `6` | `2` |
| Sign-in registration + access checks | `3` | `3` |
| Initial Blueprint load (all sheets) | `max(1,S) + 3` | `max(1,S) + 2` |
| Browser startup, baseline production mount: sign-in checks, Blueprint, page-view log and OSU | `max(1,S) + 12 + max(1,R) + max(1,P)` | `max(1,S) + 7` |
| Server cold start | `max(1,min(150,L)) + max(1,L) + max(1,T) + max(1,S)` | `max(1,min(150,L))` |
| Served reference's 1,509 bundled records | `0` | `0` |
| Firestore listeners | `0` | `0` |

The browser-startup estimate excludes immediately opening another module, retries, overlapping refreshes, reminder panels, Gemini-status requests and diagnostics themselves. The browser test reports the actual local fixture startup requests separately, including dashboard initialization requests, rather than presenting this simplified estimate as a complete observed browser bill.

A General Auditor request still reads current supplemental Blueprint identity evidence, one managed directory document, one product catalogue document and its role. We did not cache that evidence indefinitely or stop recognizing saved aliases/IDs to manufacture a lower number. Saving an audit is a write, not an additional document read, unless a separate transaction/read is required. Actual follow-up requests must be counted separately.

For **12 sheet documents**, one continuously visible Blueprint tab makes 1,200 refreshes/hour. The modeled minimum changes from **18,000 to 2,400 document reads/hour (86.7% lower)**. This excludes startup, edits, focus-triggered refreshes, other tabs and other users. At one sheet the modeled refresh changes from 4 to 2 reads (50% lower). Multiple viewers still multiply consumption. Spark capacity is not guaranteed: for example three continuously active tabs over eight hours would still use about 57,600 refresh-related reads/day after this change.

## Diagnostics

`GET /api/admin/firestore-reads` is protected by the existing verified Firebase token and administrator role checks. Other roles remain denied. It returns process-local counters grouped by declared route category and collection:

- SDK read operations, including observed transaction read attempts;
- number of documents returned in successful snapshots;
- minimum document-read estimate (at least one per successful operation);
- failed operation count;
- process start time and explicit billing limitations.

It retains no document IDs, email addresses, order text, credentials, query values or document bodies. No public telemetry endpoint, new public data file or external monitoring service was introduced. Read the endpoint through an authenticated administrator request; its own fresh role lookup consumes an additional read and is included. Counters reset on Render restart and are per instance. They do not replace Firebase Usage: failed reads, SDK-internal retries and index charges may be billed without appearing as successful returned documents. Sampling/single-flight sharing attributes an underlying read to its initiating request, not every joining caller.

After deploying through the existing workflow, record counters for a representative work period, sort by `minimumReadEstimate`, compare Firebase Usage over the same period, and inspect unknown route groups if material. This is needed to establish which components are the **largest production contributors**; source frequency alone cannot prove their ranking.

## Repeatable validation

Use the project's supported Node runtime (Node 24.21.0 used here):

```bash
npm test
npm run lint
npm run build
node --import tsx scripts/benchmark-firestore-reads.mts
ORDERCHECK_VALIDATION_OUTPUT=/tmp/ordercheck-read-facilities.json node --import tsx scripts/validate-facility-directory.mts
```

The query-shape benchmark uses isolated in-memory data, invokes the actual selected-sheet handler and in-flight read helper, and writes `docs/validation/firestore-read-results.json`. It measures 1,200 selected-document handler reads for 1,200 polls and 20 independent reference reads versus one shared read for 20 simultaneous callers. Its before/after billed-document figures are **modeled estimates**, not cloud measurements.

The real React/AuthGate + Express + Chromium harness can be repeated with an installed Playwright module and Chromium:

```bash
ORDERCHECK_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
ORDERCHECK_VALIDATION_DIRECTORY=/tmp/ordercheck-read-browser \
node --import tsx scripts/validate-browser-workflow.mts
```

This explicitly aliases Firebase providers only in temporary validation bundles. Normal development, builds and production start continue using the real Firebase SDK and credentials. The test checks selected-sheet polling reads, absence of automatic team-directory loading, normal audits, synonyms, stock, quantities/specifications, order limits, facility/orderer mismatch, ambiguous text, a valid >3-second audit, extension-client verification, vaccine confirmation and retry, and fresh post-confirmation balances. It does not test a production user's sign-in or production Firestore transactions.

## Security, rollout and remaining limits

Email/password and Google sign-in, AuthGate, Firebase client configuration, verified-email requirements, token revocation checks, role authorization and Firebase rules are preserved. Role access is not cached; a role removal is still checked on the next authenticated request. Account/profile errors do not create an offline administrator or grant access. The privileged SDK stays server-side. Existing Render configuration, dependencies and service are unchanged; no new service was created.

There were existing uncommitted changes before this task. The read-efficiency changes are prepared in that same workspace; no commit, GitHub push or Render deployment was performed. Use the existing reviewed GitHub/Render release workflow. Both the new frontend and backend must be deployed together. Refresh existing browser sessions after deployment so old clients stop their full-catalogue poll; repackage/update installed extensions to receive batching changes. Rollback uses the existing release process; no database migration is required.

Already-exhausted daily quota is not repaired by a local code change. The service must regain available reads before real sign-in/profile loading can be verified. No paid-plan change is recommended here. No repeated production Firestore probes, cloud writes or paid Gemini calls were performed for this task.

Remaining expensive but explicit operations: KPI calculations still read their complete source collections when requested; full history/team management pages still read the selected full datasets; General Auditor and FS lookups still need current Blueprint identity evidence; fresh role checks and the retained three-second poll cost reads. Larger workloads may require further indexed pagination/aggregate design or a change-stream architecture with equally strong authorization/freshness guarantees. Those are not implemented by silently truncating reports, hiding older audits, caching permissions or caching live balances.

Live Render savings, actual cloud authentication and production allocation changes require post-deployment validation after quota recovery. Local regression results do not establish production readiness.

## Validation results for this change

- Node 24.21.0 full regression suite: **575 passed, zero failures, one skipped** (576 tests). The skipped test requires the Firestore emulator, unavailable in this environment.
- TypeScript check and production build passed; existing bundle-size warning remains.
- All **1,509** served facility records were checked again: **4,531 scenarios passed, zero failures and zero false verified matches**. This verifies directory consistency, not independent verification of uploaded aliases.
- Local Chromium + actual React/AuthGate + complete Express workflow passed with zero browser errors. The instrumented selected-sheet poll returned exactly **one role document and one sheet document**, with **zero product catalogue reads** and no automatic team-directory loads.
- The local fixture's diagnostic snapshot showed 17 minimum-read estimates across initial requests, including one server hydration query, one two-read sheet poll, and one diagnostic request. These are in-memory SDK-result counters, not actual cloud billing. Full per-route details are in `docs/validation/firestore-browser-results.json`.
- Vaccine confirmation changed OPV balance **20 → 17**; retry left it **17**. The new fresh-sheet endpoint returned **17** after confirmation. Atomic/idempotent transaction behaviour passed the local provider tests; real Firestore transaction integration still requires the emulator or an approved cloud environment.
- Browser checks also passed exact product matching without Gemini, product synonyms, stock handling, quantity/specification discrepancies, order-limit acknowledgement, facility/orderer mismatch, ambiguous-field review, a valid audit taking over three seconds, and the extension's backend client.
- Firebase security rules, client authentication files and dependencies were not edited by this task. Production output contains no synthetic validation tokens or fixture modules.

Machine-readable evidence: `docs/validation/firestore-read-results.json`, `docs/validation/firestore-browser-results.json`, `docs/validation/firestore-facility-results.json`.
