import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { runGeneralAuditor, summarizeGeneralProducts } from './generalAuditor';
import { classifyGeneralText, generalOrderRelevantText } from '../src/utils/generalTextClassification';
import Details from '../src/components/GeneralAuditDetails';
const header = 'Name of Orderer: Kwame Mensah\nName of Health Facility: Example Health Centre\n';
const order = header + 'Multivitamin Syrup — 5 bottles';
const sms = 'You will receive your flight notifications via SMS.';
const arrival = 'Your order is expected to arrive between 10:00 AM and 12:00 PM.';
const offline = () => { throw Error('Gemini unavailable'); };

for (const notice of [sms, arrival,
  'You will receive flight notifications via SMS.',
  'Tracking updates will be sent via SMS.',
  'You will be notified by SMS when your order is dispatched.',
  'Please track your delivery using the link in your SMS.',
  'Your tracking link will be sent by text message.',
  'Your shipment will arrive tomorrow at 10:00 AM.',
  'You will receive your flight notifications via SMS. thank you for your order.',
  'Thank you for your order. You will receive your flight notifications via SMS.']) {
  test(`routine notice is removed before scoring and rendering: ${notice}`, async () => {
    assert.equal(classifyGeneralText(notice).category, 'administrative');
    for (const side of ['customer', 'system']) {
      let calls = 0;
      const result = await runGeneralSemanticAudit(order + (side === 'customer' ? '\n' + notice : ''), order + (side === 'system' ? '\n' + notice : ''), {}, {}, () => { calls++; return offline(); });
      assert.equal(calls, 0);
      assert.equal(result.allMatch, true);
      assert.equal(result.confidence, 100);
      assert.equal(result.issueCount, 0);
      assert.equal(result.auditSummary.reviewRequiredCount || 0, 0);
      assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
      assert.equal('administrativeInformation' in result.generalAudit, false);
      assert.ok(!JSON.stringify(result.generalAudit).includes(notice));
      const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
      assert.doesNotMatch(html, /notifications via SMS|expected to arrive|IGNORED|MANUAL REVIEW REQUIRED/);
    }
  });
}

for (const directive of [
  'Please change the quantity of Paracetamol from 5 to 10.',
  'Please deliver these products to a different facility.',
  'Please increase Multivitamin Syrup to 10 bottles.',
  'Please change the orderer to Ama and send confirmation via SMS.',
  'Delivery should go to a different district.',
  'please increase Multivitamin Syrup to 10 bottles.',
  'please deliver these products to a different facility.',
]) {
  test(`routine SMS cannot hide an actual instruction: ${directive}`, async () => {
    for (const text of [directive, sms + ' ' + directive, directive + ' ' + sms]) {
      assert.notEqual(classifyGeneralText(text).category, 'administrative');
      const result = await runGeneralSemanticAudit(order, order + '\n' + text, {}, {}, offline);
      assert.equal(result.allMatch, false);
      assert.ok(result.auditSummary.reviewRequiredCount);
      assert.ok(result.generalAudit.semanticReviews?.some(review => review.originalText === directive));
      assert.ok(!JSON.stringify(result.generalAudit).includes(sms));
      assert.equal(result.items[0].fulfillment.supplied, 5);
      assert.equal(result.items[0].status, 'match', 'separately verified product retains its result');
    }
  });
}

test('notification removal preserves decimal specifications and source line positions', async () => {
  const product = 'Paracetamol 120mg/5ml — 2.5 bottles';
  const text = header + product + '. ' + sms.toLowerCase() + '\n' + arrival;
  const relevant = generalOrderRelevantText(text);
  assert.equal(relevant, header + product + '.\n');
  assert.equal(relevant.split('\n').length, text.split('\n').length);
  const result = await runGeneralSemanticAudit(header + product, text, {}, {}, offline);
  assert.equal(result.allMatch, true);
  assert.equal(result.items[0].fulfillment.supplied, 2.5);
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
});

for (const text of [
  'SMS: send Paracetamol 5 bottles.',
  'Your order is expected to arrive with Paracetamol 10 bottles.',
  'You will receive flight notifications via SMS with the facility changed to Asaam HC.',
  'You will receive your flight notifications via SMS for a different facility.',
  'Your order is expected to arrive at Another Health Centre.',
  'Flight notification: patient requested additional medication.',
  'Please verify this SMS before dispatch.',
]) test(`unknown or operational notification text remains relevant: ${text}`, async () => {
  assert.notEqual(classifyGeneralText(text).category, 'administrative');
  assert.equal(generalOrderRelevantText(text), text);
  const result = await runGeneralSemanticAudit(order, order + '\n' + text, {}, {}, offline);
  assert.equal(result.allMatch, false);
});

test('mixed stale review is cleaned and deduplicated before confidence calculation', () => {
  const base = runGeneralAuditor(order, order);
  const change = 'Please increase Multivitamin Syrup to 10 bottles.';
  const review = (originalText: string) => ({ kind: 'unparsed_text' as const, source: 'fulfillment_confirmation' as const, originalText, possibleMatches: [], reason: 'Verify actual order information.' });
  const rebuild = (reviews: ReturnType<typeof review>[]) => summarizeGeneralProducts(base.items, base.generalAudit.facility, base.generalAudit.orderer, base.generalAudit.phone, 1, 1, reviews,
    { ...base.generalAudit, administrativeInformation: [{ text: sms }] } as any);
  const clean = rebuild([review(sms), review(arrival)]);
  assert.equal(clean.allMatch, true); assert.equal(clean.confidence, 100);
  assert.equal('administrativeInformation' in clean.generalAudit, false);
  const mixed = rebuild([review(sms + ' ' + change), review(change)]);
  assert.equal(mixed.allMatch, false);
  assert.equal(mixed.generalAudit.semanticReviews?.length, 1);
  assert.equal(mixed.generalAudit.semanticReviews?.[0].originalText, change);
});

test('notifications cannot satisfy missing compulsory identity and optional differences never create conflicts', async () => {
  const missing = await runGeneralSemanticAudit(order, 'Multivitamin Syrup — 5 bottles\n' + sms, {}, {}, offline);
  assert.equal(missing.allMatch, false);
  assert.equal(missing.auditSummary.missingRequiredCount, 2);
  const conflict = await runGeneralSemanticAudit(order + '\nDistrict: One Place', order + '\nDistrict: Another Place\n' + sms, {}, {}, offline);
  assert.equal(conflict.generalAudit.district?.status, 'informational');
  assert.equal(conflict.allMatch, true);
});
