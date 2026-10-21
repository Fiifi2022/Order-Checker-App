# Served facility reference for General Auditor

The user supplied `Health Facilities information - Health Facilities (unaggregated) 2026-10-19.csv.csv` as the list of facilities served. A byte-for-byte local copy is kept in [the source CSV](../data/health-facilities-2026-10-19.csv). The date belongs to the supplied filename; the file contains no per-record update timestamps.

[The importer](../scripts/import-served-facilities.py) produces [the bundled reference](../server/data/served-facilities.json), including the source SHA-256, record counts, duplicate provenance, and missing-field counts. Reproduce the import with:

```sh
python3 scripts/import-served-facilities.py
```

The reference is embedded in the backend build. The base reference does not depend on the original attachment path. General Auditor also reads saved directory edits before comparing names, so an unavailable edit store produces a retry message rather than restoring a removed entry. Only General Auditor uses this list; no vaccine allocations or other workflows are populated or changed by the import.

## Import checks

- 1,511 input rows, all labelled GHANA; no missing facility names or facility groups.
- 1,509 distinct records after trimming whitespace and collapsing two complete repeated records. The original CSV remains unchanged.
- Kasaam CHPS occurs at rows 308 and 454 with the same district, region and group; the former includes trailing whitespace. Onyemso CHPS occurs at rows 348 and 940 with identical values. Both duplicate pairs are retained in the generated provenance.
- Akutuase CHPS occurs in Atiwa East / Eastern and Asante Akim North / Ashanti. These remain two records and require district/region evidence to disambiguate.
- Five rows lack a district; one of those also lacks a region. Missing values are retained, with no inference from place names.
- The export has no official facility IDs or verified-alias columns. CSV row references identify source evidence; they are not exposed as official facility identifiers.

The file is suitable as a served-name and location reference, with the limitations above. Its coverage and spelling are supplied by the user, not independently certified against the Fulfilment System. In particular, `Kotoso RCH` is recorded in Kwahu East / Eastern with Facility Group `CHPS`. The import preserves those values. It does not reinterpret the group or approve `Kotoso RHC` as a verified alias.

## Matching and additional records

Exact names and standard abbreviation normalization can resolve to this reference. Similar spellings still require review until an official shared ID or verified alias establishes equivalence. Repeated names in different districts are never merged by name alone.

Saved facility records can enrich a directory entry only through a shared complete normalized name or an explicitly verified alias, plus a shared known district and non-conflicting region. The actual saved ID and approved aliases are retained along with both sources. Conflicting IDs, unmatched geography and uncertain record links stay separate. No ID or alias is generated from fuzzy matching.

Regression tests in [servedFacilityDirectory.test.ts](../server/servedFacilityDirectory.test.ts) verify the actual imported reference, source checksum, missing geography, duplicates, Kotoso uncertainty, district disambiguation, saved-record enrichment, offline operation and final client reconciliation.

## Facility management

The **Facilities** mini tab inside General Auditor searches the active list and supports additions, removals and undo of the last removal. The server follows the existing product-catalog edit roles: Administrator, Warehouse/DCO and Compliance can write; CCA can browse. Validation prevents empty names, duplicate normalized names in the same district/region and lost edits from stale revisions.

The immutable CSV is combined with additions and removal markers stored transactionally in `general_facility_directory/current`. Management keys identify reference entries and are separate from official facility IDs. Removing an entry also suppresses matching saved Blueprint reference evidence for General Auditor, without deleting or editing Blueprint rows. A later audit reloads the active reference; a local directory change invalidates an in-progress or displayed audit. Re-adding the same removed name/location restores its entry.

If the saved edit document cannot be read, General Auditor requests a retry rather than silently using a list that might resurrect removed records. Other auditing modes do not use this edit store.
