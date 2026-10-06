import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runGeneralAuditor } from './generalAuditor';
import Subtitle from '../src/components/GeneralDiscrepancySubtitle';

const headers = 'Facility: Gbimsi CHPS\nOrderer: Isaac Awuyem\n';
const render = (discrepancies: string[]) => renderToStaticMarkup(createElement(Subtitle, { discrepancies }));

test('single identity errors show their actual names instead of the generic count subtitle', () => {
  for (const [system, expected] of [
    ['Facility: Gambaga Health Centre\nOrderer: Isaac Awuyem', 'Facility Name Mismatch'],
    ['Facility: Gbimsi CHPS\nOrderer: John Adams', 'Orderer Name Mismatch'],
    ['Facility: Gbimsi CHPS', 'Orderer Name Not Found'],
    ['Orderer: Isaac Awuyem', 'Facility Name Not Found']
  ]) {
    const result = runGeneralAuditor(headers + 'Paracetamol - 5', system + '\nParacetamol [5/5]');
    assert.equal(result.issueCount, 1);
    assert.equal(render(result.generalAudit.discrepancies), `<p class="text-xs text-slate-500 mt-1 sm:mt-0">${expected}</p>`);
  }
});

test('product error titles preserve dosage and exclude list markers and raw quantities', () => {
  const result = runGeneralAuditor(headers + '3.Paracetamol 500mg -5\n4)Amoxicillin 250mg -5', headers + 'Paracetamol 500mg [3/5]\nORS [5/5]');
  const html = render(result.generalAudit.discrepancies);
  assert.match(html, /Quantity Mismatch — Paracetamol 500mg/);
  assert.match(html, /Missing Product — Amoxicillin 250mg/);
  assert.match(html, /Extra Product — ORS/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /3\.Paracetamol|4\)|requested 5|entered 3|difference|discrepancies found/);
});

test('mixed audit renders every real error while omitting matched, stock, and confirmed-limit products', () => {
  const result = runGeneralAuditor(headers + 'Paracetamol - 5\nAmoxicillin - 5\nSimple Linctus - 5\nMultivitamin - 10\nGloves - 5',
    'Facility: Gambaga Health Centre\nOrderer: John Adams\nParacetamol [3/5]\nSimple Linctus [0/1]\nMultivitamin [5/10] (order limit applied)\nGloves [5/5]\nORS [5/5]');
  const snapshot = JSON.stringify(result);
  const html = render(result.generalAudit.discrepancies);
  assert.equal((html.match(/<li>/g) ?? []).length, result.issueCount);
  for (const error of ['Orderer Name Mismatch', 'Facility Name Mismatch', 'Quantity Mismatch — Paracetamol', 'Missing Product — Amoxicillin', 'Extra Product — ORS']) assert.ok(html.includes(error));
  assert.doesNotMatch(html, /Simple Linctus|Multivitamin|Gloves|out of stock|order limit applied/);
  assert.equal(JSON.stringify(result), snapshot);
  const stockOnly = runGeneralAuditor(headers + 'Simple Linctus - 5', headers + 'Simple Linctus [0/1]');
  assert.equal(render(stockOnly.generalAudit.discrepancies), '');
});

test('coded discrepancy titles also use the existing General product-name cleanup', () => {
  assert.match(render(['PRODUCT_MISMATCH: 3.Paracetamol 500mg - 5']), /Product Mismatch — Paracetamol 500mg<\/p>/);
});
