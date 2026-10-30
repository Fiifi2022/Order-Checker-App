# General Auditor speed changes

2026-10-30. Local implementation on `addition_of_vaccine`; nothing deployed.

The target is a complete General Auditor response in under ten seconds during normal service operation. A verified result cannot be guaranteed when authentication, Firestore, the host or the network is unavailable. The existing 20-second client and 18-second server safety deadlines remain; they were not shortened to manufacture faster audit results.

## Changes

- After authorization, start fresh facility-directory and optional Blueprint identity reads alongside the fresh catalogue read. Reuse only these request-local promises; do not cache permissions, allocations, directory removals or audit outcomes.
- Share one maximum four-second optional AI allowance across natural-language extraction and catalogue fallback. Previously each sequential stage could consume its own allowance. Coalesced callers are also bounded by their remaining allowance.
- Allow at most 200 ms of response waiting for optional alias writes. A write may finish afterwards; pending writes are never reported as saved or approved equivalences.
- Reduce the General Auditor's history-write confirmation wait from 1,500 ms to 200 ms. The authorized write continues, the stable audit ID is retained, and pending/saved/failed status plus existing safe retries remain accurate.
- Keep deterministic catalogue matches at zero Gemini calls. Preserve missing evidence, discrepancies, stockouts, approved limits and vaccine confirmation transactions.

The website and extension both use this backend path. The vaccine checker and allocation confirmation transaction lifecycle are unchanged.

## Measurements

`node --import tsx scripts/benchmark-general-latency.mts` exercises the current catalogue engine with 1,509 facility records and 410 catalogue products. Eighteen synthetic audits cover aliases, six-product orders, stockouts, quantity differences, missing evidence and natural-language requests.

| Local measurement | Before | After |
| --- | ---: | ---: |
| Mean engine processing | 80.93 ms | 76.66 ms |
| p95 / maximum | 146.87 ms | 138.54 ms |
| Gemini calls | 0 | 0 |

These CPU measurements exclude authentication, network, Firestore and browser rendering. The important changes reduce response waiting, rather than claiming a large CPU speedup.

The actual `/api/verify` route tested with isolated storage returned verified findings in **218.4 ms while the Firestore write was deliberately held open**. It reported `pending`; only completing the write changed it to `saved`. No vaccine allocation changed.

Raw synthetic measurements: `docs/validation/general-auditor-speed-results.json`.

## Verification

Regression coverage verifies concurrent fresh reference reads, required-directory failure, optional enrichment timeout, one shared AI deadline, SDK cancellation, zero-AI catalogue matches, pending optional alias writes, accurate persistence states and the actual API response while saving is delayed. The existing full suite also covers authenticating requests, stable-ID retries, catalogue aliases, stockouts, four-parameter decisions and vaccine allocations.

Final checks: `npm run lint` passed; `npm test` reported **1,432 passed, 0 failed, 1 skipped** (the Firestore emulator integration test); `npm run build` passed, with the existing large frontend chunk warning; `git diff --check` passed.

No live Gemini or production Firebase latency was measured. Cold starts and poor connectivity can still exceed the target; unresolved evidence continues to require review rather than being passed to meet a time limit.
