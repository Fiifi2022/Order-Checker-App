import assert from 'node:assert/strict';
import test from 'node:test';
import { compareGeneralProducts, extractGeneralInput, locateGeneralSystemOrderer, locateGeneralSystemFacility, normalizeGeneralProductName, parseGeneralProducts, runGeneralAuditor } from './generalAuditor';


// Product-focused cases supply matching required headers; header cases call the
// auditor directly to verify missing and mismatched values.
function runProductAudit(customer: string, system: string) {
  const headers = '\nName of Orderer: Isaac Awuyem\nFacility: Gbimsi CHPS';
  return runGeneralAuditor(customer + headers, system + headers);
}

const request = `Date: 26th June, 2026
Name of Orderer: Isaac Awuyem
Name of Health Facility: Gbimsi CHPS
Delivery / Drop area: Gbimsi
District: West Mamprusi
Products and Quantities:
1. Multivitamin Syrup - 5
2. Paracetamol 120mg/5mL Syrup, 100mL - 5`;
const fulfillment = `Zipline. We have received your order.
- Multivitamin Syrup [5/5]
- Paracetamol 120mg/5mL Syrup, 100mL [5/5]`;

test('exact regression uses only the two current inputs and flags missing fulfillment identities', () => {
  const result = runGeneralAuditor(request, fulfillment);
  assert.deepEqual(result.items.map(({ name, requested, found, status }) => ({ name, requested, found, status })), [
    { name: 'Multivitamin Syrup', requested: '5', found: '5', status: 'match' },
    { name: 'Paracetamol 120mg/5mL Syrup, 100mL', requested: '5', found: '5', status: 'match' }
  ]);
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 2);
  assert.equal(result.verdict, 'DISCREPANCY');
  assert.doesNotMatch(JSON.stringify(result), /Artemether|Lumefantrine|500mg/);
  for (const item of result.items) {
    assert.equal(item.provenance.length, 2);
    assert.equal(item.provenance[0].source, 'customer_request');
    assert.equal(item.provenance[1].source, 'fulfillment_confirmation');
    for (const evidence of item.provenance) assert.ok((evidence.source === 'customer_request' ? request : fulfillment).split('\n').includes(evidence.originalText));
  }
});

test('missing product is only a requested product absent from fulfillment', () => {
  const items = compareGeneralProducts('Multivitamin Syrup - 5\nParacetamol Syrup - 5', 'Multivitamin Syrup [5/5]');
  assert.deepEqual(items.map(item => [item.name, item.status]), [['Multivitamin Syrup', 'match'], ['Paracetamol Syrup', 'missing item']]);
  assert.deepEqual(items[1].provenance.map(evidence => evidence.source), ['customer_request']);
});

test('extra product is only an actual fulfillment line absent from the request', () => {
  const items = compareGeneralProducts('Multivitamin Syrup - 5', 'Multivitamin Syrup [5/5]\nORS [3/3]');
  assert.deepEqual(items.map(item => [item.name, item.status]), [['Multivitamin Syrup', 'match'], ['ORS', 'extra item']]);
  assert.deepEqual(items[1].provenance.map(evidence => evidence.source), ['fulfillment_confirmation']);
});

test('actual fulfilled numerator, rather than expected denominator, determines quantities', () => {
  for (const found of ['[3/3]', '[3/5]']) {
    const [item] = compareGeneralProducts('Multivitamin Syrup - 5', `Multivitamin Syrup ${found}`);
    assert.equal(item.requested, '5');
    assert.equal(item.found, '3');
    assert.equal(item.status, 'quantity mismatch');
    assert.equal(item.provenance.length, 2);
  }
});

test('paracetamol forms, strengths, concentrations and volumes remain distinct', () => {
  for (const name of ['Paracetamol 500mg Tablet', 'Paracetamol 250mg/5mL Syrup, 100mL', 'Paracetamol 120mg/5mL Syrup, 200mL', 'Paracetamol 120mg/1mL Syrup, 100mL']) {
    const items = compareGeneralProducts('Paracetamol 120mg/5mL Syrup, 100mL - 5', `${name} [5/5]`);
    assert.deepEqual(items.map(item => item.status), ['missing item', 'extra item']);
    assert.equal(items[1].name, name);
  }
});

test('formatting and explicit aliases compare safely without expanding the universe', () => {
  const examples = [
    ['Paracetamol 120 mg / 5 ml Syrup, 100 ml', 'PARACETAMOL Syr 120mg/5mL 100mL'],
    ['PCM 500mg Tab', 'Paracetamol 500 mg Tablet'],
    ['ORS', 'Oral Rehydration Salts'],
    ['AL', 'Coartem (AL)']
  ];
  for (const [customer, fulfilled] of examples) {
    assert.equal(normalizeGeneralProductName(customer), normalizeGeneralProductName(fulfilled));
    const items = compareGeneralProducts(`${customer} - 5`, `${fulfilled} [5/5]`);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'match');
    assert.equal(items[0].name, customer);
  }
  assert.notEqual(normalizeGeneralProductName('Multivitamin Syrup'), normalizeGeneralProductName('AL'));
});

test('new audits, duplicate lines and source metadata cannot leak unrelated products', () => {
  runProductAudit('Artemether + Lumefantrine Tablet - 2', 'Artemether + Lumefantrine Tablet [2/2]');
  const result = runGeneralAuditor(request, fulfillment);
  assert.doesNotMatch(JSON.stringify(result), /Artemether|Lumefantrine/);
  assert.deepEqual(parseGeneralProducts(request, 'customer_request').map(item => item.name), ['Multivitamin Syrup', 'Paracetamol 120mg/5mL Syrup, 100mL']);
  const [item] = compareGeneralProducts('Multivitamin Syrup - 2\nMultivitamin Syrup - 3', 'Multivitamin Syrup [5/5]');
  assert.equal(item.status, 'match');
  assert.equal(item.provenance.length, 3);
});

test('supported quantity layouts preserve dosage numerals inside the product name', () => {
  const items = compareGeneralProducts('10 cards of PCM 500mg\n- Malaria RDT: 5 packs\n2 vials of Saline water', 'Paracetamol 500mg: 10 cards\nMalaria RDT - 5 packs\nSaline water [2/2]');
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(item => item.status), ['match', 'match', 'match']);
  assert.equal(items[0].requested, '10 card');
});

test('explicit zero fulfillment records out of stock without a discrepancy', () => {
  const result = runProductAudit('Multivitamin Syrup - 5', 'Multivitamin Syrup [0/5]');
  assert.equal(result.items[0].status, 'out of stock');
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.verdict, 'NO DISCREPANCY');
  assert.deepEqual(result.generalAudit.discrepancies, []);
});

test('unreadable inputs cannot generate a fabricated perfect audit', () => {
  assert.throws(() => runProductAudit('Hello', 'Received'), /No explicit product quantities/);
});


test('an empty product set on one side produces only source-backed missing or extra items', () => {
  assert.equal(runProductAudit('Multivitamin Syrup - 5', 'Order received.').items[0].status, 'missing item');
  assert.equal(runProductAudit('Nothing requested.', 'ORS [3/3]').items[0].status, 'extra item');
});

test('normalization retains repeated strengths and quantities accept singular boxes', () => {
  assert.notEqual(normalizeGeneralProductName('Compound 20mg + 20mg Tablet'), normalizeGeneralProductName('Compound 20mg Tablet'));
  assert.equal(compareGeneralProducts('2 box of ORS', 'ORS: 2 boxes')[0].status, 'match');
  assert.equal(normalizeGeneralProductName('Vitamin A 100,000 IU Capsule'), normalizeGeneralProductName('Vitamin A 100000IU Capsule'));
});


test('compound strengths cannot move between ingredients during normalization', () => {
  const items = compareGeneralProducts('Drug A 5mg + Drug B 10mg Tablet - 5', 'Drug A 10mg + Drug B 5mg Tablet [5/5]');
  assert.deepEqual(items.map(item => item.status), ['missing item', 'extra item']);
});


test('other metadata does not affect the four General Auditor checks', () => {
  const matched = runProductAudit('Name of Health Facility: Kade HC\nPhone: 0244123456\nORS - 5', 'Facility: Kade Health Center\nContact: +233244123456\nORS [5/5]');
  assert.equal(matched.issueCount, 0);
  const mismatched = runProductAudit('District: West Mamprusi\nORS - 5', 'District: East Mamprusi\nORS [5/5]');
  assert.equal(mismatched.issueCount, 0);
  assert.deepEqual(mismatched.items.map(item => item.name), ['ORS']);
});

test('numeric metadata never adds products to the two-input comparison', () => {
  const result = runProductAudit(
    'Phone Number: 0244123456\nFacility ID: 123\nOrder Number - 456\nDelivery Area: Zone 7\nORS - 5',
    'Reference Phone: 0244123456\nFacility ID: 123\nOrder ID: 456\nDelivery Area: Zone 7\nTotal: 5\nORS [5/5]'
  );
  assert.deepEqual(result.items.map(item => item.name), ['ORS']);
  assert.equal(result.issueCount, 0);
  assert.equal(result.meta.phone.whatsappValue, '0244123456');
  assert.equal(result.meta.dropArea?.whatsappValue, 'Zone 7');
});

test('vaccines do not introduce accessories absent from both entered inputs', () => {
  const result = runProductAudit('MR Vaccine - 10\nOPV Vaccine - 15', 'MR Vaccine [10/10]\nOPV Vaccine [15/15]');
  assert.deepEqual(result.items.map(item => item.name), ['MR Vaccine', 'OPV Vaccine']);
  assert.equal(result.allMatch, true);
  assert.doesNotMatch(JSON.stringify(result), /diluent|dropper|out of stock/i);
});

test('accessories entered only in system confirmation remain extra items', () => {
  const result = runProductAudit('MR Vaccine - 10', 'MR Vaccine [10/10]\nMR Diluent [10/10]');
  assert.deepEqual(result.items.map(item => item.status), ['match', 'extra item']);
  assert.equal(result.issueCount, 1);
});

const completeRequest = 'Name of Orderer: Isaac Awuyem\nFacility: Gbimsi CHPS\nORS - 5';
const completeSystem = 'Name of Orderer: Isaac Awuyem\nFacility: Gbimsi CHPS\nORS [5/5]';

test('different or omitted dates never raise a General Auditor discrepancy', () => {
  for (const systemDate of ['Date: 2026-10-04\n', '']) {
    const result = runGeneralAuditor('Date: 2026-10-03\n' + completeRequest, systemDate + completeSystem);
    assert.equal(result.allMatch, true);
    assert.equal(result.issueCount, 0);
    assert.equal(result.verdict, 'NO DISCREPANCY');
    assert.deepEqual(result.items.map(item => item.name), ['ORS']);
  }
});

test('all four required checks match', () => {
  const result = runGeneralAuditor(completeRequest, completeSystem);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.equal(result.meta.ordererName?.status, 'match');
  assert.equal(result.meta.facilityName?.status, 'match');
});

test('facility, orderer and quantity differences each raise a discrepancy', () => {
  for (const [from, to, issue] of [
    ['Gbimsi CHPS', 'Kade CHPS', 'Facility Name Mismatch'],
    ['Isaac Awuyem', 'Kwame Mensah', 'Orderer Name Mismatch'],
    ['[5/5]', '[3/5]', 'quantity mismatch']
  ]) {
    const result = runGeneralAuditor(completeRequest, completeSystem.replace(from, to), { [normalizeGeneralProductName('ORS')]: false });
    assert.equal(result.allMatch, false);
    assert.equal(result.issueCount, 1);
    assert.ok(result.generalAudit.discrepancies.some(value => value.toLowerCase().includes(issue.toLowerCase())));
  }
  const result = runGeneralAuditor(completeRequest, completeSystem.replace('ORS', 'Malaria RDT'));
  assert.deepEqual(result.items.map(item => item.status), ['missing item', 'extra item']);
  assert.equal(result.allMatch, false);
});

test('missing requested fulfillment identities require review without being labeled mismatches', () => {
  for (const [field, key] of [['Name of Orderer: Isaac Awuyem\n', 'orderer'], ['Facility: Gbimsi CHPS\n', 'facility']] as const) {
    for (const side of ['customer', 'system', 'both']) {
      const result = runGeneralAuditor(
        side !== 'system' ? completeRequest.replace(field, '') : completeRequest,
        side !== 'customer' ? completeSystem.replace(field, '') : completeSystem
      );
      assert.equal(result.allMatch, side !== 'system');
      assert.equal(result.issueCount, side === 'system' ? 1 : 0);
      assert.equal(result.generalAudit[key].status, side === 'system' ? 'not available in system entry' : 'missing from customer request');
    }
  }
  assert.equal(runGeneralAuditor('ORS - 5', 'ORS [5/5]').issueCount, 0);
});

test('empty and placeholder system names are unavailable', () => {
  for (const value of ['', 'N/A', 'None', 'Unknown', 'Not provided']) {
    const result = runGeneralAuditor(completeRequest, completeSystem.replace('Isaac Awuyem', value));
    assert.equal(result.meta.ordererName.status, 'not available in system entry');
    assert.equal(result.issueCount, 1);
  }
});

test('facility suffix and honorific differences match', () => {
  const matched = runGeneralAuditor(
    'Name of Orderer: Dr. Isaac Awuyem\nFacility: Kade HC\nORS - 5',
    'Orderer Name = Isaac Awuyem\nFacility Name - Kade Health Centre\nORS [5/5]'
  );
  assert.equal(matched.allMatch, true);
  const mismatch = runGeneralAuditor(completeRequest, completeSystem.replace('Gbimsi CHPS', 'Gbimsi Hospital'));
  assert.equal(mismatch.meta.facilityName?.status, 'match');
  assert.equal(mismatch.issueCount, 0);
});

test('exact request without system headers matches two products and marks headers unavailable', () => {
  const result = runGeneralAuditor(request, fulfillment);
  assert.deepEqual(result.generalAudit.productCount, { requested: 2, found: 2, status: 'match' });
  assert.equal(result.generalAudit.facility.status, 'not available in system entry');
  assert.equal(result.generalAudit.orderer.status, 'not available in system entry');
  assert.deepEqual(result.generalAudit.discrepancies, ['Orderer Name Not Found', 'Facility Not Found']);
});

test('mismatch regression identifies actual problems despite equal product counts', () => {
  const result = runGeneralAuditor(
    'Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\nMultivitamin Syrup - 5\nParacetamol Syrup - 5',
    'Facility: Walewale Hospital\nOrderer: Isaac Awuyem\nMultivitamin Syrup [3/3]\nORS [2/2]', { [normalizeGeneralProductName('Multivitamin Syrup')]: false }
  );
  assert.equal(result.generalAudit.facility.status, 'mismatch');
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.deepEqual(result.generalAudit.productCount, { requested: 2, found: 2, status: 'match' });
  assert.deepEqual(result.items.map(item => item.status), ['quantity mismatch', 'missing item', 'extra item']);
  assert.equal(result.items[0].difference, 2);
  assert.equal(result.issueCount, 4);
  assert.equal(result.verdict, 'DISCREPANCY');
  assert.doesNotMatch(result.generalAudit.discrepancies.join(' '), /Orderer/);
});

test('distinct product counts aggregate duplicates consistently on both sides', () => {
  const result = runGeneralAuditor('ORS - 2\nORS - 3', 'ORS [1/1]\nOral Rehydration Salts [4/4]');
  assert.deepEqual(result.generalAudit.productCount, { requested: 1, found: 1, status: 'match' });
  assert.equal(result.allMatch, true);
  const missing = runGeneralAuditor('ORS - 5\nMultivitamin Syrup - 5', 'ORS [5/5]');
  assert.equal(missing.generalAudit.productCount.status, 'mismatch');
  assert.equal(missing.issueCount, 1);
});

test('syrup and oral solution remain different formulations', () => {
  const items = compareGeneralProducts('Paracetamol 120mg/5mL Syrup 100mL - 5', 'Paracetamol 120mg/5mL Oral Solution 100mL [5/5]');
  assert.deepEqual(items.map(item => item.status), ['missing item', 'extra item']);
});

test('unreadable inputs cannot silently produce a complete audit', () => {
  assert.equal(runGeneralAuditor('ORS - 5', 'Unstructured confirmation').allMatch, false);
  assert.equal(runGeneralAuditor('Unstructured request', 'ORS [5/5]').allMatch, false);
  assert.throws(() => runGeneralAuditor('Unstructured request', 'Unstructured confirmation'), /explicit product quantities/);
});

test('explicit product lines with unreadable quantities cannot disappear from a matching audit', () => {
  assert.throws(() => runGeneralAuditor('ORS - 5\n- Multivitamin Syrup', 'ORS [5/5]'), /Customer Request line 2/);
  assert.throws(() => runGeneralAuditor('ORS - 5', 'ORS [5/5]\n- Multivitamin Syrup'), /System Entry line 2/);
});

const fieldExtractionRequest = `Date*: 26th June, 2026
Name of Orderer: Isaac Awuyem
Name of Health Facility: Gbimsi CHPS
Delivery/ Drop area: Gbimsi
District: West Mamprusi
Products and Quantities:
1. Multivitamin Syrup - 5
2. Paracetamol 120mg/5mL Syrup, 100mL - 5`;

test('exact field extraction regression preserves both customer names and both products', () => {
  const extraction = extractGeneralInput(fieldExtractionRequest, 'customer_request');
  assert.equal(extraction.ordererName, 'Isaac Awuyem');
  assert.equal(extraction.facilityName, 'Gbimsi CHPS');
  assert.deepEqual(extraction.products.map(({ name, quantity }) => ({ name, quantity })), [
    { name: 'Multivitamin Syrup', quantity: 5 },
    { name: 'Paracetamol 120mg/5mL Syrup, 100mL', quantity: 5 }
  ]);
  const result = runGeneralAuditor(fieldExtractionRequest, fulfillment);
  assert.equal(result.meta.ordererName.whatsappValue, 'Isaac Awuyem');
  assert.equal(result.meta.facilityName.whatsappValue, 'Gbimsi CHPS');
  assert.equal(result.meta.ordererName.status, 'not available in system entry');
  assert.equal(result.meta.facilityName.status, 'not available in system entry');
  assert.equal(result.allMatch, false);
  assert.doesNotMatch(JSON.stringify(result), /Orderer Name Missing|Facility Name Missing/);
});

test('every supported name label handles capitalization and extra spaces on either side', () => {
  for (const label of ['Name of Orderer', 'Orderer Name', 'Orderer', 'Requested By', 'Requester', 'Customer Name', 'Name']) {
    for (const variant of [label, label.toUpperCase(), label.toLowerCase().replace(/ /g, '   ')]) {
      for (const source of ['customer_request', 'fulfillment_confirmation'] as const) {
        assert.equal(extractGeneralInput(`  ${variant} :    Isaac Awuyem   `, source).ordererName, 'Isaac Awuyem');
      }
    }
  }
  for (const label of ['Name of Health Facility', 'Health Facility', 'Facility Name', 'Facility', 'Name of Facility']) {
    for (const variant of [label, label.toUpperCase(), label.toLowerCase().replace(/ /g, '   ')]) {
      for (const source of ['customer_request', 'fulfillment_confirmation'] as const) {
        assert.equal(extractGeneralInput(`  ${variant} :   Gbimsi CHPS   `, source).facilityName, 'Gbimsi CHPS');
      }
    }
  }
});

test('specific labels win over generic labels regardless of their line order', () => {
  const lines = ['Name: John Mensah', 'Customer Name: Mary Alhassan', 'Name of Orderer: Isaac Awuyem',
    'Facility: Walewale Hospital', 'Name of Health Facility: Gbimsi CHPS'];
  for (const ordered of [lines, [...lines].reverse()]) {
    for (const source of ['customer_request', 'fulfillment_confirmation'] as const) {
      const extraction = extractGeneralInput(ordered.join('\n'), source);
      assert.equal(extraction.ordererName, 'Isaac Awuyem');
      assert.equal(extraction.facilityName, 'Gbimsi CHPS');
    }
  }
  const facilityOnly = extractGeneralInput('Name of Health Facility: Gbimsi CHPS', 'customer_request');
  assert.equal(facilityOnly.ordererName, 'N/A');
  const ordererOnly = extractGeneralInput('Name of Orderer: Isaac Awuyem', 'customer_request');
  assert.equal(ordererOnly.facilityName, 'N/A');
});

test('first-colon extraction retains value text and skips empty candidates', () => {
  assert.equal(extractGeneralInput('Name of Facility: Gbimsi CHPS: Main Branch', 'customer_request').facilityName, 'Gbimsi CHPS: Main Branch');
  assert.equal(extractGeneralInput('Name of Orderer: \nName of Orderer: Isaac Awuyem\nName: John Mensah', 'customer_request').ordererName, 'Isaac Awuyem');
});

test('new metadata aliases never become products and explicit system names are compared', () => {
  const customer = '- Requested By: Isaac Awuyem\n- Name of Facility: Gbimsi CHPS\nORS - 5';
  const system = 'Orderer Name: John Mensah\nHealth Facility: Walewale Hospital\nORS [5/5]';
  const result = runGeneralAuditor(customer, system);
  assert.equal(result.meta.ordererName.status, 'mismatch');
  assert.equal(result.meta.facilityName.status, 'mismatch');
  assert.equal(result.issueCount, 2);
  assert.deepEqual(result.items.map(item => item.name), ['ORS']);
  assert.deepEqual(parseGeneralProducts('Requested By: Agent 2\nName of Facility: Zone 7\nORS - 5', 'customer_request').map(item => item.name), ['ORS']);
});

test('customer missing and system unavailable remain separate field statuses', () => {
  const result = runGeneralAuditor('Facility: Gbimsi CHPS\nORS - 5', 'Orderer: Isaac Awuyem\nORS [5/5]');
  assert.equal(result.meta.ordererName.status, 'missing from customer request');
  assert.equal(result.meta.facilityName.status, 'not available in system entry');
  assert.equal(result.issueCount, 1);
});


test('fulfillment orderer search recognizes labelled names, sentences and exact mentions', () => {
  for (const text of [
    'Orderer: Isaac Awuyem',
    'Requested by Isaac Awuyem',
    'Customer: Isaac Awuyem',
    'Isaac Awuyem placed this order',
    'Order received from Isaac Awuyem',
    'Order received for Isaac Awuyem.',
    'Zipline. We have received your order for Isaac Awuyem.',
    'Confirmation metadata: Isaac Awuyem',
    'Note: order confirmed (Isaac Awuyem).'
  ]) {
    const result = runGeneralAuditor('Name of Orderer: Isaac Awuyem\nMultivitamin Syrup - 5', text + '\nMultivitamin Syrup [5/5]');
    assert.equal(result.generalAudit.orderer.whatsappValue, 'Isaac Awuyem', text);
    assert.equal(result.generalAudit.orderer.fulfillmentValue, 'Isaac Awuyem', text);
    assert.equal(result.generalAudit.orderer.status, 'match', text);
    assert.equal(result.issueCount, 0, text);
  }
});

test('exact new regression locates the name in fulfillment prose without a field label', () => {
  const result = runGeneralAuditor(
    'Date: 26th June, 2026\nName of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nProducts:\nMultivitamin Syrup - 5',
    'Zipline. We have received your order for Isaac Awuyem.\nMultivitamin Syrup [5/5]'
  );
  assert.equal(result.meta.ordererName.fulfillmentValue, 'Isaac Awuyem');
  assert.equal(result.meta.ordererName.status, 'match');
  assert.equal(result.verdict, 'DISCREPANCY');
});

test('sentence names normalize case, repeated spaces and harmless punctuation', () => {
  for (const system of ['Order received for ISAAC   AWUYEM.', 'Requested by isaac awuyem!', 'Record: (ISAAC, AWUYEM)']) {
    const result = runGeneralAuditor('Name of Orderer: Isaac   Awuyem\nORS - 5', system + '\nORS [5/5]');
    assert.equal(result.meta.ordererName.status, 'match');
    assert.ok(system.includes(result.meta.ordererName.fulfillmentValue));
  }
});

test('explicit different orderer names create mismatches without first-name fuzzy matching', () => {
  for (const system of ['Order received for John Mensah.', 'Requested by Isaac Mensah', 'Isaac Mensah placed this order', 'Order received from Isaac Awuyem Mensah.']) {
    const result = runGeneralAuditor('Name of Orderer: Isaac Awuyem\nORS - 5', system + '\nORS [5/5]');
    assert.equal(result.meta.ordererName.status, 'mismatch', system);
    assert.equal(result.issueCount, 1, system);
    assert.deepEqual(result.generalAudit.discrepancies, ['Orderer Name Mismatch']);
  }
});

test('incidental customer-name mentions cannot override a different explicit orderer', () => {
  for (const system of ['Orderer: John Mensah\nNote: Isaac Awuyem reviewed the order.', 'Order received for John Mensah.\nContact: Isaac Awuyem']) {
    assert.equal(locateGeneralSystemOrderer(system, 'Isaac Awuyem'), 'John Mensah');
  }
});

test('name unavailable requires no exact name or identifiable orderer phrase in current fulfillment', () => {
  for (const system of [
    'Zipline. We have received your order.',
    'Order received for delivery tomorrow.',
    'Order received for Gbimsi CHPS.',
    'Note: Isaac Awuyemb',
    'Note: XIsaac Awuyem',
    'Note: Isaac Mensah',
    'Facility: Gbimsi CHPS'
  ]) {
    const result = runGeneralAuditor('Name of Orderer: Isaac Awuyem\nORS - 5', system + '\nORS [5/5]');
    assert.equal(result.meta.ordererName.status, 'not available in system entry', system);
    assert.equal(result.meta.ordererName.whatsappValue, 'Isaac Awuyem');
    assert.equal(result.issueCount, 1);
  }
});

test('a previous fulfillment name cannot leak into the next name search', () => {
  const customer = 'Name of Orderer: Isaac Awuyem\nORS - 5';
  assert.equal(runGeneralAuditor(customer, 'Requested by Isaac Awuyem\nORS [5/5]').meta.ordererName.status, 'match');
  assert.equal(runGeneralAuditor(customer, 'We have received your order.\nORS [5/5]').meta.ordererName.status, 'not available in system entry');
});


test('bulleted orderer prose is metadata rather than a product or unreadable quantity', () => {
  for (const sentence of ['- Requested by Isaac Awuyem', '- Confirmation metadata: Isaac Awuyem', '- Order received for John Mensah.']) {
    const result = runGeneralAuditor('Name of Orderer: Isaac Awuyem\nORS - 5', sentence + '\n- ORS [5/5]');
    assert.deepEqual(result.items.map(item => item.name), ['ORS']);
    assert.equal(result.meta.ordererName.status, sentence.includes('John Mensah') ? 'mismatch' : 'match');
  }
});


const facilityCrossCheckCustomer = `Date: 26th June, 2026
Name of Orderer: Isaac Awuyem
Name of Health Facility: Gbimsi CHPS
Delivery / Drop area: Gbimsi
District: West Mamprusi
Products:
Multivitamin Syrup - 5`;
const facilityCrossCheckProducts = 'Multivitamin Syrup [5/5]';

test('exact facility regression finds Gbimsi CHPS in current fulfillment prose', () => {
  const result = runGeneralAuditor(facilityCrossCheckCustomer, 'Zipline. We have received your order for Gbimsi CHPS.\n' + facilityCrossCheckProducts);
  assert.equal(result.meta.facilityName.whatsappValue, 'Gbimsi CHPS');
  assert.equal(result.meta.facilityName.fulfillmentValue, 'Gbimsi CHPS');
  assert.equal(result.meta.facilityName.status, 'match');
  assert.equal(result.meta.ordererName.status, 'not available in system entry');
  assert.equal(result.issueCount, 1);
  assert.equal(result.verdict, 'DISCREPANCY');
});

test('all requested fulfillment facility labels and sentence formats are recognized', () => {
  for (const line of [
    'Facility: Gbimsi CHPS', 'Health Facility: Gbimsi CHPS', 'Facility Name: Gbimsi CHPS',
    'Destination: Gbimsi CHPS', 'Delivery Facility: Gbimsi CHPS', 'Delivery Site: Gbimsi CHPS',
    'Deliver to: Gbimsi CHPS', 'Order for: Gbimsi CHPS', 'Delivery to Gbimsi CHPS',
    'Order for Gbimsi CHPS', 'Gbimsi CHPS order received',
    'Zipline. We have received your order for delivery to Gbimsi CHPS.',
    'Confirmation metadata: Gbimsi CHPS', 'Note: (Gbimsi CHPS)'
  ]) {
    const result = runGeneralAuditor(facilityCrossCheckCustomer, line + '\n' + facilityCrossCheckProducts);
    assert.equal(result.meta.facilityName.fulfillmentValue, 'Gbimsi CHPS', line);
    assert.equal(result.meta.facilityName.status, 'match', line);
    assert.equal(result.issueCount, 1, line);
    assert.deepEqual(result.items.map(item => item.name), ['Multivitamin Syrup']);
  }
});

test('clearly different facilities in prose or destination fields raise facility and missing-orderer discrepancies', () => {
  for (const line of ['Order received for Walewale Hospital.', 'Delivery to Walewale Hospital', 'Destination: Walewale Hospital', 'Walewale Hospital order received']) {
    const result = runGeneralAuditor(facilityCrossCheckCustomer, line + '\n' + facilityCrossCheckProducts);
    assert.equal(result.meta.facilityName.whatsappValue, 'Gbimsi CHPS');
    assert.equal(result.meta.facilityName.fulfillmentValue, 'Walewale Hospital', line);
    assert.equal(result.meta.facilityName.status, 'mismatch', line);
    assert.equal(result.meta.ordererName.status, 'not available in system entry');
    assert.equal(result.issueCount, 2);
    assert.deepEqual(result.generalAudit.discrepancies, ['Orderer Name Not Found', 'Facility Name Mismatch']);
  }
});

test('facility formatting aliases and listed suffix differences match', () => {
  for (const [customer, system] of [
    ['Gbimsi   CHPS', 'Delivery to GBIMSI CHPS.'],
    ['Gbimsi CHPS', 'Note: Gbimsi C.H.P.S.'],
    ['Gbimsi CHPS', 'Delivery to Gbimsi CHPS Compound.'],
    ['Vea HC', 'Order for Vea Health Centre.'],
    ['Vea Health Center', 'Confirmation metadata: Vea HC']
  ]) {
    const result = runGeneralAuditor(`Name of Health Facility: ${customer}\nORS - 5`, system + '\nORS [5/5]');
    assert.equal(result.meta.facilityName.status, 'match', system);
    assert.ok(system.includes(result.meta.facilityName.fulfillmentValue));
  }
  for (const [customer, system] of [
    ['Gbimsi CHPS', 'Order received for Gbimsi Health Centre.'],
    ['Vea HC', 'Delivery to Vea CHPS'],
    ['Gbimsi CHPS', 'Order for Gbimsi Hospital']
  ]) {
    const result = runGeneralAuditor(`Facility: ${customer}\nORS - 5`, system + '\nORS [5/5]');
    assert.equal(result.meta.facilityName.status, 'match', system);
    assert.equal(result.issueCount, 0);
  }
});

test('drop areas, districts and people never substitute for the current customer facility', () => {
  for (const line of [
    'Zipline. We have received your order.', 'Delivery / Drop area: Gbimsi',
    'District: West Mamprusi', 'Destination: West Mamprusi',
    'Order for Isaac Awuyem', 'Note: Gbimsi CHPShop', 'Note: XGbimsi CHPS'
  ]) {
    const result = runGeneralAuditor(facilityCrossCheckCustomer, line + '\n' + facilityCrossCheckProducts);
    assert.equal(result.meta.facilityName.whatsappValue, 'Gbimsi CHPS');
    assert.equal(result.meta.facilityName.fulfillmentValue, 'N/A', line);
    assert.equal(result.meta.facilityName.status, 'not available in system entry', line);
    assert.equal(result.issueCount, line === 'Order for Isaac Awuyem' ? 1 : 2, line);
    assert.doesNotMatch(result.verdict + result.insights.join(' '), /Facility Name Missing/);
  }
});

test('explicit destination takes priority over incidental matching facility mentions', () => {
  assert.equal(locateGeneralSystemFacility('Facility: Walewale Hospital\nNote: Previous destination Gbimsi CHPS', 'Gbimsi CHPS'), 'Walewale Hospital');
  assert.equal(locateGeneralSystemFacility('Order received for Walewale Hospital.\nNote: Gbimsi CHPS called.', 'Gbimsi CHPS'), 'Walewale Hospital');
});

test('customer facility extraction uses only customer facility labels', () => {
  for (const label of ['Name of Health Facility', 'Health Facility', 'Facility Name', 'Name of Facility', 'Facility']) {
    const result = extractGeneralInput(`District: West Mamprusi\nDelivery / Drop Area: Gbimsi\n${label}: Gbimsi CHPS`, 'customer_request');
    assert.equal(result.facilityName, 'Gbimsi CHPS');
  }
  assert.equal(extractGeneralInput('District: West Mamprusi\nDelivery / Drop Area: Gbimsi', 'customer_request').facilityName, 'N/A');
});

test('bulleted facility prose remains separate from product parsing', () => {
  for (const line of ['- Delivery to Gbimsi CHPS', '- Destination: Gbimsi CHPS', '- Note: Gbimsi CHPS', '- Order received for Walewale Hospital.']) {
    const result = runGeneralAuditor(facilityCrossCheckCustomer, line + '\n- ' + facilityCrossCheckProducts);
    assert.deepEqual(result.items.map(item => item.name), ['Multivitamin Syrup']);
    assert.equal(result.meta.facilityName.status, line.includes('Walewale') ? 'mismatch' : 'match');
  }
});

test('facility searches cannot reuse a previous fulfillment value', () => {
  assert.equal(runGeneralAuditor(facilityCrossCheckCustomer, 'Delivery to Gbimsi CHPS\n' + facilityCrossCheckProducts).meta.facilityName.status, 'match');
  assert.equal(runGeneralAuditor(facilityCrossCheckCustomer, 'We have received your order.\n' + facilityCrossCheckProducts).meta.facilityName.status, 'not available in system entry');
});


test('explicit delivery-facility labels identify names even without a suffix', () => {
  for (const label of ['Delivery Facility', 'Delivery Site']) {
    assert.equal(locateGeneralSystemFacility(`${label}: Walewale`, 'Gbimsi CHPS'), 'Walewale');
    assert.equal(runGeneralAuditor('Facility: Gbimsi CHPS\nORS - 5', `${label}: Walewale\nORS [5/5]`).meta.facilityName.status, 'mismatch');
  }
});


test('zero fulfillment fractions with brackets, parentheses and units record out of stock', () => {
  for (const quantity of ['[0/1]', '(0/1)', '( 0 / 1 )', '[0/1 bottles]', '(0/1 bottles)', '(0/1) bottles', '0 bottles']) {
    const result = runGeneralAuditor('Multivitamin Syrup - 1 bottles', `Multivitamin Syrup ${quantity}`);
    assert.equal(result.items[0].status, 'out of stock', quantity);
    assert.equal(Number.parseFloat(result.items[0].found), 0);
    assert.match(result.items[0].action, /out of stock/);
    assert.equal(result.hasOutOfStockItems, true);
    assert.equal(result.allMatch, true);
    assert.equal(result.issueCount, 0);
    assert.deepEqual(result.generalAudit.productCount, { requested: 1, found: 1, status: 'match' });
    assert.deepEqual(result.generalAudit.discrepancies, []);
  }
});

test('partial fulfillment remains a discrepancy, while zero quantities remain recorded separately', () => {
  const result = runGeneralAuditor('ORS - 1\nMultivitamin Syrup - 5', 'ORS (0/1)\nMultivitamin Syrup (3/5)', { [normalizeGeneralProductName('Multivitamin Syrup')]: false });
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'quantity mismatch']);
  assert.equal(result.issueCount, 1);
  assert.equal(result.allMatch, false);
  assert.equal(result.generalAudit.discrepancies.length, 1);
  assert.match(result.generalAudit.discrepancies[0], /Multivitamin Syrup quantity mismatch/);
  assert.doesNotMatch(result.generalAudit.discrepancies.join(' '), /ORS/);
});

test('absent products remain missing while unrequested zero fractions are informational', () => {
  const result = runGeneralAuditor('Multivitamin Syrup - 1', 'ORS (0/1)');
  assert.deepEqual(result.items.map(item => item.status), ['missing item', 'out of stock']);
  assert.equal(result.allMatch, false);
  assert.equal(result.hasOutOfStockItems, true);
  assert.equal(result.issueCount, 1); // Only the absent product is a discrepancy.
});

test('duplicate fulfilled lines use their total rather than a single zero line', () => {
  const result = runGeneralAuditor('ORS - 5', 'ORS (0/2)\nORS (3/3)', { [normalizeGeneralProductName('ORS')]: false });
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.items[0].found, '3');
  assert.equal(result.issueCount, 1);
});
