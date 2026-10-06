import assert from 'node:assert/strict';
import test from 'node:test';
import { generalMedicalTerminology, generalMedicalAbbreviations, getGeneralMedicalAmbiguity, resolveCanonicalProduct } from '../src/utils/generalMedicalTerminology';
import { normalizeGeneralProductName, runGeneralAuditor, parseGeneralProducts, compareGeneralProducts, summarizeGeneralProducts } from './generalAuditor';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { interpretGeneralOrder } from './generalOrderInterpretation';
import { getAliases, matchVaccineName } from './vaccineService';

const headers = 'Facility: Terminology CHPS\nOrderer: Isaac Awuyem\n';
const audit = (a: string, b: string) => runGeneralAuditor(headers + `${a} - 5`, headers + `${b} [5/5]`);

test('structured terminology covers supplied clinical categories and full abbreviation meanings', () => {
  assert.equal(generalMedicalTerminology.length, 146);
  for (const category of ['medicine', 'fluid', 'vaccine', 'rabies', 'antivenom', 'consumable', 'blood']) {
    assert.ok(generalMedicalTerminology.some(term => term.category === category), category);
  }
  for (const acronym of ['PCM', 'AL', 'ACT', 'ORS', 'ORT', 'RDT', 'MRDT', 'BCG', 'OPV', 'IPV', 'PCV', 'PENTA', 'ROTA', 'YF', 'MR', 'TT', 'TD', 'HPV', 'ARV', 'RIG', 'HRIG', 'ERIG', 'ASV', 'NS', 'RL', 'DNS', 'D5', 'D5W', 'D10', 'D50', 'MGSO4', 'CPM', 'EPI', 'PRBC', 'FFP', 'WB', 'IV', 'IM', 'SC', 'PO', 'INJ', 'TAB', 'CAP', 'SUSP', 'SOLN', 'INF']) assert.ok(generalMedicalAbbreviations[acronym], acronym);
  assert.match(generalMedicalAbbreviations.ARV, /antiretroviral/);
  assert.match(generalMedicalAbbreviations.ACT, /class/);
});

test('fallback expands medicines, brands, spelling variants, explicit forms and infusion identities', () => {
  for (const [a, b] of [
    ['Para syrup 120mg/5ml', 'Paracetamol 120mg/5ml Syrup'],
    ['Ibu 200mg tabs', 'Ibuprofen 200mg Tablet'], ['Voltaren 50mg', 'Diclofenac 50mg'],
    ['ASA 75mg tabs', 'Acetylsalicylic acid 75mg Tablet'],
    ['Amox-clav 500mg/125mg tabs', 'Amoxicillin clavulanate 500mg/125mg Tablet'],
    ['Rocephin 1g inj', 'Ceftriaxone 1g Injection'], ['ceftrixone 1g inj', 'Ceftriaxone 1g Injection'],
    ['Cotrim 960mg tabs', 'Trimethoprim sulfamethoxazole 960mg Tablet'],
    ['Flagyl infusion 500mg', 'Metronidazole Infusion 500mg'],
    ['NS drip 500ml', 'Sodium Chloride 0.9% Infusion 500ml'],
    ['Half NS drip 500ml', '0.45% saline Infusion 500ml'],
    ['RL drip 500ml', "Ringer's Lactate Infusion 500ml"],
    ['CPM 4mg tab', 'Chlorphenamine 4mg Tablet'], ['Epi inj 1mg', 'Adrenaline Injection 1mg'],
    ['Ventolin inhaler', 'Salbutamol Inhaler'], ['Buscopan 10mg tab', 'Hyoscine Butylbromide 10mg Tablet'],
    ['MgSO4 injection 50%', 'Magnesium Sulphate Injection 50%'],
    ['Multivit syrup', 'Multivitamin Syrup'], ['Branula', 'IV Cannula'],
    ['Giving set', 'IV Giving Set'], ['Benzathine pen', 'Benzathine Penicillin']
  ]) {
    const result = audit(a, b);
    assert.equal(result.allMatch, true, `${a}: ${JSON.stringify(result.generalAudit.discrepancies)}`);
    assert.equal(result.items.length, 1, a);
  }
});

test('full vaccine meanings and accessories match in General only, and zero ratios remain informational', () => {
  for (const [a, b] of [
    ['BCG', 'Bacille Calmette-Guerin Vaccine'], ['BCG water', 'BCG Vaccine Diluent'],
    ['Polio drops', 'Oral Polio Vaccine'], ['OPV pipette', 'Oral Polio Vaccine Dropper'],
    ['Polio injection', 'Inactivated Polio Vaccine'], ['Penta', 'Pentavalent Vaccine'],
    ['Rota pipette', 'Rotavirus Vaccine Dropper'], ['YF water', 'Yellow Fever Vaccine Diluent'],
    ['MR', 'Measles-Rubella Vaccine'], ['TT', 'Tetanus Toxoid'],
    ['Td', 'Tetanus-Diphtheria Vaccine'], ['DT vaccine', 'Diphtheria-Tetanus Vaccine'],
    ['Rabies inj', 'Anti Rabies Vaccine Injection'], ['HRIG', 'Human Rabies Immunoglobulin'],
    ['ERIG', 'Equine Rabies Immunoglobulin'], ['Polyvalent ASV', 'Polyvalent Snake Antivenom']
  ]) assert.equal(audit(a, b).allMatch, true, a);
  const stock = runGeneralAuditor(headers + 'Adult linctus - 5\nPaed linctus - 5', headers + 'Simple Linctus 125mg/5ml Syrup (Adult) [0/1]\nSimple Linctus 31.25mg/5ml Syrup (Paediatric) [0/1]');
  assert.equal(stock.items.length, 2);
  assert.deepEqual(stock.items.map(item => item.status), ['out of stock', 'out of stock']);
  assert.equal(stock.issueCount, 0);
});

test('clinical differences are preserved after alias expansion', () => {
  for (const [a, b] of [
    ['Para 500mg tab', 'Paracetamol 500mg Syrup'], ['Amox suspension', 'Amoxicillin Syrup'],
    ['Metro infusion', 'Metronidazole Injection'], ['Cipro PO', 'Ciprofloxacin IV'],
    ['Diclofenac sodium', 'Diclofenac potassium'], ['Adult linctus', 'Paed linctus'],
    ['D5W', 'D10'], ['NS drip', 'Half NS drip'], ['RL drip', 'Ringers Solution drip'],
    ['TT', 'Td'], ['Td', 'DT vaccine'], ['Measles Vaccine', 'Measles-Rubella Vaccine'],
    ['BCG Vaccine', 'BCG Diluent'], ['OPV', 'OPV Dropper'], ['Rota', 'Rota Dropper'],
    ['Rabies Vaccine', 'RIG'], ['HRIG', 'ERIG'], ['Polyvalent ASV', 'Monovalent ASV'],
    ['Regular Insulin', 'NPH Insulin'], ['Examination gloves', 'Surgical gloves'],
    ['WB O+', 'PRBC O+'], ['HIV RDT', 'Malaria RDT']
  ]) assert.equal(audit(a, b).allMatch, false, `${a} / ${b}`);
  assert.equal(normalizeGeneralProductName('HIV RDT'), normalizeGeneralProductName('HIV Rapid Diagnostic Test'));
});

test('broad or conflicting meanings require review even when Gemini is unavailable', async () => {
  for (const name of ['drip', 'antibiotic', 'painkiller', 'cough syrup', 'malaria medicine', 'injection', 'vaccine', 'serum', 'tablet', 'IV fluid', 'INF', 'IV', 'SOLN', 'Cef', 'HC', 'Magnesium', 'Iron', 'Ringers', 'Deworming tablet', 'Insulin']) {
    assert.ok(getGeneralMedicalAmbiguity(name), name);
    const result = await runGeneralSemanticAudit(headers + `${name} - 5`, headers + `${name} [5/5]`, {}, {}, () => { throw new Error('offline'); });
    assert.equal(result.allMatch, false, name);
    assert.equal(result.generalAudit.semanticReviews?.length, 1, name);
    assert.equal(result.items.length, 0, name);
  }
});

test('Gemini receives relevant full meanings without promoting terminology to stocked catalog entries', async () => {
  const raw = 'please send ARV 2 for rabies';
  let called = false;
  await interpretGeneralOrder(headers + raw, headers, () => ({ models: { async generateContent(options: any) {
    called = true;
    const payload = JSON.parse(options.contents);
    assert.match(payload.abbreviationMeanings.ARV, /Anti Rabies Vaccine/);
    assert.match(payload.abbreviationMeanings.ARV, /antiretroviral/);
    assert.ok(payload.aliases.some((term: any) => term.name === 'Anti Rabies Vaccine Injection'));
    assert.equal(payload.knownProductCatalog.includes('Human Rabies Immunoglobulin'), false);
    assert.match(options.config.systemInstruction, /terminology, not proof/);
    throw new Error('offline');
  } } }));
  assert.equal(called, true);
});

test('shared Vaccine Checker inventory aliases are unchanged', () => {
  const aliases = getAliases();
  assert.ok(aliases.DT.includes('tt'));
  assert.equal(matchVaccineName('TT').canonical, 'DT');
  assert.equal(matchVaccineName('Td').canonical, 'DT');
  assert.equal(matchVaccineName('BCG water').canonical, 'BCG Diluent');
  assert.equal(matchVaccineName('OPV dropper').canonical, 'OPV Dropper');
});

test('recognized acronyms, common names and repeated identity labels get one green card without Gemini', async () => {
  for (const [request, fulfilled] of [
    ['PCM', 'Paracetamol'], ['Panadol 500mg tabs', 'Paracetamol 500mg Tablet'],
    ['Amox', 'Amoxicillin'], ['Flagyl', 'Metronidazole'], ['Ventolin', 'Salbutamol'],
    ['ORS', 'Oral Rehydration Salts'], ['FFP AB+', 'Fresh Frozen Plasma AB+'],
    ['Paracetamol (PCM) 500mg tablets', 'Panadol 500mg tabs'],
    ['Paracetamol 500mg Tablet (Panadol)', 'PCM 500mg tab'],
    ['PCM (Paracetamol)', 'Paracetamol'],
    ['Oral Polio Vaccine (OPV)', 'OPV'],
    ['Packed Red Blood Cells (PRBC) O+', 'PRBC O+']
  ]) {
    const result = await runGeneralSemanticAudit(headers + `${request} - 5`, headers + `${fulfilled} [5/5]`, {}, {},
      () => { throw new Error('Known aliases must not need an API call'); });
    assert.equal(result.allMatch, true, `${request}: ${JSON.stringify(result.generalAudit.discrepancies)}`);
    assert.equal(result.issueCount, 0, request);
    assert.equal(result.items.length, 1, request);
    assert.equal(result.items[0].status, 'match', request);
    assert.equal(result.semanticAnalysis.status, 'skipped', request);
  }
});

test('alias green matches still require quantities, identities and clinical qualifiers to agree', () => {
  for (const [request, fulfilled] of [
    ['Paracetamol (PCM) 500mg Tablet', 'Paracetamol 250mg Tablet'],
    ['Paracetamol (PCM) Syrup', 'Paracetamol Tablet'],
    ['Paracetamol (UnknownCode)', 'Paracetamol'],
    ['Paracetamol (Ibuprofen)', 'Paracetamol'],
    ['Whole Blood (WB) O+', 'WB O-']
  ]) assert.equal(audit(request, fulfilled).allMatch, false, request);
  const quantity = runGeneralAuditor(headers + 'Panadol - 5', headers + 'PCM [4/5]');
  assert.equal(quantity.items.length, 1);
  assert.equal(quantity.items[0].status, 'quantity mismatch');
  const identity = runGeneralAuditor(headers + 'Panadol - 5', 'Facility: Different CHPS\nOrderer: Different Person\nPCM [5/5]');
  assert.equal(identity.generalAudit.facility.status, 'mismatch');
  assert.equal(identity.generalAudit.orderer.status, 'mismatch');
});

test('approved ASV and ARV catalogue identities pair before missing and extra checks', async () => {
  for (const alias of ['ASV', 'ASV inj', 'Anti Snake Serum', 'Anti Snake Venom', 'Snake Venom Antiserum', 'Snake Venom Antiserum Injection', 'Snake Antivenom', 'Antivenom', 'Snake Serum', 'Snake Venom Serum', 'Anti snake', 'Anti snake vaccine']) {
    assert.equal(getGeneralMedicalAmbiguity(alias), null, alias);
    const result = await runGeneralSemanticAudit(headers + `${alias} - 2`, headers + 'Anti Snake Serum Injection [2/2]', {}, {},
      () => { throw new Error('Approved aliases should bypass Gemini'); });
    assert.equal(result.allMatch, true, `${alias}: ${JSON.stringify(result.generalAudit.discrepancies)}`);
    assert.equal(result.items.length, 1, alias);
    assert.equal(result.items[0].name, 'Anti Snake Serum Injection');
    assert.equal(result.items[0].status, 'match');
    assert.equal(result.confidence, 100);
    assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
    assert.equal(result.semanticAnalysis.status, 'skipped');
    assert.match(result.items[0].fulfillment.key, /^ANTI_SNAKE\|/);
  }
  for (const alias of ['ARV', 'ARV vaccine', 'ARV inj', 'Anti rabies', 'Rabies vaccine', 'Anti-rabies injection', 'Rabies shot']) {
    assert.equal(getGeneralMedicalAmbiguity(alias), null, alias);
    const result = audit(alias, 'Anti Rabies Vaccine Injection');
    assert.equal(result.allMatch, true, alias);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, 'Anti Rabies Vaccine Injection');
    assert.equal(result.confidence, 100);
    assert.match(result.items[0].fulfillment.key, /^ANTI_RABIES_VACCINE\|/);
  }
  assert.equal(audit('ASV', 'Snake Venom Antiserum').allMatch, true);
  const together = runGeneralAuditor(headers + 'ASV - 2\nARV - 4', headers + 'Anti snake vaccine [2/2]\nAnti rabies vaccine [4/4]');
  assert.deepEqual(together.items.map(item => item.name), ['Anti snake vaccine', 'Anti rabies vaccine']);
  assert.deepEqual(together.items.map(item => item.status), ['match', 'match']);
  assert.equal(together.issueCount, 0);
  assert.equal(together.confidence, 100);
});

test('approved local aliases preserve stock, aggregation and clinically meaningful differences', () => {
  const stock = runGeneralAuditor(headers + 'ASV - 2\nARV - 4', headers + 'Snake Venom Antiserum [0/2]\nRabies vaccine [0/1]');
  assert.deepEqual(stock.items.map(item => item.status), ['out of stock', 'out of stock']);
  assert.equal(stock.issueCount, 0);
  const combined = runGeneralAuditor(headers + 'ASV - 1\nSnake Serum - 1', headers + 'Anti Snake Serum Injection [2/2]');
  assert.equal(combined.items.length, 1);
  assert.equal(combined.allMatch, true);
  const partial = runGeneralAuditor(headers + 'ARV - 4', headers + 'Rabies vaccine [3/4]');
  assert.equal(partial.items.length, 1);
  assert.equal(partial.items[0].status, 'quantity mismatch');
  for (const [a, b] of [
    ['ARV', 'Rabies Immunoglobulin'], ['ARV', 'HRIG'], ['ASV', 'Polyvalent Snake Antivenom'],
    ['Monovalent ASV', 'Polyvalent ASV'], ['ASV 10ml', 'Snake Antivenom 20ml'],
    ['ARV IM', 'Rabies Vaccine SC'], ['ARV', 'Rabies Vaccine Diluent'],
    ['OPV', 'OPV Dropper'], ['Rota', 'Rota Dropper'], ['BCG', 'BCG Diluent'], ['YF', 'YF Diluent']
  ]) assert.equal(audit(a, b).allMatch, false, `${a} / ${b}`);
});

test('exact reported order uses identical canonical IDs on both sides without Gemini', async () => {
  const customer = 'ASV - 5\nARV - 5';
  const fulfilment = 'Anti snake vaccine [5/5]\nAnti rabies vaccine [5/5]';
  const expected = ['ANTI_SNAKE', 'ANTI_RABIES_VACCINE'];
  assert.deepEqual(parseGeneralProducts(customer, 'customer_request').map(product => product.canonicalId), expected);
  assert.deepEqual(parseGeneralProducts(fulfilment, 'fulfillment_confirmation').map(product => product.canonicalId), expected);
  for (const [name, id] of [['ASV', 'ANTI_SNAKE'], ['Anti snake vaccine', 'ANTI_SNAKE'], ['ARV', 'ANTI_RABIES_VACCINE'], ['Anti rabies vaccine', 'ANTI_RABIES_VACCINE']]) {
    assert.equal(resolveCanonicalProduct(name)?.canonicalId, id);
  }
  const result = await runGeneralSemanticAudit(customer, fulfilment, {}, {}, () => {
    assert.fail('Explicit matching aliases must not contact Gemini, including without headers');
  });
  assert.deepEqual(result.items.map(item => [item.name, item.requested, item.found, item.status]), [
    ['Anti snake vaccine', '5', '5', 'match'], ['Anti rabies vaccine', '5', '5', 'match']
  ]);
  assert.equal(result.semanticAnalysis.status, 'skipped');
  assert.equal(result.issueCount, 0);
  assert.equal(result.allMatch, true);
  assert.equal(result.confidence, 100);
});

test('render boundary repairs older engine ambiguity/extra rows using current canonical pairs', () => {
  const inputs = { whatsappMessage: headers + 'ASV - 5\nARV - 5', fulfillmentConfirmation: headers + 'Anti snake vaccine [5/5]\nAnti rabies vaccine [5/5]' };
  const good = runGeneralAuditor(inputs.whatsappMessage, inputs.fulfillmentConfirmation);
  const extras = compareGeneralProducts(headers, inputs.fulfillmentConfirmation);
  const wrong = { ...good, ...summarizeGeneralProducts(extras, good.generalAudit.facility, good.generalAudit.orderer,
    good.generalAudit.phone, 2, 2, [
      { originalText: 'ASV - 5', source: 'customer_request', possibleMatches: [], reason: 'Old ambiguous alias' },
      { originalText: 'ARV - 5', source: 'customer_request', possibleMatches: [], reason: 'Old ambiguous alias' }
    ]) };
  assert.equal(wrong.issueCount, 4);
  const result = completeGeneralAuditRun(createGeneralAuditRun(inputs, 1, {}, {}, true), {
    ...wrong, ...inputs, auditEngine: 'general-deterministic-v1'
  });
  assert.deepEqual(result.items.map(item => [item.name, item.status]), [
    ['Anti snake vaccine', 'match'], ['Anti rabies vaccine', 'match']
  ]);
  assert.equal(result.generalAudit.semanticReviews?.length || 0, 0);
  assert.equal(result.issueCount, 0);
  assert.equal(result.confidence, 100);
  assert.equal(result.allMatch, true);
  const mismatchInputs = { ...inputs, fulfillmentConfirmation: 'Facility: Different CHPS\nOrderer: Different Person\nAnti snake vaccine [4/5]\nAnti rabies vaccine [5/5]' };
  const mismatch = completeGeneralAuditRun(createGeneralAuditRun(mismatchInputs, 2, {}, {}, true), {
    ...wrong, ...mismatchInputs, auditEngine: 'general-deterministic-v1'
  });
  assert.equal(mismatch.items.find(item => item.name === 'Anti snake vaccine')?.status, 'quantity mismatch');
  assert.equal(mismatch.generalAudit.facility.status, 'mismatch');
  assert.equal(mismatch.generalAudit.orderer.status, 'mismatch');
  assert.equal(mismatch.allMatch, false);
});
