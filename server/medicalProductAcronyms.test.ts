import assert from 'node:assert/strict';
import test from 'node:test';
import { medicalProductAcronyms, medicalProductAcronymReference, expandGeneralProductAcronyms } from '../src/utils/medicalProductAcronyms';
import { runGeneralAuditor } from './generalAuditor';
import { approvedProductName, analyzeAuditLanguage, type AuditSemantics, type SemanticProduct } from './auditSemantics';
import { readFileSync } from 'node:fs';

const semanticProduct = (name: string, normalizedName: string): SemanticProduct => ({ name, normalizedName, quantity: 2, quantityText: '2', sourceText: `${name} - 2`, confidence: 0.99 });
const headers = 'Facility: Acronym Reference HC\nOrderer: Isaac Awuyem\n';
const pair = () => ({ customerRequest: null, fulfilmentConfirmation: null, equivalent: false, confidence: 0 });
const empty = (): AuditSemantics => ({ facility: pair(), orderer: pair(), customerProducts: [], fulfilmentProducts: [], possibleMissingProducts: [], possibleExtraProducts: [], semanticWarnings: [] });
const quiet = { info() {}, warn() {} };

test('known medicine and blood aliases are accepted as identity expansions without Gemini', () => {
  for (const [left, right] of [
    ['APAP 500mg Tablet', 'Paracetamol 500mg Tablet'],
    ['Panadol 500mg Tab', 'Paracetamol 500mg Tablet'],
    ['Amoxil 250mg Capsule', 'Amoxicillin 250mg Capsule'],
    ['Oxy 10IU Injection', 'Oxytocin 10IU Injection'],
    ['Cipro 500mg Tablet', 'Ciprofloxacin 500mg Tablet'],
    ['NS 500ml', 'Normal Saline 500ml'],
    ['RL 500ml', 'Ringers Lactate 500ml'],
    ['D5W 500ml', 'Dextrose 5% in Water 500ml'],
    ['DHA-PPQ 20mg/160mg Tablet', 'Dihydroartemisinin/Piperaquine 20mg/160mg Tablet'],
    ['DTG 50mg Tablet', 'Dolutegravir 50mg Tablet'],
    ['ABC/3TC 120mg/60mg Tablet', 'Abacavir/Lamivudine 120mg/60mg Tablet'],
    ['TLD 300mg/300mg/50mg Tablet', 'Tenofovir Disoproxil Fumarate/Lamivudine/Dolutegravir 300mg/300mg/50mg Tablet'],
    ['WB O+', 'Whole Blood O positive'],
    ['PRBC AB-', 'Packed Red Blood Cells AB negative'],
    ['FFP A+', 'Fresh Frozen Plasma A Pos'],
    ['PLT B-', 'Platelets B Neg'],
    ['SDP A+', 'Single Donor Platelets A positive'],
    ['RDP AB+', 'Random Donor Platelets AB positive'],
    ['PRP', 'Platelet Rich Plasma'],
    ['CRYO', 'Cryoprecipitate']
  ]) {
    const result = runGeneralAuditor(`${left} - 2`, `${right} [2/2]`);
    assert.equal(result.items.length, 1, left);
    assert.equal(result.items[0].status, 'match', left);
    assert.equal(result.issueCount, 0, left);
    assert.equal(approvedProductName(semanticProduct(left, right), 'general'), right, left);
  }
});

test('medicine expansions cannot erase strength, formulation or combination differences', () => {
  for (const [left, right] of [
    ['APAP 500mg Tablet', 'Paracetamol 250mg Tablet'],
    ['Amox 250mg Capsule', 'Amoxicillin 250mg Syrup'],
    ['D5W 500ml', 'Dextrose 10% in Water 500ml'],
    ['NS 0.9% 500ml', 'Normal Saline 0.45% 500ml'],
    ['IFA', 'Folic Acid'],
    ['TDF', 'TAF'],
    ['DTG 50mg Tablet', 'Dolutegravir 10mg Dispersible Tablet'],
    ['ABC/3TC 120mg/60mg Tablet', 'Abacavir/Lamivudine 60mg/120mg Tablet'],
    ['TLD 300mg/300mg/50mg Tablet', 'Tenofovir Disoproxil Fumarate/Lamivudine/Dolutegravir 50mg/300mg/300mg Tablet'],
    ['AL 20mg/120mg Tablet', 'ASAQ 20mg/120mg Tablet']
  ]) {
    assert.equal(approvedProductName(semanticProduct(left, right), 'general'), left, left);
    assert.equal(runGeneralAuditor(`${left} - 2`, `${right} - 2`).allMatch, false, left);
  }
});

test('ABO and Rh variations match only for the same component and specifications', () => {
  for (const group of ['O', 'A', 'B', 'AB']) {
    for (const [sign, word] of [['+', 'positive'], ['-', 'negative']] as const) {
      const name = `PRBC ${group}${sign}`;
      const canonical = `Packed Red Blood Cells ${group} ${word}`;
      assert.equal(runGeneralAuditor(`${name} - 2`, `${canonical} - 2`).issueCount, 0);
    }
    const positive = `FFP ${group}+`, negative = `Fresh Frozen Plasma ${group}-`;
    assert.equal(runGeneralAuditor(`${positive} - 2`, `${negative} - 2`).allMatch, false);
    assert.equal(approvedProductName(semanticProduct(positive, negative), 'general'), positive);
  }
  for (const [left, right] of [
    ['PRBC A+', 'Packed Red Blood Cells B+'],
    ['FFP O+', 'Fresh Frozen Plasma AB+'],
    ['PRBC O+', 'Whole Blood O+'],
    ['SDP O+', 'RDP O+'],
    ['PLT O+', 'PRP O+'],
    ['PRBC O+', 'PRBC'],
    ['Irradiated PRBC O+', 'Packed Red Blood Cells O+'],
    ['Leukoreduced PRBC O+', 'Packed Red Blood Cells O+'],
    ['Washed PRBC O+', 'Packed Red Blood Cells O+']
  ]) {
    assert.equal(runGeneralAuditor(`${left} - 2`, `${right} - 2`).allMatch, false, left);
    assert.equal(approvedProductName(semanticProduct(left, right), 'general'), left, left);
  }
});

test('unfamiliar and context-dependent acronyms remain unguessed', () => {
  for (const [left, right] of [['PC', 'Platelets'], ['PC', 'Packed Cells'], ['AS', 'Artesunate'], ['CTX', 'Co-trimoxazole'], ['XYZ', 'Paracetamol']]) {
    assert.equal(expandGeneralProductAcronyms(left), left.toLowerCase());
    assert.equal(approvedProductName(semanticProduct(left, right), 'general'), left);
  }
  assert.equal(expandGeneralProductAcronyms('APAPEX'), 'apapex');
});

test('both audit prompt paths contain the same reference and ambiguity rules', () => {
  assert.ok(medicalProductAcronyms.length > 40);
  for (const term of ['APAP', 'IFA', 'DTG', '3TC', 'TLD', 'PRBC', 'FFP', 'CRYO', 'SDP', 'RDP']) assert.ok(medicalProductAcronymReference.includes(term), term);
  assert.match(medicalProductAcronymReference, /CONTEXT REQUIRED/);
  assert.match(medicalProductAcronymReference, /Never infer a missing blood group\/Rh/);
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /const SYSTEM_INSTRUCTIONS = `\s*\$\{medicalProductAcronymReference\}/);
});

test('Gemini receives the reference on a real General Auditor request and its expansion is audited', async () => {
  const aLine = 'Please send 2 APAP 500mg tablets today.', bLine = 'Packed 2 Paracetamol 500mg tablets today.';
  const customer = headers + aLine, fulfillment = headers + bLine;
  const data = empty();
  data.customerProducts = [{ ...semanticProduct('APAP 500mg tablets', 'Paracetamol 500mg tablets'), sourceText: aLine }];
  data.fulfilmentProducts = [{ ...semanticProduct('Paracetamol 500mg tablets', 'Paracetamol 500mg tablets'), sourceText: bLine }];
  let calls = 0;
  const interpreted = await analyzeAuditLanguage(customer, fulfillment, 'general', () => ({ models: { async generateContent(options: any) {
    calls++;
    assert.ok(options.config.systemInstruction.includes(medicalProductAcronymReference));
    assert.equal(options.config.httpOptions.retryOptions.attempts, 1);
    return { text: JSON.stringify(data) };
  } } }), quiet);
  assert.equal(calls, 1);
  assert.equal(interpreted.semanticAnalysis.status, 'used');
  const result = runGeneralAuditor(interpreted.customerRequest, interpreted.fulfilmentConfirmation);
  assert.equal(result.items[0].status, 'match');
  assert.equal(result.issueCount, 0);
});

test('vaccine semantic requests keep the existing prompt and identity rules', async () => {
  const fulfillment = 'Please pack 2 vials of BCG tomorrow (acronym scope fixture).';
  const data = empty();
  data.fulfilmentProducts = [{ ...semanticProduct('BCG', 'BCG'), sourceText: fulfillment, quantityText: '2 vials' }];
  let calls = 0;
  await analyzeAuditLanguage('', fulfillment, 'vaccine', () => ({ models: { async generateContent(options: any) {
    calls++;
    assert.equal(options.config.systemInstruction.includes(medicalProductAcronymReference), false);
    return { text: JSON.stringify(data) };
  } } }), quiet);
  assert.equal(calls, 1);
  for (const [left, right] of [['IPV', 'OPV'], ['BCG', 'BCG Diluent'], ['OPV', 'OPV Dropper']]) {
    assert.equal(approvedProductName(semanticProduct(left, right), 'vaccine'), left);
  }
});
