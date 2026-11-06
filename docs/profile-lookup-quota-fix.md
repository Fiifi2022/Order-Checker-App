# Railway profile lookup failure — 1 November 2026

## Diagnosis

Railway logged Firestore `8 RESOURCE_EXHAUSTED: Quota exceeded`. A separate,
read-only REST probe confirmed HTTP 429 / `RESOURCE_EXHAUSTED` for the existing
catalogue document. The account owner confirmed the Firebase project uses the
free Spark plan. A billing-status probe returned 403 / `PERMISSION_DENIED`; no
billing settings were read or changed.

This is a database availability failure. It does not establish that the
customer's role or profile document is missing. No profiles, roles, users or
allocations were recreated, changed or deleted.

## Fix

- Account endpoints distinguish quota exhaustion, server database permission
  failures and other service outages. They return a safe 503 category without
  raw provider messages, rather than treating an unread profile as absent.
- Verified existing accounts check their approved access first. They avoid the
  extra preliminary registration lookup; server authorization still checks
  current stored roles for every protected request.
- Registration lookup occurs only for an unverified account or a confirmed
  unassigned account. Other 403 errors and all service failures stop the flow.
- The website shows the new-profile form only after a successful registration
  read confirms that no profile exists. An outage shows a manual retry instead
  of new-profile or awaiting-approval prompts.
- A user-triggered retry can recover once the database becomes available.
  No polling or stale authorization fallback was introduced.

Changed files: `server/accountAvailability.ts`, `server/auth.ts`,
`server/registration.ts`, `server.ts`, `src/utils/loadAccountAccess.ts`,
`src/components/AuthGate.tsx`, `server/accountAvailability.test.ts`.

## Validation

Focused account/authentication tests: 23 passed. Full suite: **1,480 passed,
0 failed, 1 skipped** (Firestore emulator integration). TypeScript, production
build and whitespace checks passed. Existing bundle-size warnings remain.

Deployed to Railway as `8a442d31-aaa9-47ed-8e92-34c4bc1ab68c`, confirmed
`SUCCESS`. The new deployment passed `/api/health`. It changes error handling
and the account-loading flow; it cannot restore exhausted provider quota.

## External action required

Code cannot remove the provider's free-tier quota. Wait for the daily reset or
choose an appropriate paid Firebase plan in the project console. Billing and
any spending controls remain the account owner's decision. The hosting move
does not increase Firestore quota.

References: [Firestore quotas](https://firebase.google.com/docs/firestore/quotas),
[Firestore pricing and billing](https://firebase.google.com/docs/firestore/pricing).
