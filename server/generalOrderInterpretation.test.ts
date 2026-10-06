import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { interpretGeneralOrder, generalOrderInterpretationSchema, generalProductCatalog, generalProductAliases, generalInterpretationCacheTtlMs, type GeneralInterpretedProduct } from './generalOrderInterpretation';
import { selectGeneralSemanticContext } from './generalSemanticContext';
import { getAliases } from './vaccineService';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import Details from '../src/components/GeneralAuditDetails';

const headers = 'Facility: Interpretation CHPS\nOrderer: Isaac Awuyem\n';
const adult = 'Simple Linctus 125mg/5ml Syrup (Adult)';
const child = 'Simple Linctus 31.25mg/5ml Syrup (Paediatric)';
const pcm = 'Paracetamol 120mg/5ml Syrup';
const pair = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
const product = (originalText: string, canonicalProductName: string | null, quantityText: string | null, quantity: number | null, extras: Partial<GeneralInterpretedProduct> = {}): GeneralInterpretedProduct => ({
  status: 'RESOLVED', originalText, canonicalProductName, interpretedProduct: canonicalProductName,
  acronymDetected: null, acronymMeaning: null, synonymsDetected: [], brandNameDetected: null,
  genericName: null, dosage: null, formulation: null, strength: null, quantity, quantityText,
  unit: null, confidence: 0.98, reasoningNote: 'Catalog alias and explicit source quantity.', possibleMatches: [], ...extras
});
const data = (customerProducts: GeneralInterpretedProduct[], fulfilmentProducts: GeneralInterpretedProduct[] = []) => ({
  facility: pair(), orderer: pair(), customerProducts, fulfilmentProducts, semanticWarnings: []
});
const client = (value: unknown, onCall: (options: any) => void = () => {}) => () => ({ models: {
  async generateContent(options: any) { onCall(options); return { text: JSON.stringify(value) }; }
} });

test('approved ASV and ARV identities take precedence over model ambiguity and altered quantities', async () => {
  const customer = 'Facility: Alias Priority CHPS\nOrderer: Dr Isaac Awuyem\nASV - 2\nARV - 4\nThank you.';
  const fulfilment = 'Facility: Alias Priority CHPS\nOrderer: Isaac Awuyem\nAnti Snake Serum Injection [2/2]\nAnti Rabies Vaccine Injection [4/4]';
  let calls = 0;
  const result = await runGeneralSemanticAudit(customer, fulfilment, {}, {}, client(data([
    product('ASV - 2', null, null, null, { status: 'AMBIGUOUS_PRODUCT', confidence: 0.3 }),
    product('ARV - 4', 'Rabies Immunoglobulin', '400', 400)
  ], [
    product('Anti Snake Serum Injection [2/2]', null, null, null, { status: 'AMBIGUOUS_PRODUCT', confidence: 0.2 }),
    product('Anti Rabies Vaccine Injection [4/4]', 'Anti Rabies Vaccine Injection', '4/4', 4)
  ]), options => {
    calls++;
    const payload = JSON.parse(options.contents);
    assert.ok(payload.aliases.some((entry: any) => entry.canonicalId === 'ANTI_SNAKE' && entry.aliases.includes('ASV')));
    assert.ok(payload.aliases.some((entry: any) => entry.canonicalId === 'ANTI_RABIES_VACCINE' && entry.aliases.includes('ARV')));
  }));
  assert.equal(calls, 1);
  assert.equal(result.semanticAnalysis.status, 'used');
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
  assert.deepEqual(result.items.map(item => [item.name, item.requested, item.found, item.status]), [
    ['Anti Snake Serum Injection', '2', '2', 'match'],
    ['Anti Rabies Vaccine Injection', '4', '4', 'match']
  ]);
  assert.equal(result.issueCount, 0);
  assert.equal(result.confidence, 100);
});

test('rich interpretation precedes final validation, preserves quantities and cleans numbered titles', async () => {
  const a = '3. PCM syrup 120/5 - 15';
  const b = `${pcm} [15/15]`;
  let calls = 0;
  const result = await runGeneralSemanticAudit(headers + a, headers + b, {}, {}, client(data([
    product(a, pcm, '15', 15, { acronymDetected: 'PCM', acronymMeaning: 'Paracetamol' })
  ], [product(b, pcm, '15/15', 15)]), options => {
    calls++;
    assert.equal(options.config.responseSchema, generalOrderInterpretationSchema);
    const payload = JSON.parse(options.contents);
    assert.ok(payload.knownProductCatalog.includes(pcm));
    assert.ok(payload.aliases.some((entry: any) => entry.aliases.includes('PCM')));
  }));
  assert.equal(calls, 1);
  assert.equal(result.semanticAnalysis.status, 'used');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, pcm);
  assert.equal(result.items[0].status, 'match');
  assert.equal(result.confidence, 100);
  assert.equal(result.semanticAnalysis.interpretation?.customerProducts[0].confidence, 0.98);
});

test('natural quantity-before-name intent is normalized without supplying an invented strength', async () => {
  const a = 'give me 10 PCM syrup';
  const b = 'Paracetamol Syrup [10/10]';
  const result = await runGeneralSemanticAudit(headers + a, headers + b, {}, {}, client(data([
    product(a, 'Paracetamol Syrup', '10', 10)
  ], [product(b, 'Paracetamol Syrup', '10/10', 10)])));
  assert.equal(result.allMatch, true);
  assert.equal(result.items[0].name, 'Paracetamol Syrup');
  assert.equal(result.items[0].requested, '10');
});

test('adult and child intent produce exactly two informational stock cards', async () => {
  const a = '1. adult linctus - 5', c = '2. simple linctus child - 5';
  const b = `${adult} [0/1]`, d = `${child} [0/1]`;
  const result = await runGeneralSemanticAudit(headers + a + '\n' + c, headers + b + '\n' + d, {}, {}, client(data([
    product(a, adult, '5', 5), product(c, child, '5', 5)
  ], [product(b, adult, '0/1', 0), product(d, child, '0/1', 0)])));
  assert.equal(result.semanticAnalysis.status, 'used');
  assert.deepEqual(result.items.map(item => item.status), ['out of stock', 'out of stock']);
  assert.equal(result.issueCount, 0);
  assert.equal(result.confidence, 100);
});

test('ambiguity requires human review and survives client summary processing', async () => {
  const a = '4. cough syrup - 5';
  const b = `${adult} [5/5]`;
  const result = await runGeneralSemanticAudit(headers + a, headers + b, {}, {}, client(data([
    product(a, null, '5', 5, { status: 'AMBIGUOUS_PRODUCT', confidence: 0.54, possibleMatches: [adult, child] })
  ], [product(b, adult, '5/5', 5)])));
  assert.equal(result.allMatch, false);
  assert.equal(result.issueCount, 1);
  assert.equal(result.items.length, 0);
  assert.equal(result.generalAudit.semanticReviews?.length, 1);
  const inputs = { whatsappMessage: headers + a, fulfillmentConfirmation: headers + b };
  const accepted = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), { ...result, ...inputs });
  assert.equal(accepted.allMatch, false);
  assert.equal(accepted.issueCount, 1);
  const html = renderToStaticMarkup(createElement(Details, { details: result.generalAudit }));
  assert.match(html, /AMBIGUOUS PRODUCT/);
  assert.match(html, /Verify before dispatch/);
  assert.doesNotMatch(html, /4\. cough syrup/);
});

test('missing quantity is reviewed, and a concentration cannot become an order quantity', async () => {
  for (const [line, quantityText, quantity] of [['paracetamol syrup 120/5', null, null], ['need Paracetamol 500mg', '500', 500]] as const) {
    const result = await runGeneralSemanticAudit(headers + line, headers, {}, {}, client(data([product(line, pcm, quantityText, quantity)])));
    assert.equal(result.allMatch, false);
    assert.equal(result.generalAudit.semanticReviews?.length, 1);
    assert.equal(result.items.length, 0);
  }
});

test('clinically different identities and unsupported guesses cannot become matches', async () => {
  for (const [rawName, canonical] of [
    ['Simple Linctus 125mg/5ml Syrup (Adult)', child],
    ['Paracetamol 500mg Tablet', 'Paracetamol 500mg Syrup'],
    ['BCG Diluent', 'BCG'], ['OPV', 'IPV'],
    ['PRBC O positive', 'PRBC O negative'], ['Iron Folic Acid', 'Iron']
  ]) {
    const a = `need ${rawName} - 5`, b = `${canonical} [5/5]`;
    const result = await runGeneralSemanticAudit(headers + a, headers + b, {}, {}, client(data([product(a, canonical, '5', 5)], [product(b, canonical, '5/5', 5)])));
    assert.equal(result.allMatch, false, rawName);
    assert.ok((result.generalAudit.semanticReviews?.length || 0) >= 1, rawName);
  }
});

test('API failure and invalid JSON fall back, while repeated successful extraction is cached', async () => {
  for (const kind of ['429', 'timeout', 'unavailable', 'invalid JSON']) {
    // Unparsed surrounding wording still takes the semantic path. Explicit
    // product-only input now bypasses Gemini even without metadata.
    const a = `Unlisted ${kind} product - 5\nPlease verify.`;
    const b = `Unlisted ${kind} product [5/5]`;
    const result = await runGeneralSemanticAudit(a, b, {}, {}, () => ({ models: { async generateContent() {
      if (kind === 'invalid JSON') return { text: 'not JSON' };
      throw Object.assign(new Error(kind), { status: kind === '429' ? 429 : 503 });
    } } }));
    assert.equal(result.semanticAnalysis.status, 'fallback');
    assert.equal(result.allMatch, true);
  }
  const a = headers + 'need paracetamol syrup 15';
  const b = headers + 'Paracetamol Syrup [15/15]';
  let calls = 0;
  const getClient = client(data([product('need paracetamol syrup 15', 'Paracetamol Syrup', '15', 15)], [product('Paracetamol Syrup [15/15]', 'Paracetamol Syrup', '15/15', 15)]), () => { calls++; });
  const first = await interpretGeneralOrder(a, b, getClient);
  const second = await interpretGeneralOrder(a, b, getClient);
  assert.equal(first.semanticAnalysis.status, 'used');
  assert.equal(second.semanticAnalysis.status, 'used');
  assert.equal(calls, 1);
});

test('known exact aliases skip the API, and Gemini confidence cannot waive quantity or identity discrepancies', async () => {
  const a = headers + 'PCM - 7', b = headers + 'Paracetamol [7/7]';
  const skipped = await runGeneralSemanticAudit(a, b, {}, {}, () => { throw new Error('unnecessary API call'); });
  assert.equal(skipped.semanticAnalysis.status, 'skipped');
  assert.equal(skipped.allMatch, true);
  const raw = 'need paracetamol syrup 12';
  const fulfilled = 'Paracetamol Syrup [4/12]';
  const result = await runGeneralSemanticAudit(headers + raw, headers.replace('Isaac Awuyem', 'Evelyn Awuyem') + fulfilled, {}, {}, client(data([
    product(raw, 'Paracetamol Syrup', '12', 12, { confidence: 1 })
  ], [product(fulfilled, 'Paracetamol Syrup', '4/12', 4, { confidence: 1 })])));
  assert.equal(result.items[0].status, 'quantity mismatch');
  assert.equal(result.generalAudit.orderer.status, 'mismatch');
  assert.equal(result.issueCount, 2);
  assert.ok(result.confidence < 100);
});

test('omitted unparsed customer intent requires review and outage responses do not block a new API attempt', async () => {
  const omitted = await runGeneralSemanticAudit(headers + 'Please send cough medicine', headers, {}, {}, client(data([])));
  assert.equal(omitted.semanticAnalysis.status, 'used');
  assert.equal(omitted.allMatch, false);
  assert.equal(omitted.generalAudit.semanticReviews?.length, 1);
  const a = headers + 'need paracetmol syrup 9', b = headers + 'Paracetamol Syrup [9/9]';
  await interpretGeneralOrder(a, b, () => { throw new Error('temporary unavailable'); });
  let calls = 0;
  const retry = await interpretGeneralOrder(a, b, client(data([product('need paracetmol syrup 9', 'Paracetamol Syrup', '9', 9)], [product('Paracetamol Syrup [9/9]', 'Paracetamol Syrup', '9/9', 9)]), () => { calls++; }));
  assert.equal(calls, 1);
  assert.equal(retry.semanticAnalysis.status, 'used');
});

test('catalog context shrinks while retaining all variants, and vague or unknown intentions retain the full catalog', () => {
  const full = { knownProductCatalog: generalProductCatalog, aliases: generalProductAliases, supportedVaccineAliases: getAliases() };
  const context = selectGeneralSemanticContext(headers + 'need PCM syrup 13', headers + `${pcm} [13/13]`, generalProductCatalog, generalProductAliases, getAliases());
  assert.ok(JSON.stringify(context).length < JSON.stringify(full).length / 2);
  for (const name of generalProductCatalog.filter(name => /paracetamol/i.test(name))) assert.ok(context.knownProductCatalog.includes(name), name);
  assert.ok(context.aliases.some(entry => entry.aliases.includes('PCM')));
  for (const raw of ['cough syrup - 5', 'need Unknown New Medicine - 5']) {
    const withSource = [...generalProductCatalog, raw];
    const uncertain = selectGeneralSemanticContext(headers + raw, headers + `${adult} [5/5]`, withSource, generalProductAliases, getAliases(), generalProductCatalog);
    assert.deepEqual(uncertain.knownProductCatalog, withSource);
  }
});

test('successful interpretation survives the previous one-minute expiry and expires after 24 hours', async () => {
  const raw = 'Please supply 11 bottles of Paracetamol syrup today.';
  const fulfilled = 'Packed Paracetamol Syrup [11/11] for today.';
  const a = headers + raw, b = headers + fulfilled;
  let calls = 0;
  const getClient = client(data([product(raw, 'Paracetamol Syrup', '11', 11)], [product(fulfilled, 'Paracetamol Syrup', '11/11', 11)]), () => { calls++; });
  const now = Date.now;
  const start = now();
  try {
    await interpretGeneralOrder(a, b, getClient);
    Date.now = () => start + 2 * 60_000;
    await interpretGeneralOrder(a, b, getClient);
    assert.equal(calls, 1);
    Date.now = () => start + generalInterpretationCacheTtlMs + 1;
    await interpretGeneralOrder(a, b, getClient);
    assert.equal(calls, 2);
  } finally { Date.now = now; }
});

test('cached identity reuses new source quantities and still detects stock and fresh facility/orderer discrepancies', async () => {
  const raw = 'need adult linctus - 17', fulfilled = `${adult} [17/17]`;
  let calls = 0;
  await runGeneralSemanticAudit(headers + raw, headers + fulfilled, {}, {}, client(data([product(raw, adult, '17', 17)], [product(fulfilled, adult, '17/17', 17)]), () => { calls++; }));
  const getClient = () => { calls++; throw new Error('should use validated identity'); };
  const changed = await runGeneralSemanticAudit(headers + 'need adult linctus - 21', headers.replace('Interpretation CHPS', 'Different CHPS').replace('Isaac Awuyem', 'Other Orderer') + `${adult} [8/21]`, {}, {}, getClient);
  assert.equal(calls, 1);
  assert.equal(changed.semanticAnalysis.status, 'used');
  assert.equal(changed.items[0].requested, '21');
  assert.equal(changed.items[0].found, '8');
  assert.equal(changed.items[0].status, 'quantity mismatch');
  assert.equal(changed.issueCount, 3);
  const stock = await runGeneralSemanticAudit(headers + 'need adult linctus - 24', headers + `${adult} [0/1]`, {}, {}, getClient);
  assert.equal(calls, 1);
  assert.equal(stock.items[0].status, 'out of stock');
  assert.equal(stock.issueCount, 0);
  const unsafe = await interpretGeneralOrder(headers + 'need adult linctus 500mg - 24', headers + `${adult} [24/24]`, getClient);
  assert.equal(calls, 2);
  assert.equal(unsafe.semanticAnalysis.status, 'fallback');
});

test('quota exhaustion stops fresh General requests during cooldown, then allows another attempt', async () => {
  let calls = 0;
  const api = { models: { async generateContent() { calls++; throw Object.assign(new Error('quota exceeded'), { status: 429 }); } } };
  const getClient = () => api;
  const now = Date.now;
  const start = now();
  try {
    await interpretGeneralOrder(headers + 'please send unknown cooldown medicine - 1', headers, getClient);
    const cooled = await interpretGeneralOrder(headers + 'please send unknown cooldown medicine - 2', headers, getClient);
    assert.equal(calls, 1);
    assert.equal(cooled.semanticAnalysis.status, 'fallback');
    assert.match(cooled.semanticAnalysis.reason, /cooldown/);
    Date.now = () => start + 61_000;
    await interpretGeneralOrder(headers + 'please send unknown cooldown medicine - 3', headers, getClient);
    assert.equal(calls, 2);
  } finally { Date.now = now; }
});
