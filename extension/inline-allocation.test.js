import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createFsAdapter } from './fs-adapter.js';
import { createInlineAllocation } from './inline-allocation.js';
import { readFile } from 'node:fs/promises';

test('Buzulungu screenshot reads readonly React Select values across separate facility and product cards', async () => {
  const { document } = parseHTML(await readFile(new URL('./fixtures/fs-buzulungu-order.html', import.meta.url), 'utf8'));
  const adapter = createFsAdapter(document);
  const selection = adapter.read();
  assert.equal(selection.facility.name, 'Buzulungu CHPS');
  assert.equal(selection.facility.district, 'East Mamprusi');
  assert.equal(selection.facility.region, 'North East');
  assert.equal(selection.draft?.name, 'Bacille Calmette–Guerin Vaccine');
  assert.equal(selection.draft?.quantity, '1');
  assert.equal(adapter.productPlacement()?.row.classList.contains('input-group'), true);
  document.querySelector('.products-card .css-1uccc91-singleValue').remove();
  document.querySelector('.products-card input[readonly]').removeAttribute('readonly');
  document.querySelector('.products-card input').value = 'BCG';
  assert.equal(adapter.read().draft, null, 'Search input, stock and reservations cannot establish selection');
});

test('screenshot markup reads React Select values and ignores CSS-hidden validation inputs', async () => {
  const { document } = parseHTML(await readFile(new URL('./fixtures/fs-react-select-order.html', import.meta.url), 'utf8'));
  const adapter = createFsAdapter(document);
  assert.equal(adapter.read().facility.name, 'Mumford HC');
  assert.equal(adapter.read().facility.id, 'FS-12');
  assert.deepEqual(adapter.read().draft, { id: 'SKU-BCG', name: 'BCG', quantity: '1' });
  assert.ok(adapter.productPlacement().group.classList.contains('flex-grow-1'));
  const indicator = createInlineAllocation(adapter, document);
  indicator.render(adapter.read(), { allocation: { status: 'matched', products: [{ isVaccine: true, balance: 120 }] } });
  assert.ok(indicator.host.previousElementSibling.classList.contains('flex-grow-1'));
  assert.ok(indicator.host.parentElement.classList.contains('input-group'));
  assert.equal(document.getElementById('product-group').firstElementChild.textContent, 'Product');
  assert.equal(indicator.host.style.display, 'block');
  assert.equal(document.querySelector('input[name="sku"]').value, 'SKU-BCG');
  const search = document.getElementById('react-select-product-input');
  search.readOnly = true;
  assert.equal(adapter.read().draft.name, 'BCG', 'Non-searchable React Select still reads the rendered selection');
  search.readOnly = false;
  const menu = document.createElement('div');
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = '<div role="option" aria-selected="false">OPV</div>';
  indicator.host.previousElementSibling.append(menu);
  indicator.render(adapter.read(), { allocation: { status: 'matched', products: [{ isVaccine: true, balance: 120 }] } });
  assert.ok(indicator.host.parentElement.classList.contains('input-group'), 'Opening the menu does not move the badge');
  document.querySelector('.css-rendered-product').remove();
  document.getElementById('react-select-product-input').value = 'OPV';
  assert.equal(adapter.read().draft, null, 'Search text and a stale validation SKU must not confirm a product');
  indicator.render(adapter.read(), null);
  assert.equal(indicator.host.style.display, 'none');
  indicator.dispose();
});

test('an undetected facility still mounts the badge and never displays an unverified balance', async () => {
  const source = await readFile(new URL('./fixtures/fs-react-select-order.html', import.meta.url), 'utf8');
  const { document } = parseHTML(source);
  document.querySelector('main > .form-group').remove();
  const adapter = createFsAdapter(document);
  assert.equal(adapter.diagnostics().facilityControl, false);
  assert.equal(adapter.diagnostics().formFound, true);
  assert.equal(adapter.read().draft.name, 'BCG');
  const indicator = createInlineAllocation(adapter, document);
  indicator.render(adapter.read(), { allocation: { status: 'no_facility', products: [] } });
  assert.equal(indicator.host.style.display, 'block');
  assert.ok(indicator.host.parentElement.classList.contains('input-group'));
  assert.match(indicator.host.title, /Unable to verify allocation/);
  assert.ok(!indicator.host.title.includes('Remaining allocation'));
  // A later facility mount must replace the entry-only fallback automatically.
  const facility = parseHTML(source).document.querySelector('main > .form-group');
  document.querySelector('main').prepend(facility);
  assert.equal(adapter.read().facility.name, 'Mumford HC');
  indicator.dispose();
});

const markup = `<html><head></head><body><main><h1>Add New Order</h1>
<div><label for="facility">Facility</label><input id="facility" role="combobox" readonly value="Yagaba HC" data-selected-id="FS-Y"></div>
<div id="entry" style="display:flex"><div class="form-group col" id="product-group" style="flex:1 0 400px">
<label class="form-label" for="sku-search">Product</label><div class="css-random-container"><div class="css-another-control"><div><div class="css-new-singleValue">BCG</div><input id="sku-search" role="combobox" aria-autocomplete="list" value="search"></div></div><input type="hidden" name="sku" value="SKU-BCG"></div></div>
<div class="form-group"><label for="qty">Quantity</label><input id="qty" name="quantity" type="number" value="1"></div><button id="add">Add</button><button id="reset">Reset</button></div>
</main></body></html>`;
function fixture() {
  const { document } = parseHTML(markup);
  let shadow;
  const attach = document.defaultView.Element.prototype.attachShadow;
  document.defaultView.Element.prototype.attachShadow = function(options) { const result = attach.call(this, options); if (this.id === 'order-checker-vaccine-allocation') shadow = result; return result; };
  const adapter = createFsAdapter(document), indicator = createInlineAllocation(adapter, document);
  const response = (balance, extra = {}) => ({ displaySettings: { lowThreshold: 10 }, allocation: {
    status: 'matched', facility: { facilityName: 'Yagaba Health Centre' }, refreshedAt: '2026-10-25T12:00:00Z',
    products: [{ balance, canonical: 'BCG', allocated: 150, carryOver: 0, distributed: 30, isVaccine: true, status: 'ok', ...extra }],
  } });
  return { document, adapter, indicator, response, badge: () => shadow.querySelector('div') };
}

test('badge follows the labelled Product group in the same flex row and reads selected React Select identity', () => {
  const { document, adapter, indicator, response, badge } = fixture();
  const product = document.getElementById('sku-search'), qty = document.getElementById('qty');
  assert.equal(adapter.read().draft.id, 'SKU-BCG');
  assert.equal(adapter.read().draft.name, 'BCG');
  indicator.render(adapter.read(), response(120));
  assert.equal(indicator.host.previousElementSibling.id, 'product-group');
  assert.equal(indicator.host.parentElement.id, 'entry');
  assert.ok(indicator.host.parentElement.classList.contains('ordercheck-allocation-row'));
  assert.equal(badge().textContent, 'Available: 120');
  assert.equal(badge().dataset.tone, 'available');
  assert.match(indicator.host.title, /Allocated: 150/);
  assert.match(indicator.host.title, /Distributed: 30/);
  assert.equal(document.getElementById('sku-search'), product);
  assert.equal(qty.value, '1');
  indicator.dispose();
});

test('quantity warnings, low threshold, exhaustion and unavailable states never edit the quantity', () => {
  const { document, adapter, indicator, response, badge } = fixture();
  const qty = document.getElementById('qty'); qty.value = '80';
  indicator.render(adapter.read(), response(50));
  assert.equal(badge().dataset.tone, 'danger');
  assert.match(indicator.host.title, /exceeds available allocation by 30/);
  qty.value = '5'; indicator.render(adapter.read(), response(50));
  assert.equal(badge().dataset.tone, 'available');
  assert.match(indicator.host.title, /Sufficient allocation/);
  indicator.render(adapter.read(), { ...response(50), displaySettings: { lowThreshold: 60 } });
  assert.equal(badge().dataset.tone, 'low');
  indicator.render(adapter.read(), response(0));
  assert.equal(badge().textContent, 'Available: 0');
  assert.equal(badge().dataset.tone, 'danger');
  indicator.render(adapter.read(), { error: 'Network disconnected' });
  assert.equal(badge().textContent, 'Allocation unavailable');
  assert.equal(badge().dataset.tone, 'unavailable');
  assert.equal(qty.value, '5');
  indicator.dispose();
});

test('clear, non-vaccines and missing records hide the badge; remount restores it once without altering labels', () => {
  const { document, adapter, indicator, response } = fixture();
  indicator.render(adapter.read(), response(120));
  indicator.render(adapter.read(), response(null, { status: 'untracked', message: 'No allocation found' }));
  assert.equal(indicator.host.style.display, 'none');
  assert.equal(document.getElementById('entry').classList.contains('ordercheck-allocation-row'), false);
  indicator.render(adapter.read(), response(null, { isVaccine: false }));
  assert.equal(indicator.host.style.display, 'none');
  document.querySelector('.css-new-singleValue').remove();
  assert.equal(adapter.read().draft, null); // typed search and hidden SKU alone are insufficient
  indicator.render(adapter.read(), response(120));
  assert.equal(indicator.host.style.display, 'none');
  document.getElementById('entry').outerHTML = parseHTML(markup).document.getElementById('entry').outerHTML;
  indicator.render(adapter.read(), response(120));
  indicator.render(adapter.read(), response(120));
  assert.equal(document.querySelectorAll('#order-checker-vaccine-allocation').length, 1);
  assert.equal(document.querySelector('label[for="sku-search"]').textContent, 'Product');
  assert.equal(indicator.host.previousElementSibling.id, 'product-group');
  indicator.dispose();
});

test('an empty or untracked product settles under a real MutationObserver without a render loop', async () => {
  for (const untracked of [false, true]) {
    const { document, adapter, indicator, response } = fixture();
    if (!untracked) document.querySelector('.css-new-singleValue').remove();
    let callbacks = 0;
    const observer = new document.defaultView.MutationObserver(records => {
      if (!records.some(record => record.target !== indicator.host && !indicator.host.contains(record.target))) return;
      callbacks++;
      if (callbacks >= 12) { observer.disconnect(); return; }
      indicator.render(adapter.read(), untracked ? response(null, { status: 'untracked' }) : null);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    indicator.render(adapter.read(), untracked ? response(null, { status: 'untracked' }) : null);
    await new Promise(resolve => setTimeout(resolve, 30));
    observer.disconnect();
    assert.ok(callbacks < 12, `Mutation feedback loop for ${untracked ? 'untracked' : 'empty'} product (${callbacks} callbacks)`);
    assert.equal(indicator.host.style.display, 'none');
    indicator.dispose();
  }
});

test('facility survives before product mounting and when the product form has a different root', () => {
  const { document } = parseHTML('<html><body><div class="facility-card"><div class="form-group"><label>Facility</label><div><div class="css-test-singleValue">Buzulungu CHPS</div><input readonly></div></div></div><section id="products"></section></body></html>');
  const adapter = createFsAdapter(document);
  assert.equal(adapter.read().facility.name, 'Buzulungu CHPS');
  assert.equal(adapter.diagnostics().formFound, true);
  document.getElementById('products').innerHTML = '<form><div class="form-row"><div><label>Product</label><input readonly value="BCG"></div><div><label>Quantity</label><input type="number" value="1"></div><button>Add</button></div></form>';
  assert.equal(adapter.read().facility.name, 'Buzulungu CHPS');
  assert.equal(adapter.read().draft.name, 'BCG');
  document.querySelector('.css-test-singleValue').textContent = 'Other CHPS';
  assert.equal(adapter.read().facility.name, 'Other CHPS');
  assert.equal(adapter.inspect().fields[0].selected, 'Other CHPS');
});

test('live FS label points to empty hidden facilityId; vaccine has no singleValue wrapper or SKU value', async () => {
  const { document } = parseHTML(await readFile(new URL('./fixtures/fs-live-selected-order.html', import.meta.url), 'utf8'));
  const adapter = createFsAdapter(document);
  assert.equal(adapter.read().facility.name, 'Buzulungu CHPS');
  assert.equal(adapter.read().facility.district, 'East Mamprusi');
  assert.equal(adapter.read().draft.name, 'Bacille Calmette-Guerin Vaccine');
  assert.equal(adapter.read().draft.quantity, '1');
  document.querySelector('.products-card .notranslate').remove();
  const menu = document.createElement('div');
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = '<div role="option"><div class="notranslate">Oral Polio Vaccine</div></div>';
  document.querySelector('.products-card .css-yk16xz-control').append(menu);
  document.querySelector('.products-card input[id^="react-select-"]').value = 'Oral Polio Vaccine';
  assert.equal(adapter.read().draft, null, 'Search and menu entries cannot confirm a vaccine');
  document.querySelector('.facility-card .css-1uccc91-singleValue').textContent = 'Other CHPS';
  assert.equal(adapter.read().facility.name, 'Other CHPS');
});
