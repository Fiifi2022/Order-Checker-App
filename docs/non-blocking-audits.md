# Continuous audit workflow

The website and extension request a deterministic product/name comparison first.
Unresolved product terminology and uncertain identity pairs are queued on the same
saved audit, then researched in the background. Independent results remain visible
and their confirmation controls remain usable. Legacy clients retain the existing
bounded synchronous path.

## State and decisions

The shared resolution queue derives its states from saved source evidence,
catalogue suggestions, identity decisions, quantity findings and confirmations.
It uses the original audit ID and messages; it does not introduce another verdict
engine or district/drop-area comparisons. States cover pending research, suggested
resolution, awaiting CCA confirmation, confirmed, rejected and unresolved discrepancy.
Completed checks are summarized separately; the detailed queue appears only when
attention is needed.

Confirm & Resume uses the existing transactional approval and saved-audit
reconciliation. It never submits another `/api/verify` request. Product approval
does not waive quantities, stockout/order-limit rules, identity checks or clinical
attributes. Reject excludes that candidate without learning an alias. Keep
Discrepancy records the CCA and time, retains a reported discrepancy in the summary,
and prevents automatic research from replacing that decision. Search Again is an
explicit retry and does not bypass Gemini quota cooldown.

Research does not hold the audit mutation lock while waiting for a provider.
Before saving, source fingerprints, ownership and per-issue revisions are checked
again. Product research results are saved together in one audit transaction; current
identity/quantity findings are merged from storage. Identity research only stores
advisory suggestions. Neither it nor public search can confirm a facility/person.
Late browser responses merge research fields only. Extension responses/failures
wait for a manual save in progress instead of invalidating that save's UI response.

## Performance and usage

- Exact catalogue/approved aliases require no terminology research.
- Up to 24 unresolved product names share a model request with bounded catalogue
  candidates. Duplicate in-flight batches and safe cached results are reused.
- Uncertain orderer/facility pairs share a separate advisory request, with a
  bounded cache. Identity research never enables public search.
- Existing timeouts, 429 cooldown, selective opt-in medical-only grounding and
  server-side credentials remain in force. Failed AI leaves comparison results intact.
- Administrator-only `GET /api/gemini-usage` reports actual provider requests,
  failures, reported input/output/total tokens, responses missing token metadata,
  grounded responses and returned search-query counts. These process-local
  counters reset on restart; they are not a billing ledger or estimated charges.

Regression evidence includes ten recognized products completing while an eleventh
is queued, two unknown terms sharing one request, zero repeated requests on a cache
hit, CCA confirmation without re-auditing, and late-response/failed-research races.
These are mocked-provider checks, not a production latency guarantee.

## Limits and deployment

Source-grounded extraction can still make a bounded initial AI call when message
structure is unsafe to parse deterministically. This protects extraction quality;
the app does not guess missing fields to return faster. Unknown clinical identities
remain unapproved until a CCA verifies them. Research requires the client to remain
open long enough to submit its background request; there is no durable worker queue.
Opening the saved audit resumes research still marked deferred.

No new package, API credential, paid plan or production configuration is required.
Existing research model/timeout settings apply. Google Search remains opt-in and
may incur provider charges. Deploy the server and matching website/extension code
together. No production deployment or billing change is part of this local update.

## Changed files

- `shared/generalResolutionQueue.ts`, `productResearch.ts`, `productResearchClient.ts`
- `server/productResearch.ts`, `productResearchActions.ts`, `generalIdentityResearch.ts`,
  `generalProductNameAudit.ts`, `geminiUsage.ts`, and `server.ts`
- `src/utils/generalAuditor.ts`, `generalAuditTypes.ts`
- `src/components/GeneralResolutionProgress.tsx`, `GeneralInventory.tsx`,
  `GeneralCatalogueSuggestions.tsx`, and `src/App.tsx`
- `extension/audit.js`, `general-report.js`, `general-auditor-entry.ts`, and rebuilt bundles
- `server/generalContinuousWorkflow.test.ts`

Vaccine allocation, Blueprint deduction and FS integration code are unchanged by
this update and remain covered by the release regression suite.
