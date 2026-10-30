# Allocation workspace upgrades

The Blueprint and Allocation Dashboard include **Allocation workspace → Health, facilities, cycles and history**. District, cycle and exact sheet/row selection live in one account-bound, in-memory React context. Switching application tabs retains the selection; signing out/remounting another account clears it. These selections no longer write a shared server-wide active sheet merely because somebody browses a tab. The Vaccine Checker resolves the selected facility by sheet and row IDs, rather than picking a similarly named or default facility.

## Operational views

- **Needs attention:** facilities with exhausted allocation, missing quantities, no recorded distribution or data findings. Blank quantities remain unknown; an explicit zero stays zero.
- **District coverage / Sub-district coverage:** facility-cycle counts, distribution coverage, exhausted/incomplete records and links into each facility detail. All-cycle views explicitly count facility-cycle records.
- **Health and reconciliation:** duplicate facility/row/product identities, missing or invalid quantities, negative/over-distributed quantities, inconsistent balances, catalogue identity warnings and companion availability warnings. Supporting worksheets are excluded from operational totals. Companion warnings never create new allocations.
- **Facility details:** carry-over, current allocation, distributions, recorded balance, calculated balance and difference. Vials and pieces remain separate. Dose equivalents require a uniquely resolved catalogue product and an existing configured conversion; unavailable conversion metadata is shown explicitly. DHD/manual top-ups and quota adjustments are included in current allocation and are displayed separately when recorded, without adding them again.
- **Cycle controls:** new cycles start **Draft**, become **Active** after review, and can be **Closed**. Legacy sheets without a cycle flag remain active. Closed cycles reopen as Draft with a correction reason of at least ten characters. Corrections must be reviewed and the cycle activated before new orders can deduct stock. Reopening is permitted even when reconciliation errors need correction; activation/closing is blocked by errors.
- **Change history:** saved actor, time, reason, old/new quantities, order IDs, confirmed supply and DHD movements. History is scoped to the exact sheet/row and supports additional pages. Older changes that were never recorded cannot be reconstructed.

## Imports and rollover

Workbook imports are staged in a preview. The preview shows new and removed facilities, changed quantities, duplicate/unknown products and skipped worksheet reasons. Existing unique facility names retain their original row IDs and official IDs so past transaction references remain linked. Ambiguous target sheets or duplicate facilities require correction. No sheet is replaced before the server acknowledges the save. Import into a closed cycle is blocked. Catalogue unavailability prevents applying an unchecked preview.

Creating a new month first previews every facility/product opening balance and its source sheet version. Reconciled ending balances carry forward; missing or inconsistent balances stay blank. New allocation/distribution quantities reset for the draft cycle. Bulk rollover selects eligible earlier non-draft sources and does not use future draft carry-over sheets. The source versions and destination documents are rechecked within the creation transaction, so changed balances or an existing destination require a new preview.

## Saved data and safeguards

Normal Blueprint writes use Firestore transactions, optional expected-version checks for older clients, mandatory expected versions from the upgraded UI, and atomic change events. Current cycle state comes from the saved document and cannot be overridden by a client payload. Lifecycle transitions, DHD top-ups and confirmed deductions recheck authoritative saved state. Closed-cycle protections also cover older management routes. Quota adjustments use stable request IDs and reject a conflicting retry instead of adding twice.

Legacy facility metadata/product/top-up controls now update the saved Blueprint rather than only a derived cache. Renames, clears and their change events persist before success is reported. Deleted sheet snapshots are retained in `vaccine_district_archives` for authorised recovery; no public archive editor is added. Failed writes do not publish a changed allocation as saved. New audit/deduction history remains separate from allocation planning edits.

New API routes: `GET /api/vaccine/blueprint-districts/:id/operations`, `POST /api/vaccine/blueprint-districts/:id/lifecycle`, and `POST /api/vaccine/blueprint-months/preview`. The creation endpoint requires the reviewed source versions. All routes retain existing Firebase authentication and role checks. No security rules, production allocation documents or live orders are modified by installing this code or running the mocked tests.

Validation: `server/allocationOperations.test.ts`, `server/allocationWorkspaceUi.test.ts`, and updated recovery, DHD inventory and vaccine deduction regressions cover unknown/zero arithmetic, unit conversions, import previews, source-version races, cycle locks/corrections, atomic failure recovery, stable row selection, cross-tab navigation and idempotent quota adjustments. Production deployment, real Firestore transactions and authenticated FS workflow checks remain separate rollout steps.
