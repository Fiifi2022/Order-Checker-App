# Gemini availability and branch comparison

31 October 2026. No API keys were printed, changed or revoked.

## Findings

Both the local `main` branch and `addition_of_vaccine` read `GEMINI_API_KEY`
on the server and reuse a lazily created Gemini client. This does not establish
that the deployed services have the same secret or Google project; hosted
configuration was not accessed.

The inspected `main` branch has no Gemini usage indicator. Its screenshot
scanner returns a generic error rather than the current branch's quota-specific
fallback. It also uses AI for its speed-test endpoint and retries transient
errors, including 429. Fewer displayed quota notices therefore do not establish
that main has unlimited or token-free AI access.

## Changes

- All existing Gemini request paths share a 60-second quota pause per API client:
  General extraction, catalogue suggestions, orderer checks, language analysis,
  alias assistant and legacy/image generation. The pause starts after a 429 or
  structured `RESOURCE_EXHAUSTED` error. It does not generate polling requests,
  repeat alerts, change credentials, switch models or override provider limits.
- After the pause, only another user-triggered operation may attempt AI again.
  Continued quota failure starts another pause. Other client instances are not
  blocked by an unrelated client's quota failure.
- Existing catalogue-first matching and validated aliases remain the first path.
  Known orders continue without Gemini; unsupported evidence stays in review.
  No AI guess becomes an approved permanent alias automatically.
- The website status badge describes temporary AI unavailability and the
  availability of catalogue checks. Screenshot failure messages in both the
  website and extension point to pasting or typing source text instead.
- Screenshot failures no longer log raw SDK errors or return raw provider errors
  to the browser. These errors may contain private request data.

## Validation and limits

Tests cover cross-feature/client quota pauses, no extra SDK calls during the
pause, passive diagnostics, recovery after the pause, catalogue-only audits,
unresolved evidence, and the existing matching and allocation rules.

Full suite: **1,471 passed, 0 failed, 1 skipped** (Firestore emulator integration).
`npm run lint`, `npm run build` and `git diff --check` passed. The existing large
frontend bundle warning remains. No changes were committed or deployed.

This change does not provide unlimited Gemini access or remove token accounting.
Image transcription still requires an available AI service; text can be audited
without it. Live provider quotas and hosted API-key configuration were not tested.

## Gemini 3.8 Flash migration — 2026-11-04

The selected app model is now `gemini-3.8-flash`, centralized in
`server/geminiModel.ts`. Product/identity research, unresolved extraction,
facility/orderer assistance, catalogue alias assistance, semantic analysis and
the legacy/image wrapper all use this model by default. Existing research model
overrides remain explicit server settings. The production research and optional
grounding model variables are set to the selected model during deployment;
Google Search grounding remains disabled unless separately opted in.

Generation uses `thinkingLevel: LOW`, preserving existing local deadlines,
schemas, output limits, cancellation and single-attempt transport. Removed
legacy sampling parameters and the `thinkingBudget: 0` setting according to
[Google's migration checklist](https://aistudio.google.com/docs/whats-new-gemini-3.8#migrate-to-gemini-3-8-flash).
The legacy wrapper no longer translates newer model names back to Gemini 2.5.
No audit comparison, quantity, stockout, CCA or allocation rule changes.

The production key's model metadata request confirmed access to
`models/gemini-3.8-flash` with `generateContent` support. Synthetic live
generation checks returned Google's temporary HTTP 503 high-demand error after
one timeout; successful live generation has not been confirmed. Do not describe
those failures as missing credentials or a quota bypass. There are no automatic
model-switching retries: existing deterministic checks and pending CCA review
remain available while the provider is unavailable.

`server/geminiModel.test.ts` checks centralized routing, compatible reasoning
settings, preservation of schemas/timeouts, no silent downgrade in the real legacy
wrapper, and safe handling of HTTP 503. Provider checks use synthetic text only;
they do not create audits, learn aliases or change allocation balances.
The local release gate passed: 1,974 passed, zero failed and one optional
Firestore emulator test skipped (1,975 total). Railway's research and optional
search model variables were verified as `gemini-3.8-flash`; the search opt-in
remains unset (disabled). No API key, account plan or billing configuration was
changed.
