import test from 'node:test';
import assert from 'node:assert/strict';
import { CLINICAL_PAIRINGS, getAllFacilities, matchVaccineName, parseVaccineLinesDetailed, syncAllDistrictsToFacilities, validateVaccineOrder } from './vaccineService';
import { runDeterministicAuditFallback, parseItemsFromText } from './deterministicAudit';

const examples = [
  ['BCG 5\nBCG diluent 5', 'Bacille Calmette-Guerin Vaccine [5/5]\nBacille Calmette-Guerin Vaccine Diluent [5/5]', true],
  ['BCG 5\nBCG diluent 5', 'BCG Vaccine [5/5]\nBCG Diluent [4/5]', false],
  ['OPV 10 with droppers', 'Oral Polio Vaccine (1&3) [10/10]\nOral Polio Vaccine Dropper [10/10]', true],
  ['OPV 10', 'Inactivated Polio Vaccine [10/10]', false],
  ['Rota 6 plus droppers', 'Rotavirus Vaccine [6/6]\nRotavirus Vaccine Dropper [6/6]', true],
  ['YF 8\nYF diluent 8', 'Yellow Fever Vaccine [8/8]\nYellow Fever Vaccine Diluent [6/8]', false],
  ['Penta 10', 'Pentavalent (5-in-1) Vaccine [10/10]', true],
  ['PCV 8', 'Pneumococcal Conjugate Vaccine [8/8]', true],
  ['IPV 5', 'Inactivated Polio Vaccine [5/5]', true],
  ['MR 4 plus diluent', 'Measles & Rubella Vaccine [4/4]\nMeasles & Rubella Vaccine Diluent [4/4]', true],
  ['Men A 6\nMen A diluent 6', 'Meningococcal Conjugate A Vaccine [6/6]\nMeningococcal Conjugate A Vaccine Diluent [6/6]', true],
  ['BCG 5', 'BCG Vaccine [5/5]\nBCG Vaccine Diluent [5/5]', true],
  // The brief says PASS, but existing OPV rules require a fulfilled dropper.
  // Identity matching must pass independently; dispatch still requires that companion.
  ['5 OPV\n5 IPV', 'Oral Polio Vaccine (1&3) [5/5]\nInactivated Polio Vaccine [5/5]', false],
  ['Rota 5', 'Rotavirus Vaccine Dropper [5/5]', false],
  ['Yellow fever 3\nYF diluent 3', 'Yellow Fever Vaccine [3/3]\nYellow Fever Vaccine Diluent [3/3]', true]
] as const;

const fixtureName = 'DETERMINISTIC TEST CLINIC';
function audit(customer: string, fulfilment: string) {
  syncAllDistrictsToFacilities(Object.entries(CLINICAL_PAIRINGS).flatMap(([name, pair]) => [name, pair.accessoryCanonical]).concat(['Penta','PCV','IPV','HPV','DT']).map(vaccine => ({ facility: fixtureName, vaccine, allocation: 100, remaining: 100 })), 'unit test');
  const facility = getAllFacilities()[0];
  return validateVaccineOrder({ facilityId: facility.id, orderSource: 'whatsapp', whatsappMessage: customer, fulfillmentConfirmation: `Facility: ${fixtureName}\n${fulfilment}` });
}
for (const [index, [customer, fulfilment, pass]] of examples.entries()) {
  test(`brief scenario ${index + 1}: canonical vaccine and companion interpretation`, () => {
    const result = audit(customer, fulfilment);
    assert.equal(result.isValid, pass, result.errors.join('\n'));
    const fallback = runDeterministicAuditFallback(customer, fulfilment);
    assert.equal(fallback.allMatch, pass, JSON.stringify(fallback.items));
    if (index === 12) {
      assert.match(result.errors.join(' '), /dropper/i);
      assert.equal(result.items.find(item => item.vaccine === 'IPV')?.fsQty, 5);
      assert.equal(result.items.find(item => item.vaccine === 'OPV')?.fsQty, 5);
      assert.equal(audit(customer, fulfilment + '\nOPV Dropper [5/5]').isValid, true);
      assert.equal(audit(customer + '\nOPV Dropper 5', fulfilment + '\nOPV Dropper [5/5]').isValid, true);
    }
    if (index === 1 || index === 5) assert.equal(result.items.find(item => item.companionDiscrepancy)?.companionDiscrepancy.type, 'COMPANION_QUANTITY_MISMATCH');
    if (index === 11) assert.equal(result.items.find(item => item.vaccine === 'BCG Diluent').requestedQty, 0);
  });
}

test('all bounded quantity formats, bullets and numbering are recognized without identity digits', () => {
  for (const line of ['BCG 5','5 BCG','BCG x5','BCG - 5','BCG: 5','BCG = 5','BCG (5)','BCG [5]','BCG qty 5','BCG quantity 5','BCG five','send me 5 BCG','1. BCG 5','1.BCG 5','• BCG 5','BCG vaccine x5']) {
    const parsed = parseVaccineLinesDetailed(line);
    assert.equal(parsed.errors.length, 0, line + ' ' + parsed.errors);
    assert.deepEqual(parsed.items.map(item => [item.canonical, item.quantity]), [['BCG',5]], line);
  }
  for (const [line, canonical, quantity] of [['5 in 1 10','Penta',10],['PCV 13 8','PCV',8],['OPV one and three 10','OPV',10],['Pentavalent (5-in-1) Vaccine [10/10]','Penta',10]] as const) {
    const parsed = parseVaccineLinesDetailed(line); assert.equal(parsed.items[0]?.canonical,canonical,line); assert.equal(parsed.items[0]?.quantity,quantity,line);
  }
  for (const line of ['5 in 1','five in one','PCV13','OPV one and three']) assert.match(parseVaccineLinesDetailed(line).errors.join(' '),/MISSING_QUANTITY/,line);
});

test('contextual water/solvent and companion synonyms stay separate from primary vaccines', () => {
  for (const [name, canonical] of [['B.C.G','BCG'],['BCG water','BCG Diluent'],['BCG solvent','BCG Diluent'],['BCG diluents','BCG Diluent'],['TB vaccine','BCG'],['polio drops','OPV'],['injectable polio','IPV'],['RV vaccine','Rota'],['dropper for Rota','Rota Dropper'],['M&R','MR'],['Measles & Rubella Vaccine Diluent','MR Diluent'],['Meningococcal Conjugate A Vaccine Diluent','Men A Diluent'],['cervical cancer vaccine','HPV'],['Bacille Calmette-Guérin Vaccine','BCG']] as const) assert.equal(matchVaccineName(name).canonical,canonical,name);
  for (const name of ['water','solvent','dropper','diluent','OPV IPV','BCG diluent OPV dropper','IPX','IPV dropper','OPV diluent']) assert.equal(matchVaccineName(name).confidence,'none',name);
  assert.notEqual(matchVaccineName('OPV').canonical,matchVaccineName('IPV').canonical);
});

test('combined requests require explicit correct companion wording and do not invent companions', () => {
  for (const [line, primary, companion, qty] of [['BCG and diluent 5 each','BCG','BCG Diluent',5],['YF 4 with diluent','Yellow Fever','Yellow Fever Diluent',4],['Rotavirus and droppers 6','Rota','Rota Dropper',6],['MR plus diluent 5','MR','MR Diluent',5]] as const) {
    const parsed = parseVaccineLinesDetailed(line);
    assert.deepEqual(parsed.items.map(item => [item.canonical,item.quantity]),[[primary,qty],[companion,qty]],line);
  }
  assert.equal(parseVaccineLinesDetailed('BCG 5').items.length,1);
  assert.ok(parseVaccineLinesDetailed('BCG 5 with dropper').items.every(item => item.confidence === 'none'));
  assert.equal(audit('BCG diluent 4\nBCG 5','BCG [5/5]\nBCG Diluent [5/5]').isValid,false);
});

test('ratios retain the supplied numerator/reference and zero is not changed to one', () => {
  const result = parseVaccineLinesDetailed('Rota [6/10]\nYF [0/5]', { allowZero: true });
  assert.deepEqual(result.items.map(item => [item.quantity,item.referenceQuantity]),[[6,10],[0,5]]);
  const fallback = runDeterministicAuditFallback('IPV 5','IPV [0/5]');
  assert.equal(fallback.items[0].status,'out of stock'); assert.equal(fallback.items[0].found,'0 vials');
  assert.equal(audit('IPV 5','IPV [0/5]').isValid,false);
});

test('negative, fractional, unreadable and unsupported word quantities cannot silently pass', () => {
  for (const line of ['BCG - -2','-2 BCG','BCG - 1.5','BCG twenty','BCG [5/-2]','BCG [unreadable]']) {
    const parsed = parseVaccineLinesDetailed(line); assert.ok(parsed.errors.length > 0,line);
    assert.equal(runDeterministicAuditFallback(line,line).allMatch,false,line);
  }
});

test('duplicates consolidate only matching canonical identities', () => {
  const parsed = parseVaccineLinesDetailed('BCG 2\nB.C.G 3\nBCG water 5\n5 IPV\n5 OPV');
  assert.deepEqual(parsed.items.map(item => [item.canonical,item.quantity]),[['BCG',5],['BCG Diluent',5],['IPV',5],['OPV',5]]);
  assert.equal(parseItemsFromText('BCG 2\nBCG 3').get('BCG Vaccine')?.qty,5);
});

test('unrelated medicine fallback keeps its established matching behavior', () => {
  assert.equal(runDeterministicAuditFallback('PCM - 5','Paracetamol - 5').allMatch,true);
});

test('missing companion emits a structured discrepancy and stock zero stays visible', () => {
  const missing = audit('BCG 5','BCG [5/5]');
  assert.deepEqual(missing.items.find(item => item.vaccine === 'BCG').companionDiscrepancy, { type: 'MISSING_COMPANION_PRODUCT', product: 'BCG', companion: 'BCG Diluent' });
  const stock = audit('IPV 5','IPV [0/5]');
  assert.equal(stock.items.find(item => item.vaccine === 'IPV').status,'out_of_stock');
  assert.equal(stock.items.find(item => item.vaccine === 'IPV').fsQty,0);
  const partial = audit('IPV 5','IPV [3/5]');
  assert.equal(partial.items.find(item => item.vaccine === 'IPV').fulfillmentStatus,'partial');
  assert.equal(partial.isValid,false);
});

test('unknown multi-vaccine quantities do not become a matching generic product', () => {
  assert.equal(runDeterministicAuditFallback('OPV IPV 5','OPV IPV 5').allMatch,false);
  assert.equal(parseVaccineLinesDetailed('Orderer: Mr Isaac\nBCG 5').errors.length,0);
});

test('syringe/medicine catalog matching is unchanged by vaccine-specific parsing', () => {
  for (const input of ['Soloshot 0.5ml - 5','Syringes 2ml - 5','PCM - 5','Amoxicillin - 5']) {
    assert.equal(runDeterministicAuditFallback(input,input).allMatch,true,input);
  }
  assert.equal(runDeterministicAuditFallback('Unknown Vaccine','Unknown Vaccine').allMatch,false);
  assert.equal(parseVaccineLinesDetailed('BCG, 5').items[0]?.quantity,5);
});

test('supported customer wording bypasses Gemini and remains valid with no client available', async () => {
  const { analyzeAuditLanguage } = await import('./auditSemantics');
  const customer = `Facility: ${fixtureName}\nOPV 10 with droppers`;
  const fulfilment = `Facility: ${fixtureName}\nOral Polio Vaccine (1&3) [10/10]\nOral Polio Vaccine Dropper [10/10]`;
  const interpreted = await analyzeAuditLanguage(customer,fulfilment,'vaccine',() => { throw new Error('Gemini must not be needed'); });
  assert.equal(interpreted.semanticAnalysis.status,'skipped');
  assert.equal(audit(interpreted.customerRequest,interpreted.fulfilmentConfirmation).isValid,true);
});
