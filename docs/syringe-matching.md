# Catalogue-driven syringe matching

The shared matcher in `shared/syringeIdentity.ts` reads syringe capacity, needle
inclusion, gauge, length, intended use, safety mechanism and connector from each
catalogue entry. It applies to additional catalogue-defined sizes and types;
there is no default list of capacities in the matching algorithm. mL, cc,
microlitres and half-mL forms are normalized without changing order counts.

Whole approved aliases and canonical names come first. A unique compatible
specification can resolve ordinary wording; competing configurations and unfamiliar
brands require catalogue/Gemini suggestions and confirmation. Solo-shot wording
never proves needle inclusion by itself. Explicit conflicting capacities and
configurations cannot be approved as aliases, and order quantities cannot become
product aliases. Vaccine and General modes share this identity helper. Syringe
quantities remain counts; existing Blueprint confirmation transactions control
all deductions.

`server/syringeCatalogue.ts` performs the explicitly requested registration. It
reuses existing records and immutable names/IDs, stores the FS display names and
verified capacity/configuration, and deactivates invalid aliases with history.
No unrelated product, facility, allocation or historical audit is removed.

Confirmed catalogue labels:

| Existing stable identity | FS display name | Approved customer expressions |
| --- | --- | --- |
| Soloshot 0.05ml | Disp Syringe & Needle, 0.05mL | 0.05 solo shots; 0.05ml syringe; 0.05cc syringe; 50 microlitre syringe; 0.05ml solo shot |
| Soloshot 0.5ml | Disp Syringe & Needle, 0.5mL | 0.5 solo shots; half ml syringe; ½ml syringe; 0.5cc syringe; 0.5ml solo shot |
| Syringe and needle 2ml | Disp Syringe & Needle, 2mL | 2ml syringe; 2cc syringe; 2 mls syringe; disposable syringe 2ml; 2ml syringe and needle |
| Syringe and needle 5ml | Disp Syringe & Needle, 5mL | 5ml syringe; 5cc syringe; 5 mls syringe; disposable syringe 5ml; 5ml syringe and needle |

Solo-shot needle inclusion was explicitly confirmed by the user. Further variants
normalize to these labels; unverified variants are not permanently learned from
AI confidence. Confirmed suggestions use the existing catalogue authorization,
transaction, revision check, alias history and same-audit confirmation flow.

Verification: `server/syringeIdentity.test.ts` covers the request examples, four
separate IDs, capacity/quantity separation, additional sizes/types, conflicts,
Gemini suggestions and alias reuse. `npm run verify:release` also checks the full
existing app, extension, vaccine pairing and allocation regression suite.

Changed files for this implementation:

- `shared/syringeIdentity.ts`: catalogue-driven specifications and safe matching.
- `shared/productCatalog.ts`: stored device specifications and alias validation.
- `shared/orderText.ts`: shared syringe request/count wording.
- `src/utils/generalProductLog.ts`: catalogue resolver, attribute guards and learning checks.
- `src/utils/generalAuditor.ts`: extraction, capacity-preserving identity and FS headlines.
- `server/vaccineService.ts`: shared device matching, decimal-safe list parsing and ratios.
- `server/productCatalog.ts`: supply the current catalogue to the vaccine/device parser.
- `server/catalogAliasAssistant.ts`: supply stored device specifications to alias suggestions.
- `server/generalCatalogueAi.ts`: catalogue device candidates and syringe-specific constraints.
- `server/generalProductNameAudit.ts`: device suggestions, stock handling and size findings.
- `server/catalogAliasLearning.ts`: confirmed device aliases and durable conflict checks.
- `server/syringeCatalogue.ts`: repeatable registration and incorrect-alias cleanup.
- `server/syringeIdentity.test.ts`: 35 new regression cases.
- `extension/general-auditor.js`, `extension/order-limits.js`: rebuilt shared runtime.
- `docs/syringe-matching.md`: behavior, confirmed labels, files and verification notes.
