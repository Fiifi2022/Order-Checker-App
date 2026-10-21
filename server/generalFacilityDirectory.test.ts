import { canAccess } from './auth';
import { normalizeGeneralFacilityName } from '../src/utils/generalFacility';
import assert from 'node:assert/strict';
import test from 'node:test';
import { activeGeneralFacilities, excludedGeneralFacilities, baseGeneralFacilities, changeGeneralFacilityDirectory, emptyGeneralFacilityDirectory, generalFacilityDirectoryHandlers } from './generalFacilityDirectory';
import { readGeneralFacilityContext } from './generalFacilityRecords';
import { runGeneralAuditor } from './generalAuditor';

const add = { name: 'New Test CHPS', district: 'Test District', region: 'Test Region', facilityType: 'CHPS' };

test('facility additions persist as separate entries and never invent official IDs or change the imported reference', () => {
  const before = JSON.stringify(baseGeneralFacilities);
  const saved = changeGeneralFacilityDirectory(emptyGeneralFacilityDirectory(), 'add', { revision: 1, ...add, id: 'untrusted', verifiedAliases: ['untrusted'] }, 'admin');
  assert.equal(saved.revision, 2);
  assert.equal(saved.updatedBy, 'admin');
  const entry = saved.added[0];
  assert.equal(entry.name, add.name);
  assert.equal(entry.id, undefined);
  assert.equal(entry.verifiedAliases, undefined);
  assert.equal(activeGeneralFacilities(saved).length, 1510);
  assert.equal(JSON.stringify(baseGeneralFacilities), before);
  const reloaded = JSON.parse(JSON.stringify(saved));
  assert.equal(activeGeneralFacilities(reloaded).at(-1).name, add.name);
});

test('removing imported or added records is durable and undo restores the same reference key', () => {
  let saved = changeGeneralFacilityDirectory(emptyGeneralFacilityDirectory(), 'add', { revision: 1, ...add }, 'admin');
  for (const entry of [baseGeneralFacilities[0], saved.added[0]]) {
    const key = entry.key;
    saved = changeGeneralFacilityDirectory(saved, 'remove', { revision: saved.revision, key }, 'admin');
    assert.ok(!activeGeneralFacilities(JSON.parse(JSON.stringify(saved))).some(record => record.key === key));
    assert.ok(excludedGeneralFacilities(saved).some(record => record.key === key));
    saved = changeGeneralFacilityDirectory(saved, 'restore', { revision: saved.revision, key }, 'admin');
    assert.ok(activeGeneralFacilities(saved).some(record => record.key === key));
  }
  const entry = saved.added[0];
  saved = changeGeneralFacilityDirectory(saved, 'remove', { revision: saved.revision, key: entry.key }, 'admin');
  saved = changeGeneralFacilityDirectory(saved, 'add', { revision: saved.revision, ...add }, 'admin');
  assert.equal(saved.added.length, 1);
  assert.equal(saved.added[0].key, entry.key);
  assert.ok(activeGeneralFacilities(saved).some(record => record.key === entry.key));
});

test('revision conflicts, duplicate names in the same location and invalid fields cannot silently alter the list', () => {
  const saved = changeGeneralFacilityDirectory(emptyGeneralFacilityDirectory(), 'add', { revision: 1, ...add }, 'admin');
  assert.throws(() => changeGeneralFacilityDirectory(saved, 'remove', { revision: 1, key: saved.added[0].key }, 'admin'), (error: any) => error.status === 409);
  assert.throws(() => changeGeneralFacilityDirectory(saved, 'add', { revision: 2, ...add, name: ' NEW TEST CHPS ' }, 'admin'), (error: any) => error.status === 409);
  assert.equal(changeGeneralFacilityDirectory(saved, 'add', { revision: 2, ...add, district: 'Another District' }, 'admin').added.length, 2);
  for (const input of [{ name: '' }, { name: '<bad>\nname' }, { name: 'Clinic', district: {} }, { name: 'x'.repeat(161) }]) {
    assert.throws(() => changeGeneralFacilityDirectory(saved, 'add', { revision: 2, ...input }, 'admin'), (error: any) => error.status === 400);
  }
  assert.throws(() => changeGeneralFacilityDirectory(saved, 'remove', { revision: 2, key: 'missing' }, 'admin'), (error: any) => error.status === 404);
});

test('removal affects General Auditor reference evidence and is not reintroduced by a matching Blueprint row', async () => {
  const entry = baseGeneralFacilities.find(record => record.name === 'Asaam HC')!;
  const state = changeGeneralFacilityDirectory(emptyGeneralFacilityDirectory(), 'remove', { revision: 1, key: entry.key }, 'admin');
  const sheets = [{ id: 'test', district: entry.district, region: entry.region, rows: [{ id: 'row', facility: 'Asaam Health Centre', vaccines: { BCG: { balance: 12 } } }] }];
  const before = JSON.stringify(sheets);
  const context = await readGeneralFacilityContext(async () => sheets, 2500, activeGeneralFacilities(state), excludedGeneralFacilities(state));
  assert.ok(!context.records.some(record => normalizeGeneralFacilityName(record.name) === normalizeGeneralFacilityName(entry.name)));
  assert.equal(JSON.stringify(sheets), before);
  const offline = await readGeneralFacilityContext(async () => { throw new Error('offline'); }, 2500, activeGeneralFacilities(state), excludedGeneralFacilities(state));
  assert.ok(!offline.records.some(record => record.name === entry.name));
  const added = changeGeneralFacilityDirectory(state, 'add', { revision: state.revision, ...add }, 'admin');
  const result = runGeneralAuditor('Orderer: Mary Mensah\nFacility: New Test CHPS\nORS - 5', 'Orderer: Mary Mensah\nFacility: New Test CHPS\nORS [5/5]', {}, { facilityContext: { records: activeGeneralFacilities(added) } });
  assert.equal(result.generalAudit.facility.verification, 'records');
  assert.equal(result.allMatch, true);
});

test('the facility API enforces existing roles, returns storage failures and uses committed revisions', async () => {
  let state = emptyGeneralFacilityDirectory(), writes = 0, offline = false;
  const handlers = generalFacilityDirectoryHandlers({ read: async () => { if (offline) throw new Error('offline'); return state; },
    change: async (action, input, actor) => { if (offline) throw new Error('offline'); writes++; state = changeGeneralFacilityDirectory(state, action, input, actor); return state; } });
  const invoke = async (handler: any, role: string, body: any = {}, roles?: string[]) => {
    let status = 200, data: any;
    await handler({ body }, { locals: { authUser: { id: 'actor', role, ...(roles ? { roles } : {}) } },
      setHeader() {}, status(value: number) { status = value; return this; }, json(value: any) { data = value; } });
    return { status, data };
  };
  assert.equal(canAccess('cca', 'GET', '/general/facilities'), true);
  assert.equal(canAccess('cca', 'POST', '/general/facilities'), false);
  assert.equal(canAccess('cca', 'DELETE', '/general/facilities'), false);
  for (const role of ['admin', 'warehouse', 'dco', 'auditor']) {
    assert.equal(canAccess(role, 'POST', '/general/facilities'), true);
    assert.equal(canAccess(role, 'DELETE', '/general/facilities'), true);
  }
  assert.equal((await invoke(handlers.list, 'cca')).data.canEdit, false);
  assert.equal((await invoke(handlers.save, 'cca', { revision: 1, ...add })).status, 403);
  assert.equal(writes, 0);
  for (const role of ['admin', 'warehouse', 'dco', 'auditor']) assert.equal((await invoke(handlers.list, role)).data.canEdit, true);
  const saved = await invoke(handlers.save, 'cca', { revision: 1, ...add }, ['cca', 'auditor']);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 2);
  assert.equal((await invoke(handlers.remove, 'auditor', { revision: 2, key: state.added[0].key })).data.facilities.length, 1509);
  offline = true;
  assert.equal((await invoke(handlers.list, 'admin')).status, 503);
  assert.equal((await invoke(handlers.save, 'admin', { revision: state.revision, ...add })).status, 503);
});
