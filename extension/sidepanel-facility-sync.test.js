import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { setupVaccine } from './sidepanel-vaccine.js';
import { createFsActivation } from './fs-activation.js';
const html = await readFile(new URL('./sidepanel.html', import.meta.url), 'utf8');

test('FS facility is visible before lookup, resolves by Blueprint source identity and follows changes safely', async () => {
 const { document } = parseHTML(html);
 const previous = { document: globalThis.document, chrome: globalThis.chrome };
 globalThis.document = document;
 globalThis.chrome = { storage: { local: { get: async (_key, callback) => { callback?.({}); return {}; }, set: async () => {} } } };
 let release, reads = 0;
 const pending = new Promise(resolve => { release = resolve; });
 try {
   const vaccine = setupVaccine({ request: async () => { reads++; return pending; } });
   const candidate = { facilityName: 'Buzulungu CHPS', district: 'East Mamprusi', sourceSheetId: 'east', sourceRowId: 'row2', allocationStatus: 'matched' };
   const first = vaccine.setFsFacility(candidate);
   assert.equal(document.getElementById('vxFacilityName').textContent, 'Buzulungu CHPS');
   assert.equal(document.getElementById('vxAudit').hidden, false);
   const second = vaccine.setFsFacility({ name: 'Another CHPS', allocationStatus: 'not_found' });
   assert.equal(document.getElementById('vxFacilityName').textContent, 'Another CHPS');
   release([{ id: 'real-audit-id', facilityName: 'Buzulungu CHPS', district: 'East Mamprusi Oct Allocation', sourceSheetId: 'east', sourceRowId: 'row2', cycle: 'September 2026' }]);
   await Promise.all([first, second]);
   assert.equal(reads, 1);
   assert.equal(document.getElementById('vxFacilityName').textContent, 'Another CHPS');
   assert.match(document.getElementById('vxFacilityMeta').textContent, /No unique Blueprint/);
   await vaccine.setFsFacility(candidate);
   assert.match(document.getElementById('vxFacilityMeta').textContent, /September 2026/);
   assert.ok(!document.getElementById('vxFacilityMeta').textContent.includes('No unique'));
   document.getElementById('vxResults').textContent = 'Existing audit';
   await vaccine.setFsFacility(candidate);
   assert.equal(document.getElementById('vxResults').textContent, 'Existing audit');
   await vaccine.setFsFacility(null);
   assert.equal(document.getElementById('vxPick').hidden, false);
 } finally { globalThis.document = previous.document; globalThis.chrome = previous.chrome; }
});

test('activation popup shows selected facility, reports failures, dismisses and cleans up', () => {
 const { document } = parseHTML('<html><body></body></html>');
 let shadow;
 const original = document.createElement.bind(document);
 document.createElement = (...args) => { const el = original(...args); const attach = el.attachShadow.bind(el); el.attachShadow = options => { shadow = attach(options); return shadow; }; return el; };
 const popup = createFsActivation(document, '2.3.21');
 popup.render({ facility: { name: 'Buzulungu CHPS' } }, { error: 'Sign in to OrderCheck' });
 assert.match(shadow.querySelector('section').textContent, /OrderCheck active · v2.3.21/);
 assert.match(shadow.querySelector('section').textContent, /Buzulungu CHPS/);
 assert.match(shadow.querySelector('section').textContent, /Sign in to OrderCheck/);
 shadow.querySelector('button').click();
 assert.equal(document.getElementById('ordercheck-active-status'), null);
 popup.dispose();
});
