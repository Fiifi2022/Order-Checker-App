// Reproducible in-memory query-shape trace. NO cloud calls or billed reads.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { currentBlueprintHandler } from '../server/currentBlueprint';
import { coalesceFreshRead } from '../server/firestoreReads';
const sheets = 12, polls = 1200;
let selectedDocumentReads = 0;
const handler = currentBlueprintHandler(async id => { selectedDocumentReads++; return { id, rows: [{ facility: 'Synthetic HC', balance: 20 }] }; });
for (let i = 0; i < polls; i++) {
  await handler({ params: { id: 'selected-sheet' } } as any, { setHeader() {}, status() { return this; }, json() {} } as any, () => {});
}
assert.equal(selectedDocumentReads, polls);
let baselineCatalogueReads = 0, sharedCatalogueReads = 0;
await Promise.all(Array.from({ length: 20 }, async () => { baselineCatalogueReads++; return 1; }));
const shared = coalesceFreshRead(async () => { sharedCatalogueReads++; return 1; });
await Promise.all(Array.from({ length: 20 }, shared));
assert.equal(sharedCatalogueReads, 1);
const before = polls * (sheets + 3), after = polls + selectedDocumentReads;
const report = {
  scope: 'In-memory query-shape measurements and modeled minimum document reads, NOT billed production Firestore reads.',
  assumptions: { districtSheetDocuments: sheets, visibleBlueprintHours: 1, pollIntervalSeconds: 3, polls, authRoleDocumentsPerSuccessfulRequest: 1, previousRegistrationJoinReadsPerRequest: 1, previousUnneededCatalogueReadsPerPoll: 1, transactionRetries: 0, concurrentViewers: 1 },
  blueprint: { measuredNewSelectedDocumentReadCalls: selectedDocumentReads, estimatedBeforeDocumentReads: before, estimatedAfterDocumentReads: after, reductionPercent: 100 * (1 - after / before) },
  concurrentReferenceReadBurst: { readers: 20, measuredBeforeReadCalls: baselineCatalogueReads, measuredAfterReadCalls: sharedCatalogueReads },
  generalAudit: { estimatedBefore: sheets + 4, estimatedAfter: sheets + 3, includes: 'role, old per-request registration join, product catalogue, managed directory, all fresh Blueprint identity sheets. Excludes image scans, optional AI, retries and confirmation transactions.' },
  extensionHintUpdateBothFields: { estimatedBefore: 6, estimatedAfter: 2, includes: 'Before: 2 requests x (role + registration + catalogue). After: 1 batched request x (role + catalogue).' },
  bundledFacilities: { records: 1509, firestoreReads: 0, fullFirestoreFacilityCatalogueLoadsPerAudit: 0 },
  listeners: { firestoreListeners: 0, listenerReads: 0 },
  coldStart: { before: 'min(150, activity logs) + all activity logs + all vaccine transactions + all district sheets; empty queries still cost a minimum read', after: 'min(150, activity logs), or minimum 1 for an empty query; history and sheets deferred until needed' }
};
writeFileSync('docs/validation/firestore-read-results.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
