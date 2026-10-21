import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { runGeneralAuditor, summarizeGeneralProducts } from './generalAuditor';
import { interpretGeneralOrder } from './generalOrderInterpretation';
import { classifyGeneralText, generalOrderRelevantText } from '../src/utils/generalTextClassification';
import Details from '../src/components/GeneralAuditDetails';

const header = 'Name of Orderer: Kwame Mensah\nName of Health Facility: Example Health Centre\n';
const products = 'Paracetamol Tablets — 10 boxes\nMultivitamin Syrup — 5 bottles';
const contact = 'Please reach out to the nearest stock for the rest of the order.';
const restock = 'Once re-stocked, we will notify you and be able to deliver the rest, if still needed.';
const footer = contact + ' ' + restock;
const offline = () => { throw Error('Gemini deliberately unavailable'); };
const audit = (customer: string, system: string) => runGeneralSemanticAudit(header + customer, header + system, {}, {}, offline);

for (const notice of [contact, restock, footer,
  'Once re-stocked, we will notify you and deliver the rest, if still needed.',
  'Please contact the nearest stock for the rest.',
  'Please check with another stock location for the remaining items.',
  'Please contact your local stock point for the remainder of your order.',
  'When stock becomes available, we can supply the remaining products, if required.',
  'When the items are back in stock, we will deliver the rest of your order.',
  'We will notify you once we are restocked.',
  'Some items are currently unavailable.',
  'Certain products are awaiting restocking.',
  'We are currently awaiting re-stocking.',
  'Stock availability is subject to change.',
  'The remaining items are currently out of stock.',
  'Your remaining products are unavailable. We will notify you once we are restocked.',
  'You will receive SMS notifications.',
]) test(`routine stock communication is silent before scoring and rendering: ${notice}`, async () => {
  assert.equal(classifyGeneralText(notice).category, 'administrative');
  const base = runGeneralAuditor(header + products, header + products);
  for (const side of ['customer', 'system']) {
    let calls = 0;
    const result = await runGeneralSemanticAudit(header + products + (side === 'customer' ? '\n' + notice : ''),
      header + products + (side === 'system' ? '\n' + notice : ''), {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0);
    assert.equal(result.semanticAnalysis.status, 'skipped');
    assert.equal(result.allMatch, true);
    assert.equal(result.confidence, 100);
    assert.equal(result.issueCount, 0);
    assert.deepEqual(result.auditSummary, base.auditSummary);
    assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
    assert.ok(!JSON.stringify(result).includes(notice));
    const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
    assert.doesNotMatch(html, /MANUAL REVIEW REQUIRED|UNRESOLVED TEXT|nearest stock|re-stocked|SMS notifications/);
  }
});

test('explicit out-of-stock row preserves the exception with a restocking footer', async () => {
  const result = await audit(products, 'Paracetamol Tablets — 10 boxes\nMultivitamin Syrup — 0/5\n' + footer);
  assert.deepEqual(result.items.map(item => item.status), ['match', 'out of stock']);
  assert.equal(result.allMatch, true);
  assert.equal(result.issueCount, 0);
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
  assert.equal(result.semanticAnalysis.status, 'skipped');
});

for (const supplied of ['5 bottles', '[5/10] bottles']) test(`generic footer cannot excuse genuine shortage: ${supplied}`, async () => {
  const result = await audit('Multivitamin Syrup — 10 bottles', 'Multivitamin Syrup — ' + supplied + '\n' + footer);
  assert.equal(result.allMatch, false);
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.issueCount, 1);
  assert.ok(result.items[0].provenance.every(evidence => !evidence.orderLimitApplied));
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
  assert.equal(result.semanticAnalysis.status, 'skipped');
});

test('generic stock notice does not satisfy a missing product', async () => {
  const result = await audit(products, 'Paracetamol Tablets — 10 boxes\n' + footer);
  assert.equal(result.allMatch, false);
  assert.deepEqual(result.items.map(item => item.status), ['match', 'missing item']);
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
});

test('mixed SMS and explicit stock prose preserves named product, zero ratio and provenance', async () => {
  const stock = 'Paracetamol Tablets are out of stock, 0/10.';
  for (const line of ['You will receive SMS notifications. ' + stock, stock + ' ' + restock]) {
    const result = await audit('Paracetamol Tablets — 10 boxes', line);
    assert.equal(result.allMatch, true);
    assert.deepEqual(result.items.map(item => item.status), ['out of stock']);
    assert.equal(result.items[0].provenance[1].ratioRequestedQuantity, 10);
    assert.equal(result.items[0].provenance[1].line, 3);
    assert.equal(result.semanticAnalysis.status, 'skipped');
    assert.ok(!JSON.stringify(result).includes('You will receive'));
    assert.ok(!JSON.stringify(result).includes(restock));
  }
});

test('inline stock annotations never turn a positive quantity into zero', async () => {
  const result = await audit('Paracetamol Tablets — 10 boxes', 'Paracetamol Tablets are out of stock, 5/10. ' + footer);
  assert.equal(result.allMatch, false);
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.items[0].fulfillment.supplied, 5);
});

test('multiple products retain their own status when administrative sentences share a product line', async () => {
  const result = await audit(products, 'Paracetamol Tablets — 10 boxes. ' + contact + '\n' + restock + ' Multivitamin Syrup — 0/5');
  assert.equal(result.allMatch, true);
  assert.deepEqual(result.items.map(item => item.status), ['match', 'out of stock']);
  assert.ok(!JSON.stringify(result).includes(contact));
  assert.ok(!JSON.stringify(result).includes(restock));
});

for (const directive of [
  'Please change the quantity of Paracetamol from 5 to 10.',
  'Please increase Multivitamin Syrup to 10 bottles.',
  'Please deliver these products to a different facility.',
  'Change the orderer to Ama.',
  'Please contact the nearest stock for Paracetamol Tablets — 10 boxes.',
  'Once restocked, we will deliver Multivitamin Syrup — 10 bottles.',
  'Some items are unavailable; send an alternative product.',
  'Please contact the nearest stock for the rest and change the district.',
]) test(`real or unrecognized information stays under review: ${directive}`, async () => {
  assert.notEqual(classifyGeneralText(directive).category, 'administrative');
  assert.equal(generalOrderRelevantText(directive), directive);
  const result = await audit(products, products + '\n' + footer + ' ' + directive);
  assert.equal(result.allMatch, false);
  assert.ok(result.generalAudit.semanticReviews?.some(review => review.originalText === directive));
  assert.ok(!JSON.stringify(result.generalAudit).includes(contact));
  assert.ok(!JSON.stringify(result.generalAudit).includes(restock));
});

test('missing mandatory identities and optional location conflicts survive restocking text', async () => {
  for (const label of ['Name of Orderer: Kwame Mensah\n', 'Name of Health Facility: Example Health Centre\n']) {
    const result = await runGeneralSemanticAudit(header + products, header.replace(label, '') + products + '\n' + footer, {}, {}, offline);
    assert.equal(result.allMatch, false);
    assert.equal(result.auditSummary.missingRequiredCount, 1);
    assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
  }
  const conflict = await audit(products + '\nDistrict: First\nDrop Area: One', products + '\nDistrict: Second\nDrop Area: Two\n' + footer);
  assert.equal(conflict.allMatch, false);
  assert.equal(conflict.generalAudit.district?.status, 'mismatch');
  assert.equal(conflict.generalAudit.dropArea?.status, 'mismatch');
});

test('stock section headings remain operative and are never discarded as generic notices', async () => {
  const heading = 'We are currently out of stock for the following items:';
  assert.notEqual(classifyGeneralText(heading).category, 'administrative');
  const result = await audit(products, 'Paracetamol Tablets — 10 boxes\n' + heading + '\n- Multivitamin Syrup\n' + footer);
  assert.deepEqual(result.items.map(item => item.status), ['match', 'out of stock']);
  assert.equal(result.allMatch, true);
});

test('summary rebuild removes stale generic reviews before confidence and final status', () => {
  const base = runGeneralAuditor(header + products, header + products), d = base.generalAudit;
  const result = summarizeGeneralProducts(base.items, d.facility, d.orderer, d.phone, 2, 2,
    [{ kind: 'unparsed_text', source: 'fulfillment_confirmation', originalText: footer, possibleMatches: [], reason: 'Old review' }], d);
  assert.equal(result.allMatch, true);
  assert.equal(result.confidence, 100);
  assert.equal(result.auditSummary.reviewRequiredCount || 0, 0);
});

test('Gemini receives only relevant text when another line genuinely needs interpretation', async () => {
  const directive = 'Please include an additional product for the patient.';
  let calls = 0;
  let sentRequest: any;
  const result = await interpretGeneralOrder(header + products, header + products + '\n' + footer + '\n' + directive, () => ({ models: { generateContent: async (request: any) => {
    calls++;
    sentRequest = request;
    throw Error('Gemini deliberately unavailable');
  } } }));
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(sentRequest).includes(contact));
  assert.ok(!JSON.stringify(sentRequest).includes(restock));
  assert.ok(sentRequest.contents.includes(directive));
  assert.equal(result.semanticAnalysis.status, 'fallback');
  assert.ok(!JSON.stringify(result).includes(contact));
  assert.ok(!JSON.stringify(result).includes(restock));
  assert.equal(result.fulfilmentConfirmation.split('\n').length, (header + products + '\n' + footer + '\n' + directive).split('\n').length);
});
