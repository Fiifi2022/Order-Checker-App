import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createFsAdapter } from './fs-adapter.js';
import { cleanSelection } from './fs-state.js';
import { createFsScriptSync } from './fs-script.js';

function page(id = '87a0c173-8b2c-4964-aa05-788f5f3261c3') {
  const { document } = parseHTML(`<html><body><button>Add Order</button><main><h1>Add New Order</h1><input aria-label="Facility" readonly value="Gbangu CHPS">
  <section><h2>Package &amp; Script</h2><div><div id="${id}">Deliver BCG — 5 doses.<br>Confirm: “received”, please!<br><br>Keep cold.</div><button aria-label="Edit script" type="button">Edit icon</button></div><p>Unrelated packaging instructions</p></section>
  <section><h2>Private notes</h2><div id="private">Do not capture this.</div></section></main></body></html>`);
  return { document, adapter: createFsAdapter(document) };
}

test('extracts only the script anchored by Edit script, preserving line breaks and punctuation', () => {
  const { adapter } = page();
  const snapshot = adapter.read();
  assert.equal(snapshot.script.text, 'Deliver BCG — 5 doses.\nConfirm: “received”, please!\n\nKeep cold.');
  assert.equal(cleanSelection(snapshot).script.text, snapshot.script.text);
  assert.ok(!snapshot.script.text.includes('Edit icon'));
  assert.ok(!snapshot.script.text.includes('Private'));
});

test('script updates and arbitrary generated IDs are detected without hardcoded identifiers', () => {
  const { document, adapter } = page('a-completely-new-generated-id');
  const first = adapter.read().script;
  const script = document.getElementById('a-completely-new-generated-id');
  script.innerHTML = 'New script: 10 doses.<br>Second line.';
  script.id = 'another-uuid';
  assert.equal(adapter.read().script.text, 'New script: 10 doses.\nSecond line.');
  assert.equal(adapter.read().script.orderKey, first.orderKey);
});

test('new order clears the previous script until its DOM content is replaced or updated', () => {
  const { document, adapter } = page();
  const before = adapter.read().script;
  assert.equal(adapter.isNewOrder(document.querySelector('button')), true);
  adapter.resetOrder();
  assert.equal(adapter.read().script.text, null);
  assert.notEqual(adapter.read().script.orderKey, before.orderKey);
  assert.equal(adapter.read().script.text, null);
  const replacement = document.createElement('div'); replacement.id = 'new-order-script'; replacement.textContent = 'Next order script.';
  document.getElementById('87a0c173-8b2c-4964-aa05-788f5f3261c3').replaceWith(replacement);
  assert.equal(adapter.read().script.text, 'Next order script.');
  const main = document.querySelector('main'); main.remove();
  assert.equal(adapter.read().script.text, null);
});

test('replacement form creates a new order identity and missing/ambiguous scripts stay unavailable', () => {
  const { document, adapter } = page();
  const old = adapter.read().script;
  const clone = document.querySelector('main').cloneNode(true);
  document.querySelector('main').replaceWith(clone);
  assert.notEqual(adapter.read().script.orderKey, old.orderKey);
  const button = document.querySelector('button[aria-label="Edit script"]');
  button.parentElement.append(button.cloneNode(true));
  assert.equal(adapter.read().script.text, null);
});

test('script beside a wrapped edit action is supported; cards containing controls are excluded', () => {
  const { document, adapter } = page();
  const edit = document.querySelector('button[aria-label="Edit script"]');
  const wrapper = document.createElement('span'); edit.replaceWith(wrapper); wrapper.append(edit);
  assert.match(adapter.read().script.text, /Deliver BCG/);
  document.getElementById('87a0c173-8b2c-4964-aa05-788f5f3261c3').innerHTML = '<h3>Unrelated heading</h3><input value="Private information">';
  assert.equal(adapter.read().script.text, null);
});

test('automatic confirmation synchronization handles edits and order clearing without clearing unrelated manual input', () => {
  const field = { value: 'Manually entered confirmation' }, saved = [];
  let invalidations = 0;
  const sync = createFsScriptSync({ field, persist: text => saved.push(text), onChanged: () => invalidations++ });
  sync.apply(null);
  assert.equal(field.value, 'Manually entered confirmation');
  sync.apply({ orderKey: 'order-one', text: 'First line.\nSecond line!' });
  assert.equal(field.value, 'First line.\nSecond line!');
  sync.apply({ orderKey: 'order-one', text: 'First line.\nSecond line!' });
  assert.equal(invalidations, 1);
  sync.apply({ orderKey: 'order-one', text: 'Changed script.' });
  assert.equal(field.value, 'Changed script.');
  sync.apply({ orderKey: 'order-two', text: null });
  assert.equal(field.value, '');
  assert.equal(sync.observed, true, 'Saved text must not overwrite an observed new-order clear.');
  sync.apply({ orderKey: 'order-two', text: 'New order.' });
  sync.apply(null);
  assert.equal(field.value, '');
  assert.deepEqual(saved, ['First line.\nSecond line!', 'Changed script.', '', 'New order.', '']);
});

test('Package & Script sibling of a cached facility card is scoped to the shared React order screen', () => {
  const { document } = parseHTML('<html><body><div id="order"><div><input aria-label="Facility" readonly value="Gbangu CHPS"><dl><dt>District</dt><dd>East Mamprusi</dd><dt>Region</dt><dd>North East</dd></dl></div><section><h2>Package &amp; Script</h2><div id="generated">Exact script.<br>Next line.</div><button aria-label="Edit script">Edit</button></section></div><div>Unrelated page content</div></body></html>');
  assert.equal(createFsAdapter(document).read().script.text, 'Exact script.\nNext line.');
});

test('screenshot Packaging & Script active pane is read without facility/product controls', async () => {
  const { readFile } = await import('node:fs/promises');
  const { document } = parseHTML(await readFile(new URL('./fixtures/fs-packaging-script.html', import.meta.url), 'utf8'));
  const adapter = createFsAdapter(document);
  const script = adapter.read().script;
  assert.match(script.text, /^Thank you Kennedy Namanteng from Katiu CHPS/);
  assert.match(script.text, /1000mL\nFor further clarification/);
  assert.ok(!script.text.includes('Hidden order tracking'));
  assert.ok(!script.text.includes('Unrelated page'));
  adapter.resetOrder();
  assert.equal(adapter.read().script.text, null);
  document.querySelector('[id="79d85720-384f-4680-8906-0f335421a65a"]').textContent = 'New generated script.';
  assert.equal(adapter.read().script.text, 'New generated script.');
  document.getElementById('scripts-tabpane-0').setAttribute('aria-hidden', 'true');
  assert.equal(adapter.read().script.text, null);
});
