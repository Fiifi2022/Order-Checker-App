import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { runGeneralAuditor } from './generalAuditor';
import Details from '../src/components/GeneralAuditDetails';

const h = 'Facility: Asaam HC\nOrderer: Test Operator\n';
const extra = 'Please include an additional product for the patient.';
const offline = () => { throw new Error('AI unavailable'); };

test('exact Multivitamin Syrup with 5 bottles is verified without acquiring a Gemini client', async () => {
  let calls = 0;
  const result = await runGeneralSemanticAudit(h + 'Multivitamin Syrup — 5 bottles', h + 'Multivitamin Syrup — 5 bottles', {}, {}, () => { calls++; return offline(); });
  assert.equal(calls, 0);
  assert.equal(result.semanticAnalysis.status, 'skipped');
  assert.equal(result.allMatch, true);
  assert.equal(result.items[0].status, 'match');
  assert.equal(result.items[0].fulfillment.requested, 5);
  assert.equal(result.items[0].fulfillment.supplied, 5);
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
});

test('exact product matching is reusable across catalogue and unlisted names without Gemini', async () => {
  for (const product of ['Multivitamin Syrup', 'Paracetamol 120mg/5ml Syrup', 'Amoxicillin 250mg/5ml Suspension', 'Unlisted exact product', "Children's Multivitamin Syrup", 'Multivitamin Syrup for children', "Children's Paracetamol 120mg/5ml Syrup"]) {
    let calls = 0;
    const line = `${product} — 5 bottles`;
    const result = await runGeneralSemanticAudit(h + line, h + line, {}, {}, () => { calls++; return offline(); });
    assert.equal(calls, 0, product);
    assert.equal(result.semanticAnalysis.status, 'skipped', product);
    assert.equal(result.allMatch, true, product);
    assert.ok(result.items.length > 0, product);
    assert.ok(result.items.every(item => item.status === 'match'), product);
    assert.equal(result.generalAudit.semanticReviews?.length || 0, 0, product);
  }
});

test('an age qualifier cannot make a vague product or instruction deterministically verified', async () => {
  for (const product of ["Children's Cough Syrup", 'Need Multivitamin Syrup for children', "Children's unlisted mixture"]) {
    const line = `${product} — 5 bottles`;
    const result = await runGeneralSemanticAudit(h + line, h + line, {}, {}, offline);
    assert.equal(result.allMatch, false, product);
    assert.ok(result.generalAudit.semanticReviews?.length, product);
  }
});

test('offline AI and unrelated unresolved text cannot replace quantity or clinical discrepancies', async () => {
  for (const [customer, fulfillment] of [
    ['Multivitamin Syrup — 5 bottles', 'Multivitamin Syrup — 3 bottles'],
    ["Children's Multivitamin Syrup — 5 bottles", "Children's Multivitamin Syrup — 3 bottles"],
    ['Multivitamin Syrup — 5 bottles', 'Multivitamin Syrup — 5 tablets'],
    ['Multivitamin Syrup 100ml — 5 bottles', 'Multivitamin Syrup 200ml — 5 bottles'],
    ['Paracetamol 120mg/5ml Syrup — 5 bottles', 'Paracetamol 250mg/5ml Syrup — 5 bottles']
  ]) {
    const deterministic = runGeneralAuditor(h + customer, h + fulfillment);
    const result = await runGeneralSemanticAudit(h + `${customer}\n${extra}`, h + fulfillment, {}, {}, offline);
    assert.equal(result.allMatch, false);
    assert.deepEqual(result.items.map(item => item.status), deterministic.items.map(item => item.status));
    assert.ok(result.issueCount > 0, `${customer} / ${fulfillment}`);
    assert.deepEqual(result.generalAudit.semanticReviews?.map(review => [review.kind, review.originalText]), [['unparsed_text', extra]]);
    assert.doesNotMatch(result.generalAudit.discrepancies.join(' '), /AI unavailable|Gemini unavailable|ambiguous product/i);
  }
});

test('an unrelated unresolved line cannot mark any exact product as ambiguous on AI failure', async () => {
  for (const name of ['Multivitamin Syrup', 'Paracetamol Syrup', 'Amoxicillin Suspension', 'Unlisted exact product', "Children's Multivitamin Syrup"]) {
    const result = await runGeneralSemanticAudit(h + `${name} — 5 bottles\n${extra}`, h + `${name} — 5 bottles`, {}, {}, offline);
    assert.equal(result.items[0].status, 'match', name);
    assert.equal(result.allMatch, false, 'unresolved text still prevents whole-order approval');
    assert.equal(result.issueCount, 0, 'an unresolved line is not a confirmed product discrepancy');
    assert.match(result.generalAudit.finalStatus, /MANUAL REVIEW REQUIRED/);
    assert.deepEqual(result.generalAudit.semanticReviews?.map(review => [review.kind, review.originalText]), [['unparsed_text', extra]]);
    assert.ok(result.generalAudit.discrepancies.every(issue => !issue.includes(name)));
    const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
    assert.doesNotMatch(html, /AMBIGUOUS PRODUCT/);
    assert.match(html, /MANUAL REVIEW REQUIRED — UNRESOLVED TEXT/);
  }
});

test('AI fallback reviews only the affected fulfillment line too', async () => {
  const result = await runGeneralSemanticAudit(h + 'Multivitamin Syrup — 5 bottles', h + `Multivitamin Syrup — 5 bottles\n${extra}`, {}, {}, offline);
  assert.equal(result.items[0].status, 'match');
  assert.deepEqual(result.generalAudit.semanticReviews?.map(review => [review.source, review.originalText]), [['fulfillment_confirmation', extra]]);
});

test('quantity, packaging units and clinical specification differences retain deterministic discrepancies', async () => {
  for (const [left, right] of [
    ['Multivitamin Syrup — 5 bottles', 'Multivitamin Syrup — 3 bottles'],
    ['Multivitamin Syrup — 5 bottles', 'Multivitamin Syrup — 5 tablets'],
    ['Multivitamin Syrup 100ml — 5 bottles', 'Multivitamin Syrup 200ml — 5 bottles'],
    ['Paracetamol 120mg/5ml Syrup — 5 bottles', 'Paracetamol 250mg/5ml Syrup — 5 bottles'],
    ['Multivitamin Syrup — 5 bottles', 'Multivitamin Tablet — 5 tablets']
  ]) {
    const expected = runGeneralAuditor(h + left, h + right);
    const result = await runGeneralSemanticAudit(h + left, h + right, {}, {}, offline);
    assert.equal(result.allMatch, false, `${left} / ${right}`);
    assert.deepEqual(result.items.map(item => item.status), expected.items.map(item => item.status));
    assert.equal(result.generalAudit.semanticReviews?.length || 0, 0, 'explicit differences are not AI-availability errors');
  }
});

test('an AI ambiguity opinion cannot delete or change a deterministically resolved product', async () => {
  const line = 'Multivitamin Syrup — 5 bottles';
  const pair = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
  const product = (originalText: string) => ({ status: 'AMBIGUOUS_PRODUCT', originalText, interpretedProduct: null, canonicalProductName: null,
    acronymDetected: null, acronymMeaning: null, synonymsDetected: [], brandNameDetected: null, genericName: null, dosage: null, formulation: null, strength: null,
    quantity: 999, quantityText: '999', unit: null, confidence: 0.1, reasoningNote: 'Uncertain', possibleMatches: [] });
  const result = await runGeneralSemanticAudit(h + `${line}\n${extra}`, h + line, {}, {}, () => ({ models: { async generateContent() {
    return { text: JSON.stringify({ facility: pair(), orderer: pair(), customerProducts: [product(line)], fulfilmentProducts: [product(line)], semanticWarnings: [] }) };
  } } }));
  assert.equal(result.items[0].status, 'match');
  assert.equal(result.items[0].fulfillment.requested, 5); assert.equal(result.items[0].fulfillment.supplied, 5);
  assert.ok(!(result.generalAudit.semanticReviews || []).some(review => review.originalText === line));
  assert.equal(result.allMatch, false, 'omitted unresolved text cannot be approved by an otherwise valid AI response');
  assert.deepEqual(result.generalAudit.semanticReviews?.map(review => [review.kind, review.originalText]), [['unparsed_text', extra]]);
});

test('broad clinical names remain product-specific review even when both sides spell them identically', async () => {
  const result = await runGeneralSemanticAudit(h + 'Multivitamin Syrup - 5\nCough syrup - 2', h + 'Multivitamin Syrup [5/5]\nCough syrup [2/2]', {}, {}, offline);
  assert.equal(result.allMatch, false);
  assert.equal(result.items.find(item => item.name === 'Multivitamin Syrup')?.status, 'match');
  assert.ok(result.generalAudit.semanticReviews?.every(review => /cough syrup/i.test(review.originalText)));
});
