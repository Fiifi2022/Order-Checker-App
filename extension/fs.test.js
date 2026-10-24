import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { quantityStatus, confirmedAddition, cleanSelection, selectionProducts } from './fs-state.js';
const bcg = { id: 'bcg', name: 'Bacille Calmette-Guerin Vaccine', quantity: '5' };
test('valid, excess, equal, invalid and unknown quantity checks', () => {
 assert.equal(quantityStatus('5', 12), 'Within available allocation.');
 assert.equal(quantityStatus('12', 12), 'Within available allocation.');
 assert.match(quantityStatus('15', 12), /exceeds allocation/);
 for (const quantity of ['-1', 'x', '1.5', '0', 'Infinity']) assert.match(quantityStatus(quantity, 12), /Invalid quantity/);
 for (const balance of [null, undefined, NaN]) assert.match(quantityStatus('5', balance), /unavailable/);
 assert.match(quantityStatus('8', 12, 5), /Available: 7/);
});
test('Add requires exact product and requested quantity delta; failed Add and unrelated mutations cannot confirm it', () => {
 assert.equal(confirmedAddition([], [bcg], bcg), true);
 assert.equal(confirmedAddition([], [], bcg), false);
 assert.equal(confirmedAddition([], [{ ...bcg, name: 'OPV', id: 'opv' }], bcg), false);
 assert.equal(confirmedAddition([bcg], [bcg], bcg), false);
 assert.equal(confirmedAddition([bcg], [{ ...bcg, quantity: '10' }], bcg), true);
 assert.equal(confirmedAddition([], [{ ...bcg, quantity: '4' }], bcg), false);
 assert.equal(confirmedAddition([], [bcg], { ...bcg, quantity: '' }), false);
});
test('side panel order survives draft clearing; removal and facility switches clear corresponding context', () => {
 const selection = cleanSelection({ facility: { name: 'Mumford HC' }, draft: bcg, order: [] });
 assert.equal(selectionProducts(selection).length, 1);
 selection.order = [bcg]; selection.draft = null;
 assert.deepEqual(selectionProducts(selection), [bcg]);
 selection.order.push({ id: 'opv', name: 'OPV', quantity: '3' });
 assert.equal(selectionProducts(selection).length, 2);
 selection.order.splice(0, 1); assert.equal(selectionProducts(selection)[0].name, 'OPV');
 assert.deepEqual(cleanSelection({ facility: { name: 'Another HC' }, order: [] }).order, []);
});
test('permissions restrict FS injection and secrets stay out of content scripts', async () => {
 const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
 assert.equal(manifest.background.type, 'module'); assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
 const fs = manifest.content_scripts.find(s => s.js.includes('fs-content.js'));
 assert.deepEqual(fs.matches, ["https://fulfillment-gh1-production.platform.flyzipline.com/*", "https://fulfillment-gh2-production.platform.flyzipline.com/*", "https://fulfillment-gh3-production.platform.flyzipline.com/*"]);
 assert.ok(!manifest.host_permissions.some(host => host === 'https://*/*' || host === 'http://*/*'));
 assert.ok(manifest.host_permissions.includes('http://localhost:3000/*'));
 const content = await readFile(new URL('./fs-content.js', import.meta.url), 'utf8');
 assert.ok(!/getToken|authSession|\/commit|signInWithPassword/.test(content));
});

test('legacy downloaded config still enables both origins listed in the installed manifest', async () => {
 const { fsOrigins } = await import('./fs-origins.js');
 const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
 assert.deepEqual(fsOrigins({ fsOrigin: 'https://fulfillment-gh1-production.platform.flyzipline.com' }, manifest), [
  'https://fulfillment-gh1-production.platform.flyzipline.com', 'https://fulfillment-gh2-production.platform.flyzipline.com', 'https://fulfillment-gh3-production.platform.flyzipline.com']);
 assert.deepEqual(fsOrigins({ fsOrigins: ['https://unrelated.example'] }, manifest), [
  'https://fulfillment-gh1-production.platform.flyzipline.com', 'https://fulfillment-gh2-production.platform.flyzipline.com', 'https://fulfillment-gh3-production.platform.flyzipline.com']);
 assert.deepEqual(fsOrigins({}, { content_scripts: [{ js: ['fs-content.js'], matches: ['https://*/*'] }] }), []);
});
