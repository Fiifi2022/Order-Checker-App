import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalog, defaultProducts } from './productCatalog';
import { extractGeneralOrderDeterministically } from './generalOrderExtraction';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { parseGeneralProducts, applyGeneralProductConfirmation, enforceGeneralProductAssignments, normalizeGeneralProductName } from './generalAuditor';
import { bindGeneralExtractionSources } from '../src/utils/generalExtractionSources';
import { generalEvidenceOrigin } from '../src/utils/generalProductEvidence';
import { generalInventoryRows } from '../src/utils/generalInventoryRows';
import { generalProductHeading } from '../src/utils/generalProductHeading';

const requested = 'Diclofenac 25mg/5mL Injection', supplied = 'Diclofenac 25mg/mL Injection, 3mL';
const headers = 'Facility: Alpha HC\nOrderer: John Mensah\n';
function seed() { applyCatalog({ revision: 900, products: [...defaultProducts(), ...[requested, supplied, 'Amoxicillin 250mg Suspension'].map((name, index) => ({ id: `upstream-${index}`, name, scope: 'general' as const, category: 'medicine', aliases: [], contextualAliases: [], note: '' }))] }); }
const offline = () => { throw new Error('AI must not be needed for recognized product abbreviations'); };
for (const metadata of [headers, headers.replaceAll(':', ';'), headers + 'Patient age: 19\n']) {
  test(`real preprocessing keeps Inj. attached to its consumed product span: ${JSON.stringify(metadata)}`, async () => {
    seed(); const raw = metadata + 'Inj. ' + requested + ' [7]\nPatient age: 19';
    const extracted = extractGeneralOrderDeterministically(raw, 'customer_request');
    assert.deepEqual(extracted.unresolvedText, []);
    assert.equal(extracted.order.products.length, 1); assert.equal(extracted.sourceEntries?.length, 1);
    const entry = extracted.sourceEntries![0];
    assert.equal(raw.slice(entry.sourceSpan!.start, entry.sourceSpan!.end), entry.originalText);
    assert.ok(entry.originalText.startsWith('Inj.')); assert.equal(entry.quantity, 7);
    for (let repeat = 0; repeat < 3; repeat++) {
      const result = await runGeneralSemanticAudit(raw, headers + supplied + ' [7/7]', {}, {}, offline);
      assert.equal(result.generalAudit.productCount.requested, 1); assert.equal(result.generalAudit.productCount.found, 1);
      assert.equal(result.generalAudit.productVerifications?.length, 1);
      const verification = result.generalAudit.productVerifications![0];
      assert.equal(verification.requestedQuantity, 7); assert.equal(verification.suppliedQuantity, 7);
      assert.equal(generalProductHeading(verification.productName), requested);
      assert.equal(generalInventoryRows(result.items, result.generalAudit).length, 1);
      assert.equal(result.generalAudit.semanticReviews?.filter(review => !review.dosageFormKey).length || 0, 0);
      const reopened = enforceGeneralProductAssignments(JSON.parse(JSON.stringify(result)), raw, headers + supplied + ' [7/7]');
      assert.equal(reopened.generalAudit.productVerifications?.length, 1);
      const confirmed = applyGeneralProductConfirmation(reopened, verification.key, verification.options.find(option => option.fromFulfillment)!.key, true, { id: 'cca', name: 'CCA' });
      assert.equal(confirmed.items.length, 1); assert.equal(confirmed.allMatch, true);
      assert.equal(generalInventoryRows(confirmed.items, confirmed.generalAudit).length, 1);
    }
  });
}
for (const name of ['Inj. Artesunate 120mg', 'Tab. Paracetamol 500mg', 'Tabs. Paracetamol 500mg', 'Cap. Amoxicillin 500mg', 'Caps. Amoxicillin 500mg', 'Susp. Amoxicillin 250mg']) {
  test(`medical abbreviation survives incidental metadata cleanup: ${name}`, () => {
    seed(); const raw = headers + name + ' [7]\nPatient age: 19';
    const result = extractGeneralOrderDeterministically(raw, 'customer_request');
    assert.ok(result.text.includes(name + ' [7]'));
    assert.ok(!result.unresolvedText.some(text => /^(?:inj|tabs?|caps?|susp)\.$/i.test(text)));
    assert.equal(result.sourceEntries?.length, 1);
  });
}
test('cleaned and Gemini recognitions bind before comparison without doubling source quantity', () => {
  seed(); const raw = headers + '\nPatient age: 19\nInj. ' + requested + ' [7]';
  const deterministic = parseGeneralProducts(raw, 'customer_request')[0];
  const ai = { ...parseGeneralProducts(requested + ' [7]', 'customer_request')[0], extractionProvenance: [{ method: 'gemini', name: requested, originalText: requested + ' [7]', line: 1 }] };
  const canonical = bindGeneralExtractionSources([deterministic, ai, ai], raw, 'customer_request');
  assert.equal(canonical.length, 1); assert.equal(canonical[0].quantity, 7);
  assert.equal(canonical[0].sourceEntryId, deterministic.sourceEntryId);
  assert.ok(canonical[0].extractionProvenance?.some(value => value.method === 'gemini'));
});
test('independent inline products have disjoint original spans and stable IDs', () => {
  seed(); const raw = headers + 'Paracetamol 500mg Tablet [10] and Amoxicillin 500mg Capsule [20]\nPatient age: 19';
  const result = extractGeneralOrderDeterministically(raw, 'customer_request');
  assert.equal(result.sourceEntries?.length, 2);
  const [first, second] = result.sourceEntries!;
  assert.notEqual(generalEvidenceOrigin(first), generalEvidenceOrigin(second));
  assert.equal(first.line, second.line);
  assert.ok(first.sourceSpan!.end <= second.sourceSpan!.start);
  assert.deepEqual(result.sourceEntries, extractGeneralOrderDeterministically(raw, 'customer_request').sourceEntries);
  const repeated = headers + 'Paracetamol 500mg Tablet [10] and Paracetamol 500mg Tablet [10]\nPatient age: 19';
  const repeats = extractGeneralOrderDeterministically(repeated, 'customer_request').sourceEntries!;
  assert.equal(repeats.length, 2);
  assert.ok(repeats[0].sourceSpan!.end <= repeats[1].sourceSpan!.start);
  assert.equal(repeats[0].line, repeats[1].line);
});
test('repeated real source lines retain both occurrences even with identical wording', () => {
  seed(); const raw = headers + '1 Paracetamol 500mg 10/10\n2 Paracetamol 500mg 20/20\nPatient age: 19';
  const entries = extractGeneralOrderDeterministically(raw, 'customer_request').sourceEntries!;
  assert.equal(entries.length, 2); assert.deepEqual(entries.map(entry => entry.quantity), [10, 20]);
  assert.equal(new Set(entries.map(generalEvidenceOrigin)).size, 2);
  const repeated = 'Paracetamol 500mg Tablet [10]\nParacetamol 500mg Tablet [10]';
  const bound = bindGeneralExtractionSources(parseGeneralProducts(repeated, 'customer_request'), repeated, 'customer_request');
  assert.equal(bound.length, 2); assert.notEqual(bound[0].sourceSpan?.start, bound[1].sourceSpan?.start);
});
test('source binding never swallows quantity or concentration conflicts', async () => {
  seed(); const raw = headers + 'Inj. ' + requested + ' [7]\nPatient age: 19';
  const result = await runGeneralSemanticAudit(raw, headers + supplied + ' [5/7]', {}, {}, offline);
  assert.equal(result.generalAudit.productVerifications?.length, 1);
  const target = result.generalAudit.productVerifications![0];
  assert.equal(target.requestedQuantity, 7); assert.equal(target.suppliedQuantity, 5);
  const confirmed = applyGeneralProductConfirmation(result, target.key, target.options.find(option => option.fromFulfillment)!.key, true, { id: 'cca', name: 'CCA' });
  assert.equal(confirmed.allMatch, false); assert.equal(confirmed.items[0].fulfillment.requested, 7); assert.equal(confirmed.items[0].fulfillment.supplied, 5);
  const source = parseGeneralProducts(raw, 'customer_request')[0];
  const otherDocument = { ...source, documentId: 'different-document' };
  assert.equal(bindGeneralExtractionSources([source, otherDocument], raw, 'customer_request').length, 2);
  assert.equal(bindGeneralExtractionSources([source, { ...source, quantity: 8 }], raw, 'customer_request').length, 2);
  assert.equal(bindGeneralExtractionSources([source, { ...source, name: 'Diclofenac 50mg/5mL Injection', normalizedName: normalizeGeneralProductName('Diclofenac 50mg/5mL Injection') }], raw, 'customer_request').length, 2);
});
test('a standalone abbreviation is still unresolved without an actual product', () => {
  seed(); assert.ok(extractGeneralOrderDeterministically(headers + 'Inj.\nPatient age: 19', 'customer_request').unresolvedText.includes('Inj.'));
});

test('repeated requested entries and their separate fulfilment lines produce independent cards', async () => {
  seed();
  const raw = headers + '1 Paracetamol 500mg Tablet 10/10\n2 Paracetamol 500mg Tablet 20/20\nPatient age: 19';
  const system = headers + '1 Paracetamol 500mg Tablet 10/10\n2 Paracetamol 500mg Tablet 20/20';
  const result = await runGeneralSemanticAudit(raw, system, {}, {}, offline);
  assert.equal(result.items.length, 2); assert.equal(generalInventoryRows(result.items, result.generalAudit).length, 2);
  assert.deepEqual(result.items.map(item => item.fulfillment.requested), [10, 20]);
  assert.deepEqual(result.items.map(item => item.fulfillment.supplied), [10, 20]);
  assert.equal(new Set(result.items.map(item => item.fulfillment.key)).size, 2);
  assert.equal(result.extractedOrder.products.length, 2);
  assert.equal(result.generalAudit.productCount.requested, 2);
});

test('Gemini identity cleanup cannot insert a second clinical product at an obsolete line position', async () => {
  seed(); let calls = 0;
  const raw = 'Facility: Alpha HC\nPatient age: 19\nSigned John Mensah\nInj. ' + requested + ' [7]';
  const result = await runGeneralSemanticAudit(raw, headers + supplied + ' [7/7]', {}, { semanticCacheScope: 'upstream-source-gemini' }, () => ({ models: { async generateContent() {
    calls++; return { text: JSON.stringify({ customer: { facilityName: null, ordererName: 'John Mensah', products: [], deliveryArea: null, district: null, unresolvedFields: [], extractionConfidence: 0.99 } }) };
  } } }));
  assert.equal(calls, 1); assert.equal(result.semanticAnalysis.status, 'used');
  assert.equal(result.generalAudit.productVerifications?.length, 1);
  assert.equal(result.generalAudit.productCount.requested, 1);
  assert.equal(result.extractedOrder.products.length, 1);
  assert.equal(generalInventoryRows(result.items, result.generalAudit).length, 1);
  assert.equal(result.generalAudit.productVerifications![0].requestedQuantity, 7);
  assert.equal(result.generalAudit.productVerifications![0].suppliedQuantity, 7);
});
