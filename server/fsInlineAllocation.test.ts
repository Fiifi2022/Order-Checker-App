import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createFsAdapter } from '../extension/fs-adapter.js';
import { createInlineAllocation } from '../extension/inline-allocation.js';
import { lookupFsAllocation } from './fsAllocation';

test('Buzulungu and the icon-bearing BCG selection use Blueprint balance rather than FS stock or reservations', async () => {
  const { document, window } = parseHTML(await readFile(new URL('../extension/fixtures/fs-buzulungu-order.html', import.meta.url), 'utf8'));
  let shadow: any;
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function(options: any) { const result = attach.call(this, options); if (this.id === 'order-checker-vaccine-allocation') shadow = result; return result; };
  const adapter = createFsAdapter(document), indicator = createInlineAllocation(adapter, document);
  const sheets = [{ id: 'east-mamprusi', district: 'East Mamprusi', region: 'North East', month: 'October 2026', rows: [
    { id: 'buzulungu', facility: 'Buzulungu CHPS', vaccines: { BCG: { allocation: 150, distributed: 30, balance: 120 } } },
  ] }];
  const selection = adapter.read();
  const allocation = lookupFsAllocation(sheets, { facility: selection.facility, products: [selection.draft] });
  assert.equal(allocation.status, 'matched');
  assert.equal(allocation.products[0].canonical, 'BCG');
  indicator.render(selection, { allocation });
  assert.equal(shadow.querySelector('strong').textContent, 'Available: 120');
  assert.ok(indicator.host.parentElement.classList.contains('input-group'));
  assert.match(document.querySelector('.stock')!.textContent!, /230 in stock/);
  indicator.dispose();
});

test('selected FS facility and vaccine display their saved Blueprint balance and follow facility/product changes', async () => {
  const source = await readFile(new URL('../extension/fixtures/fs-react-select-order.html', import.meta.url), 'utf8');
  const { document, window } = parseHTML(source);
  let shadow: any;
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function(options: any) {
    const result = attach.call(this, options);
    if (this.id === 'order-checker-vaccine-allocation') shadow = result;
    return result;
  };
  const sheets = [{ id: 'sheet', district: 'Test', month: 'October 2026', rows: [
    { facility: 'Mumford Health Centre', fsFacilityId: 'FS-12', vaccines: { BCG: { allocation: 150, distributed: 30, balance: 120 }, OPV: { allocation: 60, distributed: 10, balance: 50 } } },
    { id: 'second', facility: 'Second Health Centre', fsFacilityId: 'FS-99', vaccines: { BCG: { allocation: 100, distributed: 12, balance: 88 }, OPV: { allocation: 40, distributed: 5, balance: 35 } } },
  ] }];
  const before = JSON.stringify(sheets);
  const adapter = createFsAdapter(document), indicator = createInlineAllocation(adapter, document);
  const refresh = () => {
    const selection = adapter.read();
    const allocation = lookupFsAllocation(sheets, { facility: selection.facility, products: [...selection.order, ...(selection.draft ? [selection.draft] : [])] });
    indicator.render(selection, { allocation });
  };
  refresh();
  assert.equal(shadow.querySelector('strong').textContent, 'Available: 120');
  assert.match(indicator.host.title, /Allocated: 150/);
  assert.ok(indicator.host.parentElement.classList.contains('input-group'));
  document.querySelector('.css-rendered-facility')!.textContent = 'Second HC';
  (document.querySelector('input[name="facility"]') as any).value = 'FS-99';
  indicator.render(adapter.read(), null);
  assert.equal(shadow.querySelector('strong').textContent, 'Checking allocation…');
  refresh();
  assert.equal(shadow.querySelector('strong').textContent, 'Available: 88');
  document.querySelector('.css-rendered-product')!.textContent = 'Oral Polio Vaccine (1&3)';
  (document.querySelector('input[name="sku"]') as any).value = 'SKU-OPV';
  refresh();
  assert.equal(shadow.querySelector('strong').textContent, 'Available: 35');
  sheets[0].rows[1].vaccines.OPV.balance = 25;
  refresh();
  assert.equal(shadow.querySelector('strong').textContent, 'Available: 25');
  sheets[0].rows[1].vaccines.OPV.balance = 35;
  assert.equal(JSON.stringify(sheets), before, 'advisory lookup never changes the Blueprint');
  indicator.dispose();
});
