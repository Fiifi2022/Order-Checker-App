# Audit regression safeguards

## Release gate

Run `npm run verify:release`. It rebuilds the website, server and shared extension
engine, type-checks the application, and runs every server/extension test. Both
GitHub CI and the Railway Docker build use this command. A failure prevents the
new image from being released; running Railway directly cannot skip the gate.
No production allocations, audits, credentials or AI calls are required by these
fixture tests. The Firestore emulator test remains optional when no emulator is
configured.

## Product matching rules

- Catalogue IDs and approved aliases establish identity. Catalogue edits
  invalidate cached resolutions; rejected/deactivated aliases stay protected.
- Two remaining unmatched rows are never paired by elimination. Review grouping
  requires a repository relationship, related product descriptions, or a
  retained AI suggestion. A suggestion cannot consume an unrelated diluent or
  dropper and cannot approve an alias or clear an audit.
- An unidentified counterpart prevents a proven missing/extra classification;
  those source rows remain separate and uncleared. When both products are known
  and different, genuine missing and extra findings remain enabled.
- Before returning a product as matched, out of stock, or order-limit approved,
  the shared evidence guard rejects contradictory canonical IDs. This guard
  stops an inconsistent result; it does not invent a replacement product.
- Stock availability, product identity and quantity validation remain separate.
  Existing order-limit decisions and vaccine companion rules are preserved.
- Historical display wording is normalised without rewriting source evidence
  or making an unresolved audit pass.

### Separate strengths and presentations (2026-11-04)

A broad catalogue ID must not collapse different strengths into one quantity.
The General Auditor partitions conflicting source presentations before grouping
quantities, even when approved aliases share an ingredient-level catalogue ID.
Each presentation receives its own comparison key, stock status and order-limit
decision. This also keeps separate formulations, container sizes and
concentrations apart when they are listed as separate source products. Harmless
word order, omitted formulation with a unique compatible strength, and
mathematically equivalent concentrations remain supported. Identical duplicate
lines aggregate only within the same presentation.

The shared evidence guard also rejects a cleared row containing conflicting
stated strengths. A broad alias cannot erase a genuine 60mg-versus-120mg
difference. Existing approved single-presentation packaging mappings and
vaccine-specific catalogue/companion rules are preserved. No catalogue data,
allocation records or AI settings change.

`server/generalProductVariants.test.ts` covers matching and swapped 60mg/120mg
quantities, omitted strengths, source order, stockouts, duplicate lines,
independent order-limit approval, broad/specific/empty catalogues, formulations,
sizes, concentrations, percentage strengths (including D5%/D10% shorthand),
equivalent concentration wording and the runtime guard. The 16 focused tests pass;
the full release suite passes with 1,956 passed, zero failed and one optional
Firestore emulator test skipped (1,957 total).

## Add every reproduced incident to the regression library

Add anonymised source messages to
`server/fixtures/general-audit-real-orders.json`, with expected match status,
quantities and optional explicitly approved order-limit product names. Remove
tracking identifiers and contact details. Keep genuinely conflicting controls
as failing audits, so a fix cannot pass by suppressing every discrepancy.

The Auntie Riek BCG/YF/stockout case is included. Dedicated tests also cover alias
punctuation, product ordering, unrelated unmatched products, required diluents,
stale alias removal, approved/rejected alias decisions, displayed legacy messages,
and injected canonical-ID inconsistencies.

These controls prevent tested regressions and catch contradictory results. They
cannot guarantee that every future spelling or incomplete message is understood;
unverified products remain uncleared until supported by the catalogue or verified
correction.

## Choosing a Gemini suggestion

Unknown descriptions can show a **Gemini product suggestions** section in the
website and extension. The model can offer up to three compatible products from
the existing catalogue, with a reason for each. Invented IDs, unrelated input
aliases and conflicting explicit clinical attributes are discarded.

Choose a product, verify that it is the same product (including stated strength
and formulation), then select **Confirm match**. Existing catalogue
editors can approve the alias through the same authorization, revision/conflict
checks and alias history as the catalogue editor. Read-only users must ask a
catalogue editor to approve it. Rejected, deactivated or differently approved
aliases cannot be silently overridden.

The client confirms the saved approval and applies it to retained product evidence
in the same audit. Existing order-limit decisions are preserved. Changed source
messages cannot be confirmed, and a new audit resets the selection/verification checkbox. Saved pending
suggestions are reused without another Gemini request. If Gemini fails or cannot
offer a supported catalogue candidate, the order remains uncleared and the UI
asks for a clearer product name or verified catalogue record.


Verified Gemini choices now mark the existing audit through `catalogue-confirmation`.
The endpoint checks unchanged inputs, audit ownership and a durably approved alias,
then reconciles retained product evidence using the same catalogue comparison code.
It does not extract the messages again, call Gemini, create a new audit, or waive
quantity, stockout, facility or orderer checks. A confirmed write updates the current
result; failure offers retry on the same audit ID. Confirmation receipts are idempotent.

## Universal natural-language extraction

`shared/orderText.ts` owns literal count spelling, request prefixes, title stripping
and explicit negative-count protection. `generalSentenceExtraction.ts` projects
source-backed introductions and catalogue-backed compact orders. The General
Auditor and vaccine confirmation parsers reuse these helpers; the website and
extension submit the same original evidence to the production engine.

An explicit count wins over descriptive wording such as “full course”. Without a
count, a course remains unresolved; neither a course size nor a vial unit is
invented. Bare ARV remains ambiguous. ARV venom can resolve to ASV only through an
approved whole-label catalogue mapping; provider suggestions remain unapproved
until a user verifies them. Word counts and postfix multiplication cannot overwrite
a complete catalogue product name or a vaccine identity such as OPV one and three.
Negative stock balances remain untouched, and blood Rh-minus signs remain identity.

The four General checks remain facility, orderer, products and quantities. General
results expose `outcome` as No Discrepancy Detected, Needs Review, or Discrepancy
Detected. Existing confirmed-order and stockout headlines remain available. Optional
metadata and patient details cannot supply missing required fields. Only redacted,
unresolved snippets are sent to extraction AI; verified aliases are reused locally.

Fulfilment Only retains its existing confirmation/allocation policy: without a
customer request it cannot perform an independent customer comparison. Vaccine
identity, companion pairing, doses/vials, allocation limits and confirmation
transactions remain authoritative. No allocation is changed by the General Auditor.

Regression coverage: `universalOrderExtraction.test.ts`, the updated natural-language,
interpretation, stock, acronym and vaccine parser suites, and `companionVaccine.test.ts`.
The latter exercises verification, confirmation, exact deductions and same-evidence
retry for both vaccine audit modes using isolated storage. No production allocation
records are used or changed by these tests.

### Actionable product and quantity extraction reviews (4 November 2026)

General Auditor source-extraction warnings previously displayed review instructions
without a save action. The website and extension now place source-specific product
and quantity fields, an explicit verification checkbox, and **Confirm Products &
Quantities** directly beneath the warning. Missing or ambiguous counts can be
entered there. Product identity suggestions and order-limit decisions retain their
existing separate controls.

`POST /api/audits/:id/review-confirmation` verifies ownership, original messages and
input fingerprint under the existing audit mutation lock. It records the CCA,
timestamp, original text and confirmed values on the same audit. Retrying the same
decision is idempotent. Only the selected review is resolved; source evidence is
reconciled using the existing catalogue engine and deterministic quantity checks.
A confirmation cannot rewrite an already-read product or count, bypass different
strengths, approve an identity alias, or clear unrelated discrepancies. No Gemini
call, catalogue registration or vaccine allocation write is part of this action.
Confirmed source values survive history reads. Save failures retain the original
result and display an inline retryable error rather than claiming clearance.

Regression coverage: `server/generalReviewConfirmation.test.ts` exercises actual
WhatsApp-plus-FS extraction, mounted website controls, extension controls, source
isolation, quantities, stockouts, order limits, identity differences, authorization,
stale messages, same-ID retries and failed saves.

Product review names are now picked from retained customer-source evidence or
that source's extracted view and displayed as text. The product-name text box and
blank add-product row have been removed from the website and extension. Review
wording can link to an existing product without requiring an exact whole-line
match; strengths remain part of each source name. Labelled unquantified product
lines can supply the name without supplying an invented count. A fulfilment name
or quantity never fills an unread customer request. The server validates any newly
represented entry against the same source picker before saving the confirmation.

Form instructions such as asking a customer to specify the following information
are classified as administrative text through a closed, whole-phrase grammar.
They cannot create product review cards or trigger extraction AI on their own.
Appended products, quantity instructions and identity amendments remain auditable.
The catalogue auditor returns the reviews retained by final validation rather
than restoring the raw extraction review array. History/client revalidation also
removes obsolete administrative reviews, even when an earlier response marked
those reviews as requiring confirmation. Actual unread product/quantity evidence
keeps its source-specific confirmation controls. Regression coverage:
`server/generalFormIntroduction.test.ts`.
