# General Auditor alias learning

The website and extension use the shared `runGeneralProductNameAudit` backend.

1. Resolve both source descriptions through catalogue names, approved aliases and clinical normalization first.
2. Learn a new normalized wording automatically only when the current transactional catalogue independently identifies one General product and the wording retains the product's required clinical attributes. Write proposal and approval history together. Never revive pending, rejected or deactivated mappings automatically, or change Vaccine Checker rules.
3. When deterministic identity is unresolved, give Gemini relevant canonical products, existing approved aliases and product descriptions from both messages. Prioritize independently resolved counterparts in the bounded candidate list. Never let quantity or availability substitute for identity evidence.
4. Save valid new Gemini suggestions as pending aliases under an existing product. An authorized catalogue editor must verify and approve the identity in Alias Management. AI confidence alone does not authorize a permanent clinical equivalence.
5. Approved aliases are read by subsequent audits without another Gemini identity request. Quantity, stockout, order-limit and identity validation still run independently.

Regression coverage: `server/catalogAliasLearning.test.ts`, `server/generalCatalogueAi.test.ts`, `server/generalProductNameAudit.test.ts`.

## Matching a product absent from the catalogue

The authenticated General Auditor can create a General catalogue entry when both source messages contain the same complete product description. Only spacing, case and grouping punctuation may differ; numeric token boundaries, strengths, forms and presentation qualifiers must agree. The fulfilment description becomes the canonical name and the customer wording is retained as an approved alias with provenance. Existing ambiguous, pending, rejected or deactivated mappings block automatic creation. The current catalogue is rechecked in the write transaction to prevent duplicate entries. This does not create vaccine allocation mappings or packaging conversion factors.

If a background catalogue write is pending or fails, `catalogueLearning` reports that state and zero confirmed saves. Matching source descriptions can still be compared for the current audit. Quantities and stock availability remain separate checks.

`Receiver:` and the common misspelling `Reciever:` are recognised customer-contact labels. A trailing Ghana phone number is separated from the name. An explicit orderer retains precedence. Ordering organisations in `Order request from …` are kept distinct from optional delivery locations. Plausible unresolved name spellings use the existing bounded Gemini name verifier, with the same evidence thresholds used elsewhere.

## Extraction assistance

Critical missing fields and unresolved request wording trigger the same bounded Gemini extraction path even without a recognised narrative introduction. Catalogue names from both checker scopes are available to deterministic extraction. The AI sees only unresolved source snippets and cannot replace fields already extracted reliably.

Proposed product counts must appear beside the exact product wording in that source, retain numeric boundaries and any stated unit, and resolve through the catalogue. Unitless counts remain unitless. Strengths, phone numbers and quantities in the other message cannot supply a missing count. Unhelpful responses retain a short cache window rather than holding unresolved extraction for five minutes. This improves coverage; it is not a guarantee of perfect extraction for arbitrary messages.

Gemini transport advertises a provider deadline of at least ten seconds, as required by the provider. The shorter local audit budget still cancels requests through an AbortSignal. An invalid short provider deadline must not disable all assistance. Unresolved structured extraction uses `gemini-2.5-flash` with thinking disabled for bounded response time; clear catalogue matches continue to bypass generation. The change does not introduce model switching or retries after quota failures.

### Structured blood requests (extension v2.3.60)
The shared product parser assembles adjacent, explicitly labelled `Blood Component`,
`Group` and `NB`/`Quantity`/`Qty`/`Units` fields into one product. It retains the
three original source lines and never takes a quantity from a referring physician's
contact information. Repeated/conflicting fields and incomplete ABO/Rh values do
not receive an inferred pairing.

Blood descriptions resolve generic component entries or uniquely matching group-specific catalogue presentations (including O-positive / O+ wording) through the current catalogue while
retaining ABO/Rh on the audit evidence and assignment key. Thus O-positive whole
blood and O-negative whole blood cannot have their quantities combined under a
generic Whole Blood repository ID. Explicitly conflicting component, group or
adult/paediatric specifications remain findings. A fulfilment-only adult qualifier
is retained in the displayed FS name; it is not inserted into the request or saved
as an equivalence. Qualified blood wording is not learned as a generic component
alias. Existing documented `[0/x]` stockout handling remains unchanged. Customer
and facility identity checks remain independent of product and stock status.

### Confirmed hospital aliases (extension v2.3.62)
The user-confirmed `Agona Swedru Municipal Hospital` name resolves to the existing
served-directory record `Agona West Municipal HSP (CR)`, including the confirmed
municipal-hospital wording without the region annotation. Standard HSP/Hospital,
capitalisation and word-order normalization apply within this approved mapping.
No official facility ID is invented and conflicting source IDs still block a match.
Other facilities continue using their directory record IDs and verified aliases.
Gemini can suggest unresolved hospital-name variants as well as primary-care
variants; the prompt receives relevant directory evidence and explicitly separates
suggestions from approved equivalences. Sharing a town/district or generic facility
type is insufficient to create a permanent mapping or clear a facility discrepancy.

### Paragraph-form FS confirmations (extension v2.3.63)
The Pepease hydrocortisone regression was an extraction failure, not an unknown
alias: the repository already resolved `injection hydrocortisone 100mg` and
`Hydrocortisone 100mg Injection` to the same product. A product sharing a paragraph
with the preparation heading and expected-delivery text was not extracted, leaving
only the customer product and producing a false missing-item finding.

The shared FS template projection separates known preparation/stockout headings,
quantity-terminated inline bullet entries and notification footers before parsing.
It preserves clinical punctuation, exact product names and quantities, unknown
instructions and original source evidence. Projection is idempotent. Structured
extraction now uses the current catalogue resolver when recognizing a product next
to a separately labelled quantity; optional `Delivery point` is recognized as drop
location information instead of triggering an unnecessary product-extraction call.
Gemini remains available for genuinely unresolved extraction and identity gaps.
No alias or product-specific exception is required for this regression.

### Extraction uncertainty before discrepancy generation (extension v2.3.64)
Unread product content is assessed independently from catalogue identity. An
unread request or confirmation cannot establish that an unmatched counterpart is
missing/extra. Those rows retain their original evidence and a specific amber
`Could not read all products...` finding; they are not counted as genuine
omissions, never clear an audit and never authorize an order-limit exemption.
Paired products with genuine count/strength conflicts and independent customer or
facility differences remain discrepancies. A complete, readable confirmation
still supports a genuine missing/extra finding.

Gemini receives unresolved, source-local fields before final classification. Its
existing confidence and exact-source checks remain mandatory. Failed, malformed
or timed-out model responses retain uncertainty; they cannot invent a field from
the opposite message. Unread prose is not sent to the catalogue-alias learner as a
new synonym. Clear source messages remain deterministic. The result carries
`extractionReadability` and `extractionAssistance` diagnostics for review/history.

The versioned real-order JSON library and provider-recovery tests run in the
existing npm/GitHub regression checks. Test concurrency is bounded at four to
avoid resource-driven failures on large suites. No live AI or inventory writes are
required for these tests.
A known product with an unread count remains an identified product with quantity
uncertainty; it does not suppress a genuinely extra product. An explicit
`No fulfilled products` statement is readable absence and still supports genuine
missing-product findings. A blank confirmation has insufficient product evidence
and remains unresolved. Client completion/JSON history restoration is covered by
the same uncertainty regression test.
