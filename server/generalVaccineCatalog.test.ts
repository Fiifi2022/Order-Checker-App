import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalog, defaultProducts, saveCatalogProduct } from './productCatalog';
import { runGeneralAuditor, normalizeGeneralProductName } from './generalAuditor';
import { runGeneralSemanticAudit } from './generalSemanticAudit';
import { createGeneralAuditRun, completeGeneralAuditRun } from '../src/utils/generalAuditRun';
import type { ProductCatalog } from '../shared/productCatalog';

const seed: ProductCatalog = { revision: 1, products: defaultProducts() };
const headers = 'Facility: Vaccine Catalog CHPS\nOrderer: Test User\n';
const audit = (customer: string, system: string) => runGeneralAuditor(headers + customer, headers + system);

test('vaccine catalog abbreviations, names and brands match full names without Gemini', async () => {
  applyCatalog(seed);
  for (const [alias, fullName] of [
    ['IPV vaccine', 'Inactivated Polio Vaccine'], ['injectable polio', 'Inactivated Polio Vaccine'],
    ['PCV 13', 'Pneumococcal Conjugate Vaccine'], ['pcv13', 'Pneumococcal Conjugate Vaccine'],
    ['Gardasil', 'Human Papillomavirus Vaccine'], ['Human Papilloma Virus vaccine', 'Human Papillomavirus Vaccine'],
    ['Gardasil (HPV)', 'Human Papillomavirus Vaccine'], ['HPV (Gardasil)', 'Human Papillomavirus Vaccine'],
    ['five-in-one vaccine', 'Pentavalent Vaccine'], ['dtp-hepb-hib', 'Pentavalent Vaccine'],
    ['R21', 'R21 vaccine'], ['Pfizer', 'COVID-19'],
    ['Diphtheria & Tetanus', 'Diphtheria-Tetanus Vaccine'],
  ]) {
    let calls = 0;
    const result = await runGeneralSemanticAudit(headers + `${alias} - 2`, headers + `${fullName} [2/2]`, {}, {}, () => {
      calls++; throw new Error('Catalog aliases should not require Gemini');
    });
    assert.equal(result.allMatch, true, alias + ': ' + result.generalAudit.discrepancies.join(' '));
    assert.equal(result.items.length, 1, alias);
    assert.equal(result.items[0].status, 'match', alias);
    assert.equal(calls, 0, alias);
  }
});
test('vaccine-only alias edits take effect after catalog reload and removal', () => {
  const original = seed.products.find(product => product.scope === 'vaccine' && product.name === 'IPV')!;
  const saved = saveCatalogProduct(seed, { ...original, revision: 1, aliases: [...original.aliases, 'IVPX'] }, 'admin@example.com');
  try {
    applyCatalog(JSON.parse(JSON.stringify(saved)));
    assert.equal(audit('IVPX - 2', 'Inactivated Polio Vaccine [2/2]').allMatch, true);
    assert.equal(audit('IVPX - 2', 'Inactivated Polio Vaccine [1/2]').allMatch, false);
    const edited = saved.products.find(product => product.id === original.id)!;
    applyCatalog(saveCatalogProduct(saved, { ...edited, revision: saved.revision, aliases: edited.aliases.filter(alias => alias !== 'IVPX') }, 'admin@example.com'));
    assert.notEqual(normalizeGeneralProductName('IVPX'), normalizeGeneralProductName('Inactivated Polio Vaccine'));
  } finally { applyCatalog(seed); }
});
test('new vaccine products, display names and Fulfilment System labels work in General', () => {
  const saved = saveCatalogProduct(seed, { revision: 1, scope: 'vaccine', name: 'Example Vaccine 100mcg', displayName: 'Example Vaccine Label', fulfillmentSystemName: 'Example Vaccine FS', category: 'vaccine', aliases: ['EV100'], contextualAliases: [], note: '' }, 'admin@example.com');
  try {
    applyCatalog(saved);
    const inputs = { whatsappMessage: headers + 'EV100 - 2', fulfillmentConfirmation: headers + 'Example Vaccine FS [2/2]' };
    const run = createGeneralAuditRun(inputs, 1);
    const result = completeGeneralAuditRun(run, {});
    assert.equal(result.allMatch, true);
    assert.equal(result.items.length, 1);
    assert.equal(audit('Example Vaccine Label - 2', 'Example Vaccine 100mcg [2/2]').allMatch, true);
    assert.equal(audit('EV100 - 2', 'Example Vaccine 200mcg [2/2]').allMatch, false);
  } finally { applyCatalog(seed); }
});
test('catalog vaccine aliases retain companion requirements and distinct identities', () => {
  applyCatalog(seed);
  assert.equal(audit('B.C.G - 2', 'Bacille Calmette-Guerin Vaccine [2/2]\nBCG Diluent [2/2]').allMatch, true);
  assert.equal(audit('B.C.G - 2', 'Bacille Calmette-Guerin Vaccine [2/2]').allMatch, false);
  for (const [left, right] of [['OPV', 'IPV'], ['TT', 'Td'], ['Td', 'DT vaccine'], ['IPV 5ml', 'Inactivated Polio Vaccine 10ml']]) {
    assert.notEqual(normalizeGeneralProductName(left), normalizeGeneralProductName(right));
  }
});
test('an overlapping vaccine alias cannot override a General catalog product or introduce vaccine rules', () => {
  const products = structuredClone(seed.products);
  products.push({ id: 'overlap-item', scope: 'general', name: 'Example Logistics Item', category: 'consumable', aliases: ['OpaqueOverlap'], contextualAliases: [], note: '' });
  products.find(product => product.scope === 'vaccine' && product.name === 'OPV')!.aliases.push('OpaqueOverlap');
  try {
    applyCatalog({ revision: 2, products });
    const result = audit('OpaqueOverlap - 2', 'Example Logistics Item [2/2]');
    assert.equal(result.allMatch, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, 'match');
    assert.notEqual(normalizeGeneralProductName('OpaqueOverlap'), normalizeGeneralProductName('OPV'));
  } finally { applyCatalog(seed); }
});
