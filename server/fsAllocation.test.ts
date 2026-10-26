import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupFsAllocation, activeFsFacilities } from './fsAllocation';
const sheet = { id: 'central', district: 'Gomoa West', region: 'Central', month: 'October 2026', rows: [{ id: 'mumford', facility: 'Mumford Health Centre', fsFacilityId: 'FS-12', vaccines: { BCG: { allocation: 20, carryOver: 2, distributed: 10, balance: 12 }, OPV: { allocation: 15, carryOver: 0, distributed: 2 }, 'BCG Diluent': { balance: 12 } } }] };
const select = (name = 'Bacille Calmette-Guerin Vaccine') => ({ facility: { name: 'Mumford HC', district: 'Gomoa West', region: 'Central' }, products: [{ name, quantity: '5' }] });
test('Mumford HC matches exactly with district and gets authoritative BCG balance plus required diluent', () => {
 const result = lookupFsAllocation([sheet], select());
 assert.equal(result.status, 'matched'); assert.equal(result.products[0].balance, 12); assert.equal(result.companions[0].name, 'BCG Diluent');
 assert.equal(result.products[0].allocated, 20); assert.equal(result.products[0].carryOver, 2); assert.equal(result.products[0].distributed, 10);
 assert.equal(result.products[0].isVaccine, true); assert.equal(result.companions[0].isVaccine, false);
 assert.equal(lookupFsAllocation([sheet], select('Oral Polio Vaccine (1&3)')).products[0].balance, 13);
});
test('FS vaccine labels resolve the Blueprint antigen columns and their saved remaining quantities', () => {
 const blueprint: any = structuredClone(sheet);
 blueprint.rows[0].vaccines = Object.fromEntries(['BCG', 'OPV', 'PENTA', 'PCV', 'ROTA', 'YF', 'IPV', 'TD'].map((name, index) => [name, { allocation: 100 + index, distributed: 10, balance: 90 + index }]));
 for (const [index, name] of ['Bacille Calmette-Guerin Vaccine', 'Oral Polio Vaccine (1&3)', 'Pentavalent Vaccine', 'Pneumococcal Conjugate Vaccine', 'Rotavirus Vaccine', 'Yellow Fever Vaccine', 'Inactivated Polio Vaccine', 'Tetanus Diphtheria Vaccine'].entries()) {
   const product = lookupFsAllocation([blueprint], select(name)).products[0];
   assert.equal(product.status, 'ok', name);
   assert.equal(product.balance, 90 + index, name);
   assert.equal(product.allocated, 100 + index, name);
 }
});
test('explicit FS IDs win; unrelated similar names never match', () => {
 assert.equal(lookupFsAllocation([sheet], { ...select(), facility: { id: 'FS-12', name: 'Different official label' } }).status, 'matched');
 assert.equal(lookupFsAllocation([sheet], { ...select(), facility: { name: 'Mumford Hospital' } }).status, 'not_found');
});
test('Buzulungu reporting-title district is verified with the directory without changing saved sheet metadata', () => {
 const blueprint: any = { id: 'east_mamprusi_oct_allocation', district: 'East Mamprusi Oct Allocation', month: 'September 2026', rows: [
   { id: 'buzulungu', facility: 'Buzulungu CHPS', vaccines: { BCG: { balance: 120 } } },
 ] };
 const selection = { facility: { name: 'Buzulungu CHPS', district: 'East Mamprusi', region: 'North East' }, products: [{ name: 'Bacille Calmette–Guerin Vaccine', quantity: '1' }] };
 const before = JSON.stringify(blueprint);
 const result = lookupFsAllocation([blueprint], selection);
 assert.equal(result.status, 'matched');
 assert.equal(result.facility.district, 'East Mamprusi');
 assert.equal(result.facility.region, 'North East');
 assert.equal(result.products[0].balance, 120);
 assert.equal(JSON.stringify(blueprint), before);
 assert.equal(lookupFsAllocation([blueprint, { ...blueprint, id: 'another-cycle' }], selection).status, 'ambiguous');
 for (const conflict of [
   { ...blueprint, district: 'West Mamprusi' },
   { ...blueprint, district: 'East Mamprusi West' },
   { ...blueprint, region: 'Northern' },
   { ...blueprint, rows: [{ ...blueprint.rows[0], district: 'West Mamprusi' }] },
 ]) assert.equal(lookupFsAllocation([conflict], selection).status, 'not_found');
});
test('read-only FS lookups include unique legacy Blueprint rows without creating row IDs', () => {
 const legacy: any = structuredClone(sheet);
 delete legacy.rows[0].id;
 const before = JSON.stringify(legacy);
 const result = lookupFsAllocation([legacy], select());
 assert.equal(result.status, 'matched');
 assert.equal(result.products[0].balance, 12);
 assert.equal(JSON.stringify(legacy), before);
 legacy.rows.push(structuredClone(legacy.rows[0]));
 const duplicate = lookupFsAllocation([legacy], select());
 assert.equal(duplicate.status, 'ambiguous');
 assert.equal(lookupFsAllocation([legacy], { ...select(), manualFacilityId: duplicate.candidates[0].id }).status, 'ambiguous');
});
test('duplicates require manual cycle selection, district and region resolve known duplicates', () => {
 const other = { ...sheet, id: 'other', region: 'Western', district: 'Another' };
 assert.equal(lookupFsAllocation([sheet, other], { ...select(), facility: { name: 'Mumford HC' } }).status, 'ambiguous');
 assert.equal(lookupFsAllocation([sheet, other], select()).facility.id, 'central:mumford');
 const duplicate = { ...sheet, id: 'next', month: 'November 2026' };
 assert.equal(lookupFsAllocation([sheet, duplicate], select()).status, 'ambiguous');
 assert.equal(lookupFsAllocation([sheet, duplicate], { ...select(), manualFacilityId: 'next:mumford' }).facility.cycle, 'November 2026');
 assert.equal(lookupFsAllocation([sheet], { ...select(), manualFacilityId: 'wrong' }).status, 'not_found');
});
test('inactive and archived rows excluded; missing allocation is never invented', () => {
 assert.equal(activeFsFacilities([{ ...sheet, active: false }]).length, 0);
 assert.equal(lookupFsAllocation([sheet], select('IPV')).products[0].status, 'untracked');
 assert.equal(lookupFsAllocation([sheet], select('IPV')).products[0].isVaccine, true);
 assert.equal(lookupFsAllocation([sheet], select('Amoxicillin')).products[0].isVaccine, false);
 const missing = structuredClone(sheet); missing.rows[0].vaccines.BCG = {} as any;
 assert.throws(() => lookupFsAllocation([missing], select()), /balance unavailable/);
 assert.equal(lookupFsAllocation([sheet], select('BCG antibiotic cream')).products[0].status, 'untracked');
});
test('presentation qualifiers do not collapse into a generic allocation', () => {
 for (const name of ['BCG Vaccine 0.5ml', 'PCV20', 'Td', 'Rotarix']) assert.equal(lookupFsAllocation([sheet], select(name)).products[0].balance, null);
});
test('only order products and their companions are returned; lookup has no mutation or deductions', () => {
 const before = JSON.stringify(sheet);
 const result = lookupFsAllocation([sheet], select());
 assert.deepEqual(result.products.map(p => p.canonical), ['BCG']);
 assert.equal(result.products.some(p => p.canonical === 'OPV'), false);
 assert.equal(JSON.stringify(sheet), before);
 assert.equal(lookupFsAllocation([sheet], { facility: {}, products: [] }).status, 'no_facility');
});

test('Gbangu CHPS resolves the active East Mamprusi Blueprint even before a vaccine is selected', () => {
 const gbangu = { id: 'north-east', district: 'East Mamprusi', region: 'North East', month: 'October 2026', rows: [{ id: 'gbangu', facility: 'Gbangu CHPS', vaccines: { BCG: { balance: 12 } } }] };
 const selection = { facility: { name: 'Gbangu CHPS', district: 'East Mamprusi', region: 'North East' }, products: [] };
 const before = JSON.stringify(gbangu);
 const result = lookupFsAllocation([gbangu], selection);
 assert.equal(result.status, 'matched');
 assert.equal(result.facility.id, 'north-east:gbangu');
 assert.equal(result.facility.district, 'East Mamprusi');
 assert.deepEqual(result.products, []);
 assert.equal(lookupFsAllocation([gbangu, { ...gbangu, id: 'duplicate' }], selection).status, 'ambiguous');
 assert.equal(lookupFsAllocation([gbangu], { ...selection, facility: { ...selection.facility, district: 'Other' } }).status, 'not_found');
 assert.equal(JSON.stringify(gbangu), before);
});
