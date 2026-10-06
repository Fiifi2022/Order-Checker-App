import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAuditLanguage, approvedProductName, interpretAuditInputs, needsAuditSemantics, validateAuditSemantics, type AuditSemantics, type SemanticProduct } from './auditSemantics';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { runGeneralAuditor } from './generalAuditor';
import { syncAllDistrictsToFacilities, getAllFacilities, validateVaccineOrder } from './vaccineService';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';

const quiet = { info() {}, warn() {} };
const pair = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
const empty = (): AuditSemantics => ({ facility: pair(), orderer: pair(), customerProducts: [], fulfilmentProducts: [], possibleMissingProducts: [], possibleExtraProducts: [], semanticWarnings: [] });
const product = (sourceText: string, name: string, normalizedName: string, quantityText: string, quantity: number, confidence = 0.99): SemanticProduct => ({ sourceText, name, normalizedName, quantityText, quantity, confidence });
const client = (data: unknown, onCall = () => {}) => () => ({ models: { async generateContent(options: any) {
  onCall(); assert.equal(options.config.responseMimeType, 'application/json'); assert.ok(options.config.responseSchema);
  assert.equal(options.config.httpOptions.timeout, 10000);
  return { text: JSON.stringify(data) };
} } });
const headers = 'Facility: Kade HC\nOrderer: Isaac Awuyem\n';

test('standard aliases and quantities bypass Gemini without changing deterministic results', async () => {
  const a = headers + 'PCM 500mg - 5', b = headers + 'Paracetamol 500mg [5/5]';
  assert.equal(needsAuditSemantics(a, b, 'general'), false);
  const result = await analyzeAuditLanguage(a, b, 'general', () => { throw new Error('must not call'); }, quiet);
  assert.equal(result.semanticAnalysis.status, 'skipped'); assert.equal(result.customerRequest, a);
  assert.equal(runGeneralAuditor(a, b).allMatch, true);
});

test('evidence-grounded natural language reaches the unchanged General Auditor', async () => {
  const aLine = 'Please send 5 PCM 500mg tablets today.', bLine = 'We have packed 5 Paracetamol 500mg tablets today.';
  const a = headers + aLine, b = headers + bLine;
  const data = empty(); data.customerProducts = [product(aLine, 'PCM 500mg tablets', 'Paracetamol 500mg tablets', '5', 5)];
  data.fulfilmentProducts = [product(bLine, 'Paracetamol 500mg tablets', 'Paracetamol 500mg tablets', '5', 5)];
  assert.ok(validateAuditSemantics(data, a, b));
  const result = await runGeneralSemanticAudit(a, b, {}, {}, client(data));
  assert.equal(result.semanticAnalysis.status, 'used'); assert.equal(result.allMatch, true);
  assert.equal(result.items[0].requested, '5'); assert.equal(result.items[0].found, '5');
});

test('unexplained partial supply remains a mismatch and confirmed decisions are recomputed', async () => {
  const aLine = 'Please supply 15 bottles of Paracetamol 120mg/5mL Syrup today.', bLine = 'Packed Paracetamol 120mg/5mL Syrup [5/15] for today.';
  const a = headers + aLine, b = headers + bLine;
  const data = empty(); data.customerProducts = [product(aLine, 'Paracetamol 120mg/5mL Syrup', 'Paracetamol 120mg/5mL Syrup', '15 bottles', 15)];
  data.fulfilmentProducts = [product(bLine, 'Paracetamol 120mg/5mL Syrup', 'Paracetamol 120mg/5mL Syrup', '5/15', 5)];
  // Preserve the explicit bottle unit on both sides in this conversion fixture.
  data.customerProducts[0].quantityText = '15';
  const pending = await runGeneralSemanticAudit(a, b, {}, {}, client(data));
  assert.equal(pending.generalAudit.pendingOrderLimitCount, 0);
  assert.equal(pending.items[0].status, 'quantity mismatch');
  const key = pending.generalAudit.products[0].key;
  const yes = await runGeneralSemanticAudit(a, b, { [key]: true }, {}, client(data));
  assert.equal(yes.generalAudit.products[0].fulfillmentStatus, 'order limit applied');
  assert.equal(yes.generalAudit.products[0].supplied, 5);
  const no = await runGeneralSemanticAudit(a, b, { [key]: false }, {}, client(data));
  assert.equal(no.items[0].status, 'quantity mismatch');
});

test('numeric conflicts, negative quantities, strength tokens and invented evidence are rejected', () => {
  const cases = [
    product('PCM 500mg - 5', 'PCM 500mg', 'Paracetamol 500mg', '5', 9),
    product('PCM 500mg - 5', 'PCM 500mg', 'Paracetamol 500mg', '500', 500),
    product('PCM 500mg - -5', 'PCM 500mg', 'Paracetamol 500mg', '5', 5),
    product('Unseen Product - 5', 'Unseen Product', 'Unseen Product', '5', 5)
  ];
  for (const claim of cases) { const data = empty(); data.customerProducts = [claim]; assert.equal(validateAuditSemantics(data, 'PCM 500mg - 5', ''), null); }
});

test('ratio denominators never replace the explicit supplied numerator', () => {
  const raw = 'Paracetamol [3/10]'; const data = empty();
  data.fulfilmentProducts = [product(raw, 'Paracetamol', 'Paracetamol', '10', 10)];
  assert.ok(validateAuditSemantics(data, '', raw));
  assert.equal(interpretAuditInputs(data, '', raw, 'general').fulfilmentConfirmation, raw);
});

test('low confidence keeps original evidence and unsafe product equivalences cannot pass', () => {
  const p = product('Please pack 5 PCM today.', 'PCM', 'Paracetamol', '5', 5, 0.5);
  const data = empty(); data.customerProducts = [p];
  assert.equal(interpretAuditInputs(data, p.sourceText, '', 'general').customerRequest, p.sourceText);
  assert.equal(approvedProductName(product('IPV - 5', 'IPV', 'OPV', '5', 5), 'vaccine'), 'IPV');
  assert.equal(approvedProductName(product('BCG Diluent - 5', 'BCG Diluent', 'BCG', '5', 5), 'vaccine'), 'BCG Diluent');
  assert.equal(approvedProductName(product('PCM 120mg - 5', 'PCM 120mg', 'Paracetamol 500mg', '5', 5), 'general'), 'PCM 120mg');
});

test('invalid/incomplete JSON and unavailable Gemini fall back without exposing SDK secrets', async () => {
  for (const [suffix, getClient] of [
    ['invalid', client({})],
    ['unavailable', () => { throw Object.assign(new Error('private-key medical input'), { code: 503 }); }]
  ] as const) {
    const logs: unknown[] = [];
    const raw = `Facility: Fallback ${suffix} HC\nOrderer: Isaac\nPCM - 5`;
    const result = await analyzeAuditLanguage(raw, 'PCM - 5', 'general', getClient, { info: (...v) => logs.push(v), warn: (...v) => logs.push(v) });
    assert.equal(result.semanticAnalysis.status, 'fallback'); assert.equal(result.customerRequest, raw);
    assert.doesNotMatch(JSON.stringify(logs), /private-key|medical input/);
  }
});

test('cached extraction avoids repeated Gemini calls without caching final decisions', async () => {
  let calls = 0; const raw = 'Please send 7 PCM today (cache fixture).'; const data = empty();
  data.customerProducts = [product(raw, 'PCM', 'Paracetamol', '7', 7)];
  await analyzeAuditLanguage(raw, '', 'general', client(data, () => calls++), quiet);
  await analyzeAuditLanguage(raw, '', 'general', client(data, () => calls++), quiet);
  assert.equal(calls, 1);
});

test('AI cannot erase unrecognized products or quantities it omits from its JSON', () => {
  const raw = '- Product A - 5\n- Product B - unreadable'; const data = empty();
  data.customerProducts = [product('- Product A - 5', 'Product A', 'Product A', '5', 5)];
  const result = interpretAuditInputs(data, raw, 'Product A - 5', 'general');
  assert.match(result.customerRequest, /Product B - unreadable/);
  assert.throws(() => runGeneralAuditor(result.customerRequest, result.fulfilmentConfirmation), /Unable to read/);
});

test('semantic name variation needs AI confidence and equal deterministic first/surname evidence', async () => {
  const a = 'Facility: Kade HC\nOrderer: Isaac Mensah Awuyem\nPCM - 5';
  const b = 'Facility: Kade Health Centre\nOrderer: Isaac Awuyem\nPCM - 5';
  const data = empty(); data.orderer = { customerRequest: { value: 'Isaac Mensah Awuyem', sourceText: 'Orderer: Isaac Mensah Awuyem', confidence: 0.99 }, fulfilmentConfirmation: { value: 'Isaac Awuyem', sourceText: 'Orderer: Isaac Awuyem', confidence: 0.99 }, equivalent: true, confidence: 0.99 };
  const result = await runGeneralSemanticAudit(a, b, {}, {}, client(data));
  assert.equal(result.generalAudit.orderer.status, 'match');
  assert.equal(result.generalAudit.orderer.whatsappValue, 'Isaac Mensah Awuyem');
  assert.equal(result.generalAudit.facility.status, 'match');
  data.orderer.fulfilmentConfirmation.value = 'Evelyn Awuyem'; data.orderer.fulfilmentConfirmation.sourceText = 'Orderer: Evelyn Awuyem';
  const changed = interpretAuditInputs(data, a, b.replace('Isaac Awuyem', 'Evelyn Awuyem'), 'general');
  assert.equal(runGeneralAuditor(changed.customerRequest, changed.fulfilmentConfirmation).generalAudit.orderer.status, 'mismatch');
});

test('missing orderer remains absent and requires review', async () => {
  const a = 'Facility: Missing Orderer HC\nOrderer: Isaac Awuyem\nPCM - 5';
  const b = 'Facility: Missing Orderer HC\nPCM - 5';
  const result = await runGeneralSemanticAudit(a, b, {}, {}, client(empty()));
  assert.equal(result.generalAudit.orderer.fulfillmentValue, 'N/A');
  assert.equal(result.allMatch, false); assert.equal(result.issueCount, 1);
  assert.ok(result.generalAudit.warnings?.includes('ORDERER NAME NOT FOUND'));
});

test('current server semantic results render; old or stale input results are still recomputed', () => {
  const inputs = { whatsappMessage: headers + 'PCM - 5', fulfillmentConfirmation: headers + 'PCM - 5' };
  const run = createGeneralAuditRun(inputs, 1, {}, {}, true);
  const response = { ...runGeneralAuditor(inputs.whatsappMessage, inputs.fulfillmentConfirmation), ...inputs, auditEngine: 'general-deterministic-v1', semanticAnalysis: { status: 'used' } };
  assert.equal(completeGeneralAuditRun(run, response).semanticAnalysis.status, 'used');
  const stale = { ...response, fulfillmentConfirmation: 'old inputs', items: [{ name: 'stale product' }] };
  assert.equal(completeGeneralAuditRun(run, stale).items[0].name, 'PCM');
  const natural = createGeneralAuditRun({ whatsappMessage: 'Please send 5 PCM today.', fulfillmentConfirmation: 'Packed 5 PCM today.' }, 2, {}, {}, true);
  assert.equal(natural.comparison, null);
});

test('vaccine language extraction preserves pairing and allocation rules', async () => {
  syncAllDistrictsToFacilities([
    { facility: 'Semantic Test Clinic', vaccine: 'BCG', allocation: 10, remaining: 10 },
    { facility: 'Semantic Test Clinic', vaccine: 'BCG Diluent', allocation: 10, remaining: 10 }
  ], 'unit test');
  const facility = getAllFacilities()[0];
  const aLine = 'Please provide 2 vials of BCG tomorrow.';
  const bLine = 'Please pack 2 vials of BCG for tomorrow.';
  const dLine = 'Please pack 1 vial of BCG Diluent for tomorrow.';
  const a = `Facility: ${facility.facilityName}\n${aLine}`, b = `Facility: ${facility.facilityName}\n${bLine}\n${dLine}`;
  const data = empty(); data.customerProducts = [product(aLine, 'BCG', 'BCG', '2 vials', 2)];
  data.fulfilmentProducts = [product(bLine, 'BCG', 'BCG', '2 vials', 2), product(dLine, 'BCG Diluent', 'BCG Diluent', '1 vial', 1)];
  const result = await analyzeAuditLanguage(a, b, 'vaccine', client(data, () => { throw new Error('Deterministic parser now handles this wording'); }), quiet);
  assert.equal(result.semanticAnalysis.status, 'skipped');
  const audit = validateVaccineOrder({ facilityId: facility.id, orderSource: 'whatsapp', whatsappMessage: result.customerRequest, fulfillmentConfirmation: result.fulfilmentConfirmation });
  assert.equal(audit.isValid, false); assert.match(audit.errors.join(' '), /pair|diluent|match/i);
});

test('Gemini cannot repair an explicit invalid vaccine quantity into a valid one', () => {
  const raw = 'BCG - -2'; const data = empty();
  // An extraction could point at the absolute quantity using a larger spaced fragment.
  data.fulfilmentProducts = [product(raw, 'BCG', 'BCG', '2', 2)];
  assert.equal(validateAuditSemantics(data, '', raw), null);
  assert.equal(approvedProductName(product('unknown vaccine - 5', 'unknown vaccine', 'BCG', '5', 5), 'vaccine'), 'unknown vaccine');
});

test('stock, missing, extra and excess results remain controlled by deterministic quantities', async () => {
  const a = headers + 'PCM - 5\nAmoxicillin - 3\nCetirizine - 2';
  const b = headers + 'PCM - 0\nAmoxicillin - 4\nIbuprofen - 1';
  const expected = runGeneralAuditor(a, b);
  const result = await runGeneralSemanticAudit(a, b, {}, {}, client(empty()));
  assert.deepEqual(result.items, expected.items);
  assert.equal(result.generalAudit.stockStatus, expected.generalAudit.stockStatus);
  assert.equal(result.issueCount, expected.issueCount);
});

test('Gemini unavailability still completes a parseable audit', async () => {
  const a = headers.replace('Kade', 'Fallback Rule') + 'PCM - 5';
  const b = a.replace('Isaac Awuyem', 'Evelyn Awuyem');
  const result = await runGeneralSemanticAudit(a, b, {}, {}, () => { throw new Error('unavailable'); });
  assert.equal(result.semanticAnalysis.status, 'fallback');
  assert.equal(result.generalAudit.orderer.status, 'mismatch');
  assert.equal(result.items[0].status, 'match');
});

test('semantic facility opinions cannot erase deterministic facility mismatches', async () => {
  const a = headers + 'PCM - 5', b = a.replace('Kade HC', 'Other HC');
  const data = empty(); data.facility = { customerRequest: { value: 'Kade HC', sourceText: 'Facility: Kade HC', confidence: 0.99 }, fulfilmentConfirmation: { value: 'Other HC', sourceText: 'Facility: Other HC', confidence: 0.99 }, equivalent: true, confidence: 0.99 };
  const result = await runGeneralSemanticAudit(a, b, {}, {}, client(data));
  assert.equal(result.generalAudit.facility.status, 'mismatch');
});

test('valid interpreted vaccine pairs pass and exceeding allocation remains blocked', async () => {
  syncAllDistrictsToFacilities([
    { facility: 'Semantic Pair Clinic', vaccine: 'BCG', allocation: 4, remaining: 4 },
    { facility: 'Semantic Pair Clinic', vaccine: 'BCG Diluent', allocation: 4, remaining: 4 }
  ], 'unit test');
  const facility = getAllFacilities()[0];
  for (const quantity of [2, 5]) {
    const vaccine = `Please pack ${quantity} vials of BCG tomorrow.`;
    const diluent = `Please pack ${quantity} vials of BCG Diluent tomorrow.`;
    const raw = `Facility: ${facility.facilityName}\n${vaccine}\n${diluent}`;
    const data = empty(); data.fulfilmentProducts = [product(vaccine, 'BCG', 'BCG', `${quantity} vials`, quantity), product(diluent, 'BCG Diluent', 'BCG Diluent', `${quantity} vials`, quantity)];
    const interpreted = await analyzeAuditLanguage('', raw, 'vaccine', client(data), quiet);
    const audit = validateVaccineOrder({ facilityId: facility.id, orderSource: 'fs_only', fulfillmentConfirmation: interpreted.fulfilmentConfirmation });
    assert.equal(audit.isValid, quantity === 2, audit.errors.join(' '));
    if (quantity === 5) assert.match(audit.errors.join(' '), /allocation|remaining|exceed/i);
  }
});

test('quota failure makes one semantic request and falls back without any background retry', async () => {
  const { geminiUsage } = await import('./geminiUsage');
  let calls = 0;
  const customer = headers.replace('Kade', 'Quota Fixture') + 'PCM - 5';
  const fulfilment = customer.replace('Isaac Awuyem', 'Evelyn Awuyem');
  const getClient = () => ({ models: { async generateContent(options: any) {
    calls++; assert.equal(geminiUsage.getStatus().status, 'processing');
    assert.equal(options.config.httpOptions.retryOptions.attempts, 1);
    throw Object.assign(new Error('quota exhausted'), { status: 429 });
  } } });
  const result = await runGeneralSemanticAudit(customer, fulfilment, {}, {}, getClient);
  assert.equal(calls, 1); assert.equal(result.semanticAnalysis.status, 'fallback');
  assert.equal(result.generalAudit.orderer.status, 'mismatch');
  assert.equal(geminiUsage.getStatus().status, 'quota_exceeded');
  for (let i = 0; i < 10; i++) geminiUsage.getStatus();
  assert.equal(calls, 1);
});

test('invalid semantic JSON marks actual usage Unavailable and preserves the fallback', async () => {
  const { geminiUsage } = await import('./geminiUsage');
  const result = await analyzeAuditLanguage('Please send 8 PCM today (invalid state fixture).', '', 'general', client({}), quiet);
  assert.equal(result.semanticAnalysis.status, 'fallback');
  assert.equal(geminiUsage.getStatus().status, 'unavailable');
});

test('general semantic rewrites preserve zero-fraction denominators for stock validation', () => {
  for (const denominator of ['5', '0', '2.5']) {
    const customer = 'Amoxicillin - 5';
    const fulfillment = `Amox [0/${denominator}]`;
    const data = empty();
    data.fulfilmentProducts = [product(fulfillment, 'Amox', 'Amoxicillin', `0/${denominator}`, 0)];
    assert.ok(validateAuditSemantics(data, customer, fulfillment));
    const interpreted = interpretAuditInputs(data, customer, fulfillment, 'general');
    assert.match(interpreted.fulfilmentConfirmation, new RegExp(`0/${denominator.replace('.', '\\.')}`));
    const result = runGeneralAuditor(interpreted.customerRequest, interpreted.fulfilmentConfirmation);
    assert.equal(result.items[0].status, denominator === '5' ? 'out of stock' : 'quantity mismatch');
  }
});

test('explicit General Auditor limit evidence survives semantic rewrites and numeric comparisons bypass AI', () => {
  const a = headers + 'Paracetamol - 10';
  const line = 'Paracetamol [5/10] (order limit applied)';
  const b = headers + line;
  assert.equal(needsAuditSemantics(a, b, 'general'), false);
  const data = empty();
  data.fulfilmentProducts = [product(line, 'Paracetamol', 'Paracetamol', '5/10', 5)];
  const interpreted = interpretAuditInputs(data, a, b, 'general');
  assert.match(interpreted.fulfilmentConfirmation, /5\/10 \(order limit applied\)/);
  const result = runGeneralAuditor(interpreted.customerRequest, interpreted.fulfilmentConfirmation);
  assert.equal(result.items[0].status, 'order limit applied');
  assert.equal(result.issueCount, 0);
});

test('shared semantic rewriting opts General Auditor fraction and limit preservation out of vaccine scope', () => {
  for (const quantityText of ['0/5', '3/5']) {
    const line = `BCG [${quantityText}] (order limit applied)`;
    const data = empty();
    data.fulfilmentProducts = [product(line, 'BCG', 'BCG', quantityText, Number(quantityText[0]))];
    const vaccine = interpretAuditInputs(data, '', line, 'vaccine');
    assert.equal(vaccine.fulfilmentConfirmation, `BCG - ${quantityText[0]}`);
    const general = interpretAuditInputs(data, '', line, 'general');
    assert.equal(general.fulfilmentConfirmation, `BCG - ${quantityText} (order limit applied)`);
  }
});
