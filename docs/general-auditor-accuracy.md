# General Auditor accuracy changes — 4 November 2026

These changes apply to the website General Auditor. No deployment, push or commit was performed. The production website has not been verified with this revision.

## Root causes and corrections

1. The shared standalone-name parser requires a product entry before considering a header name. This incorrectly loses a name-only customer message. A General Auditor wrapper now searches the actual source for person candidates and corroborates them against the independently extracted FS name. It does not copy an absent identity from FS.
2. Several unlabelled people were discarded as a missing name. They now produce an ownership-confirmation finding, retaining the actual candidates. Patient, physician, contact, facility, geography and incidental collection mentions cannot supply the orderer.
3. Local product suggestions depended on the AI request-language policy. The website General Auditor now enables its deterministic source-candidate suggestions independently. The existing product-by-product parser and final FS-candidate filter remain authoritative.
4. Uncertain identity confirmation lacked an explicit acknowledgment. New website audits require one before approval; it resets by audit, source values and decision revision. Reject and Change Decision remain available. The server enforces acknowledgment, source fingerprint, ownership, revision and idempotent retry.
5. Product confirmation and permanent alias approval were coupled for catalogue suggestions. Website users can now confirm only the current audit, with a separate opt-in for permanent alias learning. Facility alternate-name learning also requires its own explicit opt-in. Personal-name confirmations remain in the audit history, without creating new cross-audit identity-variation records.
6. Identity recovery initially parsed product lists again. It now reuses an identity-only export of the existing pure parser. Existing parser behavior is unchanged.

The existing verified normalization-learning rule is preserved: safe deterministic normalized wording can still reuse and record its already established catalogue identity. This is distinct from learning an unfamiliar or AI-proposed equivalence, which requires explicit approval.

## Actual comparison flow

`POST /api/verify` selects the website-only policy and smart-matching flag. Each original source is retained. `runGeneralProductNameAudit` recovers source-local identity evidence, parses individual product entries, checks direct names and clinical attributes, then uses the catalogue and approved aliases. Unknown identical products can match without AI or catalogue registration. Missing, extra, strength, formulation, device-size and quantity differences remain subject to the existing deterministic final gate.

A partial or misspelled personal name requires confirmation. Exact meaningful words in a different order can match. Trusted facility records and approved aliases retain their existing precedence. District and dropsite do not become required comparison fields.

Each product suggestion remains bound to the relevant parsed FS entry. No full confirmation script or unrelated FS product is introduced. Confirming a naming equivalence never waives a quantity mismatch. Stockout, partial-stockout, approved order-limit and vaccine-component rules remain unchanged.

Confirmed/rejected decisions update the same audit and retain actor, original values, timestamp and revision history. A new audit is not required. Failed writes do not report successful approval.

## AI configuration and failure behavior

`GENERAL_AUDITOR_MODEL` is optional and server-side. Blank preserves the current model. It overrides only non-grounded requests through the website General Auditor context; Vaccine Checker, fulfilment-only, companion extension and public-grounding model configuration are unchanged. Model selection is included in the context cache key. No provider or billing change is required by default. A configured model must be available to the account and may have its own charges.

Existing bounded AI timeouts, quota cooldown, structured responses, source validation, clinical checks and deterministic quantity decisions remain in place. Exact/known matches do not need AI. AI failure leaves unresolved comparisons available for CCA review while independent checks continue. No live paid AI request was used for these tests.

## Modified files

| Files | Purpose |
|---|---|
| `server/generalOrdererExtraction.ts` | General-only source name recovery and extraction-status metadata |
| `server/generalProductNameAudit.ts` | Scoped recovery, uncertainty handling, local suggestions and partial-name safeguards |
| `src/utils/generalAuditor.ts`, `src/utils/generalAuditTypes.ts` | Identity-only parser export, support flag and optional metadata; existing parser behavior unchanged |
| `server/generalAuditorInstructions.ts`, `.env.example` | Optional scoped model configuration and cache-version isolation |
| `server/generalIdentityDecision.ts` | Server acknowledgment enforcement and explicit learning policy |
| `server/generalProductChoice.ts` | Audit-local product confirmation without permanent alias creation |
| `server/productResearchActions.ts`, `shared/productResearchClient.ts` | Carry the explicit alias-saving choice; preserve legacy callers |
| `server.ts` | Website policy boundary and transactional audit-local product confirmation |
| `src/components/GeneralIdentityCard.tsx` | Inline acknowledgment, optional facility alias approval and reset behavior |
| `src/components/GeneralCatalogueSuggestions.tsx` | Optional product alias approval |
| `src/components/GeneralInventory.tsx`, `src/components/GeneralAuditDetails.tsx`, `src/App.tsx` | Bind controls to the active audit, retain decisions and display extraction statuses |
| `extension/general-auditor.js` | Regenerated bundle of shared General result components; protected extension requests do not enable the new policy |
| `server/generalMasterExtraction.test.ts`, `server/generalMasterConfirmation.test.ts` | New extraction, matching, acknowledgment, reset, error and audit-local approval regressions |
| `server/generalAuditorInstructions.test.ts` | Scoped model configuration regression |
| `server/companionVaccine.test.ts` | Existing route harness reused to exercise the actual General API handler and protected-mode boundary |

No Vaccine Checker, Blueprint, FS integration or allocation-deduction source was changed. The shared identity parser only gained an export; its implementation is unchanged. Existing callers do not enable the new General-only flag. The protected-mode regressions and extension tests remain part of the full suite.

## Executed validation

Commands used:

- `node --import tsx --test server/generalMasterExtraction.test.ts server/generalOrdererName.test.ts server/generalNaturalLanguageGaps.test.ts server/generalFsSuggestionFlow.test.ts` — initial extraction phase: 103 passed.
- Matching phase (master extraction, comparison priority, product variants, FS suggestions, stockout catalogue, facility matching): 91 passed.
- AI phase (General instructions, quota, product research, extraction assistance): 43 passed.
- Confirmation phase (master confirmation, identity decisions, FS suggestions, catalogue suggestions, source review): 64 passed.
- API-route phase (companion route harness, master extraction and confirmation): 69 passed.
- Post-optimization regressions (master extraction/confirmation, orderer matching, FS suggestions, actual API route): 126 passed.
- `npm run lint` — passed.
- `npm run build` — passed; existing bundle-size advisory remains.
- `npm test` — **2,045 tests: 2,044 passed, 0 failed, 1 skipped** (67.61 seconds on the final run).

The suite covers standalone, labelled, sentence, reordered, misspelled, three-word, different, absent and multiple names; source-supported FS-assisted recovery; trusted/different facilities; known, unknown-identical and aliased products; multi-product FS suggestions; unrelated entries; unspecified/different strengths; formulations, syringe sizes and equivalent concentrations; quantity differences; numbering and `20/20`; `0/N`, partial stockouts and order limits; missing/extra/duplicate products; CCA confirm/reject/change; quota/timeouts; history and protected modes.

API-route tests execute the real handler extracted from `server.ts`, using the real General engine and in-memory storage/provider boundaries. Mounted React tests execute acknowledgment and same-audit actions. These are local end-to-end checks, not live Railway/Firestore verification.

## Performance and limitations

Twelve-run local warm-engine comparison, same known-product fixture and catalogue:

| Measurement | Median | p95 |
|---|---:|---:|
| Original baseline | 153 ms | 163 ms |
| New recovery before duplicate-parsing removal | 165 ms | 180 ms |
| Final recovery | 163 ms | 176 ms |

The added checks have a small measured overhead versus the original baseline; no broad speed improvement is claimed. The optimization removes unnecessary product parsing without sacrificing source validation. All ten diagnostic cases used zero AI calls. Exact/reversed names matched, spelling and multiple people remained uncertain, different people failed, and patient/incidental names were not promoted to orderers. A name-only message matched the name field but still could not clear absent facility/products.

One cold, instrumented website-profile audit took 421.26 ms: orderer-identification stages 3.31 ms, facility-identification stages 2.30 ms, product extraction 1.35 ms, normalization 0.03 ms, quantity verification 0.40 ms and final validation 1.52 ms. These are existing instrumented stages, not an exhaustive breakdown of all catalogue, setup and parsing work. AI calls: zero; unresolved comparisons: zero; discrepancies: zero.

Local fixtures and regression coverage do not establish 100% extraction accuracy for all future messages. Ambiguous ownership, incomplete clinical specifications and conflicting identities still require CCA decisions. Live network, Firebase quotas, Railway latency and provider availability were not benchmarked or changed. No zero-bug guarantee is possible.
