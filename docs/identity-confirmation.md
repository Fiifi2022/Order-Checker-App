# General Auditor identity confirmation

The website and extension use the same identity policy and saved decision endpoint.
Exact meaningful name tokens can appear in any order. Standard facility abbreviation
normalization and unique verified directory aliases remain automatic matches.
Spelling guesses, uncertain initials and omitted name components require the CCA.
Gemini supplies evidence for suggestions; it cannot approve uncertain identities.

Each identity result card presents Confirm Match and Reject Match immediately below
its suggested action. A saved decision replaces only that field's status and removes
only its associated identity reviews. Change Decision reopens the original result.
Products, quantities, order limits and vaccine allocation records are untouched.

`POST /api/audits/:id/identity-decision` requires the authenticated owner or an
administrator, current source messages, their fingerprint and previous decision
revision. Requests are serialized with other mutations of the same audit. Retry of
a completed action is idempotent. A stale action receives HTTP 409. A failed audit
write receives HTTP 503 and is not presented as a saved decision.

The original values, CCA identity, timestamp, action and revision are retained in
the field's identityHistory inside the existing audit document. Verification scores,
summary, metadata and history use the rebuilt shared result, without a new audit
or Gemini call. A rejected decision can never leave the audit marked resolved.

Saved variations in the server-only identity_variations collection are suggestions,
not new customer identities or unreviewed facility directory aliases. Customer
suggestions are scoped to the facility context and an exact normalized name pair.
The most recent decision is checked before name/facility Gemini fallback. Previously
confirmed variations still require a decision on a new uncertain customer order;
rejected variations are never learned as accepted aliases. Reset deactivates the
suggestion. An unavailable suggestion lookup never verifies a field.

Fulfilment-only workflows retain their existing behavior: a missing comparison
value is never fabricated to enable an identity confirmation. The inline controls
apply wherever both compared identity values exist in a General Auditor record.

Coverage: server/generalIdentityDecision.test.ts tests matching policy, independent
field updates, unrelated discrepancies, confirmation/rejection/reopening, ownership,
source/revision guards, idempotence, failed persistence, scoped learning, DOM placement
and the extension controller. Existing name/stockout fixtures reflect the requirement
that shortened or misspelled names need CCA confirmation.

Facility recurrence safeguards:

- A bare Location naming a complete facility is retained as identity evidence when
  no explicit ordering facility/organisation is present. Directions and street
  addresses are not converted into facilities.
- Parenthetical district/region omission is accepted through that directory record's
  own district/region metadata. Organisation labels, unverified qualifiers and
  conflicting official IDs are retained.
- The engine, facility card and summary use the same facility verification function.
  A fuzzy directory candidate is not an approved alias, and a pending status must
  never be displayed as green while hiding its inline buttons.
- Re-running the same audit restores explicit decisions only for unchanged sources,
  identical compared values and the same audit ID. Saving also merges the latest
  stored decision inside the Firestore transaction, preventing an older queued
  result from overwriting a confirmed/rejected/reset decision. Newer local decisions
  win over older stored revisions. A new audit does not inherit customer approval.

Regression coverage: server/generalFacilityRecurrence.test.ts includes the supplied
Akanteng / Akanteng (West Akim) case, geography and address safeguards, UI consistency,
all three saved decision states and stale/new-order isolation. Its 20-to-10 quantity
reduction remains subject to the existing order-limit decision.
