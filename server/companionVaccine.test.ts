import {createAuditStorage} from './auditStorage';
import { canManageCatalog } from '../shared/productCatalog';
import { assignedRoles } from '../shared/roles';
import { defaultProducts, applyCatalog } from './productCatalog';
import { runGeneralProductNameAudit } from './generalProductNameAudit';
import { generalInputFingerprint } from '../shared/generalAuditFingerprint';
import { restoreGeneralProductConfirmations } from '../src/utils/generalProductConfirmationPersistence';
import { auditReadBudget, auditRemainingMs, auditSignal, auditTiming } from './auditBudget';
import { AUDIT_AI_FALLBACK_MS, AUDIT_BACKGROUND_WAIT_MS, auditTimeoutSetting } from '../shared/auditPerformance';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { companionVaccineHandlers, companionOrderId } from './companionVaccine';
import { createAuthentication } from './auth';
import * as service from './vaccineService';
import { normalizeCompanionAuditMode } from '../shared/companionAudit';
import { resolveBlueprintFacility, normalizeFacilityName, assertBlueprintActive } from './blueprintFacility';
import { resolveCompanionFacility, companionFacilityErrors, CompanionFacilityError } from './companionFacility';
import { runGeneralAuditor } from './generalAuditor';
import { learnVerifiedCatalogueAliases, changeCatalogueAlias } from './catalogAliasLearning';
import { readGeneralFacilityContext } from './generalFacilityRecords';
import { createHash } from 'node:crypto';
import { emptyGeneralFacilityDirectory, activeGeneralFacilities, excludedGeneralFacilities } from './generalFacilityDirectory';

function fixture(facilityContext?: () => Promise<any>) {
  service.clearAllAllocations({ clearHistory: true });
  const row = { id: 'row', facility: 'Example Health Centre', vaccines: {
    BCG: { allocation: 20, balance: 20, distributed: 0 }, OPV: { allocation: 15, balance: 15, distributed: 0 },
    Rota: { allocation: 10, balance: 10, distributed: 0 }, IPV: { allocation: 20, balance: 20, distributed: 0 }
  } };
  const sheet = { id: 'isolated-test-sheet', district: 'Test', month: 'October 2026', products: Object.keys(row.vaccines), rows: [row] };
  const records = new Map<string, any>([['vaccine_districts/' + sheet.id, structuredClone(sheet)]]);
  let readFailure = false, writeFailure = false, loseResponse = false, writes = 0;
  let queue = Promise.resolve();
  const storage = {
    async write(path:string,value:any){if(writeFailure)throw Object.assign(new Error('isolated write failure'),{code:14});records.set(path,structuredClone(value));},
    db: {}, doc: (_db: any, collection: string, id: string) => `${collection}/${id}`,
    async runTransaction(_db: any, callback: any) {
      const previous = queue; let unlock!: () => void; queue = new Promise(resolve => { unlock = resolve; }); await previous;
      try {
        const staged = new Map<string, any>();
        const result = await callback({
          async get(path: string) {
            if (readFailure) throw new Error('isolated read failure');
            return { exists: () => records.has(path), data: () => structuredClone(records.get(path)) };
          },
          set(path: string, value: any) { staged.set(path, structuredClone(value)); }
        });
        if (writeFailure && staged.size) throw new Error('isolated write failure');
        for (const [key, value] of staged) { records.set(key, value); writes++; }
        if (loseResponse && staged.has('vaccine_allocations/' + service.getAllFacilities()[0].id)) { loseResponse = false; throw new Error('connection lost after commit'); }
        return result;
      } finally { unlock(); }
    },
    clean: (data: any) => JSON.parse(JSON.stringify(data)),
    productKey: (vaccines: any, name: string) => Object.keys(vaccines).find(key => service.matchVaccineName(key).canonical === service.matchVaccineName(name).canonical) || name,
    progress: () => 'in_progress', debug: () => {}
  };
  const refresh = async () => {
    if (readFailure) throw new Error('read unavailable');
    const current = records.get('vaccine_districts/' + sheet.id);
    service.syncAllDistrictsToFacilities(current.rows.flatMap((r: any) => Object.entries(r.vaccines).map(([vaccine, value]: any) => ({
      sourceSheetId: sheet.id, sourceRowId: r.id, facility: r.facility, district: sheet.district, cycle: sheet.month,
      vaccine, allocation: value.allocation, remaining: value.balance, taken: value.distributed
    }))), 'isolated tests');
  };
  const handlers = companionVaccineHandlers({ refresh, facilityContext, storage: () => storage,
    verifyFacility: facility => { const target = resolveBlueprintFacility([records.get('vaccine_districts/' + sheet.id)], {
      facilityName: facility.facilityName, sheetId: facility.sourceSheetId, rowId: facility.sourceRowId, district: facility.district, cycle: facility.cycle }); assertBlueprintActive(target.sheet, target.row); },
    publish: committed => service.publishConfirmedVaccineOrder(committed.result.updatedFacility!, committed.result.transaction!) });
  async function invoke(name: 'verify' | 'commit' | 'status', body: any, owner = 'cca', profile: any = {}) {
    let status = 200, value: any;
    await handlers[name]({ body, params: { orderId: body.orderId } } as any, {
      locals: { authUser: { id: owner, name: 'Test CCA', role: 'cca', ...profile } },
      status(code: number) { status = code; return this; }, json(data: any) { value = data; return this; }
    } as any, () => {});
    return { status, body: value };
  }
  const fs = 'Facility: Example Health Centre\nBCG Vaccine [5/5]\nBCG Diluent [5/5]\nOPV [3/3]\nOPV Dropper [3/3]\nRotavirus Vaccine [4/4]\nRota Dropper [4/4]';
  const ready = async (extra: any = {}) => {
    try { await refresh(); } catch { /* The handler must report the failed read. */ }
    return invoke('verify', { auditMode: 'fulfillment_only', facilityId: service.getAllFacilities()[0]?.id, fulfillmentConfirmation: fs, ...extra });
  };
  const commit = (audit: any, extra = {}, owner = 'cca') => invoke('commit', { facilityId: audit.facilityId, orderId: audit.orderId, authorized: true, ...extra }, owner);
  return { records, storage, refresh, handlers, invoke, fs, ready, commit,
    balance: (name: string) => records.get('vaccine_districts/' + sheet.id).rows[0].vaccines[name].balance,
    get writes() { return writes; }, setReadFailure(value: boolean) { readFailure = value; }, setWriteFailure(value: boolean) { writeFailure = value; }, loseNextCommitResponse() { loseResponse = true; } };
}

function verifyRoute(app: ReturnType<typeof fixture>) {
  const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const begin = source.indexOf("app.post('/api/verify'");
  const end = source.indexOf("app.post('/api/scan-screenshot'", begin);
  let handler: any;
  const catalogSeed={revision:1,products:defaultProducts()};
  const catalogReference={key:'product_catalog/current',collection:(name:string)=>({doc:(id:string)=>`product_catalog/current/${name}/${id}`})};
  const runAdminTransaction=async(callback:any)=>{
    const staged=new Map<string,any>();
    const result=await callback({get:async(ref:any)=>({exists:app.records.has(ref.key||ref),data:()=>app.records.get(ref.key||ref)}),set:(ref:any,value:any)=>staged.set(ref.key||ref,value)});
    for(const [key,value] of staged)app.records.set(key,value);
    return result;
  };
  const context = vm.createContext({
    app: { post(_path: string, callback: any) { handler = callback; } },
    console: { log() {}, error() {}, warn() {} }, normalizeCompanionAuditMode, companionVaccine: app.handlers,
    vaccineService: service, resolveCompanionFacility, companionFacilityErrors, CompanionFacilityError,
    resolveBlueprintFacility, blueprintDistricts: {},
    async loadDistrictsFromFirestore() { await app.refresh(); context.blueprintDistricts = { test: app.records.get('vaccine_districts/isolated-test-sheet') }; },
    runGeneralProductNameAudit, canManageCatalog, assignedRoles,
    learnVerifiedCatalogueAliases,runAdminTransaction,catalogReference,catalogSeed,applyCatalog,
    readProductCatalog:{invalidate(){}},
    async queueCatalogueAliasSuggestions(suggestions:any[],actor:string) {
      let catalog=app.records.get(catalogReference.key)||catalogSeed;
      for(const suggestion of suggestions)catalog=changeCatalogueAlias(catalog,{action:'propose',text:suggestion.alias,...suggestion},actor,true).catalog;
      app.records.set(catalogReference.key,catalog);return catalog;
    },
    async readCurrentBlueprintSheets() { return [...app.records.entries()].filter(([path]) => path.startsWith('vaccine_districts/')).map(([path, value]) => ({ ...value, id: path.split('/')[1] })); },
    async readManagedGeneralDirectory() { return emptyGeneralFacilityDirectory(); }, activeGeneralFacilities, excludedGeneralFacilities,
    auditReadBudget, auditRemainingMs, auditSignal, auditTiming, auditTimeoutSetting, process: { env: {} }, AUDIT_AI_FALLBACK_MS, AUDIT_BACKGROUND_WAIT_MS,
    readGeneralFacilityContext, collection(_db: unknown, name: string) { return name; },
    async getDocs(name: string) { return { docs: [...app.records.entries()].filter(([path]) => path.startsWith(name + '/')).map(([path, value]) => ({ id: path.slice(name.length + 1), data: () => value })) }; },
    getGeminiClient() { throw new Error('No external AI allowed in this test'); }, osuItems: [], audits: [], createHash, generalInputFingerprint, restoreGeneralProductConfirmations, setTimeout, clearTimeout,
    auditStorage:createAuditStorage(async(id,record)=>{await app.storage.write('audits/'+id,app.storage.clean(record));}),
    cleanFirestorePayload: app.storage.clean, getFirestoreDb() { return {}; }, doc: app.storage.doc,
    async setDoc(path: string, value: any) { app.records.set(path, value); }
  });
  vm.runInContext(ts.transpile(source.slice(begin, end)), context);
  return async (body: any) => {
    let status = 200, result: any;
    await handler({ body, headers: {} }, { locals: { auditCatalog: app.records.get(catalogReference.key)||catalogSeed, authUser: { id: 'cca', name: 'Test CCA', role: 'cca' } },
      status(code: number) { status = code; return this; }, json(value: any) { result = value; return this; } });
    return { status, body: result };
  };
}

test('WhatsApp mode alias reuses vaccine validation and returns the common extension response', async () => {
  const app = fixture();
  const audit = await app.ready({ auditMode: 'whatsapp_and_fulfillment', whatsappMessage: 'Facility: Example HC\nBCG 5\nOPV 3\nRota 4' });
  assert.equal(audit.status, 200, JSON.stringify(audit.body)); assert.equal(audit.body.allMatch, true);
  assert.equal(audit.body.auditMode, 'whatsapp_and_fulfillment'); assert.equal(audit.body.auditId, audit.body.orderId);
  assert.equal(audit.body.facilityName, 'Example Health Centre'); assert.ok(audit.body.items.length);
  assert.ok(audit.body.items.every((item: any) => item.name && typeof item.requested === 'string' && typeof item.found === 'string'));
  assert.equal(app.balance('OPV'), 15);
  const previousSpelling = await app.ready({ auditMode: 'customer_fulfillment', whatsappMessage: 'Facility: Example HC\nBCG 5\nOPV 3\nRota 4' });
  assert.equal(previousSpelling.body.allMatch, true);
});

test('unscoped General Auditor compares catalogue names and quantities; Vaccine Checker retains allocation checks', async () => {
  const app = fixture(); await app.refresh(); const route = verifyRoute(app);
  const headers = 'Facility: Example HC\nOrderer: Test CCA\n';
  const body = { auditMode: 'whatsapp_and_fulfillment', facilityId: service.getAllFacilities()[0].id,
    whatsappMessage: headers + 'PCM 500mg Tablet - 5\nOPV - 3\nOPV Dropper - 3',
    fulfillmentConfirmation: headers + 'Paracetamol 500mg Tablet [5/5]\nOral Polio Vaccine [3/3]\nOPV Dropper [3/3]' };
  const valid = await route({ ...body });
  assert.equal(valid.status, 200, JSON.stringify(valid.body)); assert.equal(valid.body.allMatch, true, JSON.stringify({items:valid.body.items,details:valid.body.generalAudit}));
  assert.equal(valid.body.auditScope, 'general_auditor'); assert.equal(valid.body.canCommit, false);
  assert.equal(valid.body.facilityId, body.facilityId); assert.equal(app.balance('OPV'), 15);
  const wrong = await route({ ...body, fulfillmentConfirmation: headers + 'ORS [5/5]' });
  assert.equal(wrong.status, 200); assert.equal(wrong.body.allMatch, false);
  for (const fs of [body.fulfillmentConfirmation.replace('[5/5]', '[3/5]'), body.fulfillmentConfirmation.replace('OPV Dropper [3/3]', 'OPV Dropper [2/2]')]) {
    const changed = await route({ ...body, fulfillmentConfirmation: fs });
    assert.equal(changed.status, 200); assert.equal(changed.body.allMatch, false);
    assert.equal(changed.body.comparisonMode, 'product_names_quantities'); assert.equal(app.balance('OPV'), 15);
  }
});

test('General Auditor verify route reads saved facility aliases without changing Blueprint data', async () => {
  const app = fixture();
  const sheet = app.records.get('vaccine_districts/isolated-test-sheet');
  Object.assign(sheet, { district: 'Kwahu East', region: 'Eastern' });
  Object.assign(sheet.rows[0], { district: 'Kwahu East', region: 'Eastern', facility: 'Kotoso Rural Health Centre', fsFacilityId: 'test-kotoso', verifiedAliases: ['Kotoso RCH'] });
  const snapshot = JSON.stringify(sheet);
  const route = verifyRoute(app);
  const body = { auditScope: 'general_auditor', whatsappMessage: 'Facility: KOTOSO RHC\nOrderer: Mary Mensah\nORS - 5',
    fulfillmentConfirmation: 'Facility: Kotoso RCH\nOrderer: Mary Mensah\nORS [5/5]' };
  const verified = await route(body);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.generalAudit.facility.status, 'match');
  assert.equal(verified.body.generalAudit.facility.verification, 'records');
  assert.equal(verified.body.generalAudit.facility.customerFacilityId, 'test-kotoso');
  assert.equal(verified.body.allMatch, true);
  assert.equal(JSON.stringify(sheet), snapshot);
  sheet.rows[0].verifiedAliases = [];
  const review = await route({ ...body, facilityContext: { records: [{ id: 'forged', name: 'Kotoso RHC', verifiedAliases: ['Kotoso RCH'] }] } });
  assert.equal(review.status, 200);
  assert.equal(review.body.generalAudit.facility.status, 'match');
  assert.equal(review.body.generalAudit.facility.fulfillmentFacilityId, 'test-kotoso');
  assert.equal(review.body.allMatch, true);
  assert.equal(review.body.issueCount, 0);
  assert.equal(review.body.status, 'resolved');
});

test('actual verify route returns compatible fulfilment-only success and failure without WhatsApp', async () => {
  const app = fixture(); await app.refresh(); const route = verifyRoute(app);
  const body = { auditMode: 'fulfillment_only', facilityId: service.getAllFacilities()[0].id, fulfillmentConfirmation: 'Facility: Example HC\nIPV [2/2]' };
  const valid = await route(body);
  assert.equal(valid.status, 200); assert.equal(valid.body.allMatch, true); assert.equal(valid.body.isValid, true);
  assert.equal(valid.body.auditMode, 'fulfillment_only'); assert.equal(app.balance('IPV'), 20);
  const excess = await route({ ...body, fulfillmentConfirmation: 'Facility: Example HC\nIPV [21/21]' });
  assert.equal(excess.status, 200); assert.equal(excess.body.allMatch, false); assert.ok(excess.body.discrepancies.length);
  const missing = await route({ ...body, fulfillmentConfirmation: '' });
  assert.equal(missing.status, 400); assert.equal(missing.body.allMatch, false);
  assert.equal((await route({ ...body, auditMode: 'not-supported' })).status, 400);
});

test('legacy Blueprint rows without row IDs remain selectable; duplicate names require confirmation', async () => {
  const app = fixture(); const sheet = app.records.get('vaccine_districts/isolated-test-sheet');
  delete sheet.rows[0].id;
  const valid = await app.ready({ fulfillmentConfirmation: 'Facility: Example HC\nIPV [2/2]' });
  assert.equal(valid.status, 200, JSON.stringify(valid.body)); assert.equal(valid.body.allMatch, true);
  assert.equal(app.records.get('vaccine_districts/isolated-test-sheet').rows[0].id, undefined);
  sheet.rows.push(structuredClone(sheet.rows[0]));
  const ambiguous = await app.ready({ fulfillmentConfirmation: 'Facility: Example HC\nIPV [2/2]' });
  assert.equal(ambiguous.status, 409); assert.equal(ambiguous.body.allMatch, false);
});

test('facility auto-identification recognizes normalized names but requires unique sheet/cycle selection', async () => {
  const app = fixture(); await app.refresh();
  const auto = await app.invoke('verify', { auditMode: 'fulfillment_only', facilityId: 'auto', fulfillmentConfirmation: 'Facility: Example HC\nIPV [2/2]' });
  assert.equal(auto.body.allMatch, true); assert.equal(auto.body.facilityId, service.getAllFacilities()[0].id);
  assert.equal(normalizeFacilityName('Test C.H.P.S.'), normalizeFacilityName('Test CHPS'));
  assert.equal(normalizeFacilityName('Test DHD'), normalizeFacilityName('Test District Health Directorate'));
  const invalid = await app.ready({ blueprintSheetId: 'another-sheet' }); assert.equal(invalid.status, 404);
  const mismatch = await app.ready({ fulfillmentConfirmation: 'Facility: Example North HC\nIPV [2/2]' });
  assert.equal(mismatch.body.allMatch, false); assert.equal(mismatch.body.facilityMismatch, true);
  service.importAllocationsFromRows([{ sourceSheetId: 'different-cycle', sourceRowId: 'another-row', facility: 'Example Health Centre', district: 'Test', cycle: 'November 2026', vaccine: 'IPV', allocation: 30, remaining: 30 }]);
  assert.throws(() => resolveCompanionFacility({ facilityId: 'auto' }, 'Facility: Example HC\nIPV 2'), (error: any) => error.status === 409);
  assert.equal(resolveCompanionFacility({ facilityId: 'auto', blueprintSheetId: 'isolated-test-sheet' }, 'Facility: Example HC\nIPV 2').cycle, 'October 2026');
});

test('extension vaccine prose and approved facility aliases survive verification and atomic confirmation', async () => {
  const app = fixture(async () => ({records: [{name: 'Example Health Centre', verifiedAliases: ['Official Example'], source: 'test/directory'}]}));
  await app.refresh();
  const result = await app.invoke('verify', {auditMode: 'whatsapp_and_fulfillment', facilityId: 'auto',
    whatsappMessage: 'This is Mary from Official-Example.\nIPV 2',
    fulfillmentConfirmation: 'Thank you Mary from Example H.C. for ordering with Zipline.\nIPV [2/2]'});
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.allMatch, true, JSON.stringify(result.body));
  assert.equal(app.balance('IPV'), 20, 'Verification is read-only');
  const committed = await app.commit(result.body);
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.equal(app.balance('IPV'), 18);
  const duplicate = await app.commit(result.body);
  assert.equal(duplicate.status, 200);
  assert.equal(app.balance('IPV'), 18, 'Retry must not deduct twice');
});

test('a removed facility alias cannot authorise a pending vaccine deduction', async () => {
  let aliases = ['Official Example'];
  const app = fixture(async () => ({records: [{name: 'Example Health Centre', verifiedAliases: aliases, source: 'test/directory'}]}));
  const approved = await app.ready({fulfillmentConfirmation: 'Thank you Mary from Official Example for ordering with Zipline.\nIPV [2/2]'});
  assert.equal(approved.body.allMatch, true, JSON.stringify(approved.body));
  aliases = [];
  const committed = await app.commit(approved.body);
  assert.equal(committed.status, 409);
  assert.equal(app.balance('IPV'), 20);
});

test('recorded fulfilment cannot clear a changed customer request, and read failures remain review errors', async () => {
  const app = fixture(); const approved = (await app.ready()).body; await app.commit(approved);
  const changed = await app.ready({ auditMode: 'whatsapp_and_fulfillment', whatsappMessage: 'IPV 99' });
  assert.equal(changed.body.allMatch, false); assert.equal(changed.body.canCommit, false); assert.ok(changed.body.discrepancies.length);
  app.setReadFailure(true); const failed = await app.ready(); assert.equal(failed.status, 503);
  assert.equal(failed.body.allMatch, false); assert.equal(failed.body.auditStatus, 'requires_review');
});

test('fulfilment only checks partial allocations, pairs and aliases without a customer request; audit is read-only', async () => {
  const app = fixture(); const audit = await app.ready();
  assert.equal(audit.status, 200); assert.equal(audit.body.isValid, true, audit.body.errors?.join('\n'));
  assert.equal(audit.body.canCommit, true); assert.equal(audit.body.orderSource, 'fs_only');
  assert.equal(app.balance('BCG'), 20); assert.equal(app.balance('OPV'), 15); assert.equal(app.balance('Rota'), 10);
  assert.equal([...app.records.keys()].filter(key => key.startsWith('vaccine_transactions/')).length, 0);
});

test('normal customer comparison enforces matching quantities and accepts required companions', async () => {
  const app = fixture(); const audit = await app.ready({ auditMode: 'customer_fulfillment', whatsappMessage: 'BCG 5\nOPV 3\nRota 4' });
  assert.equal(audit.body.isValid, true, audit.body.errors?.join('\n'));
  const mismatch = await app.ready({ auditMode: 'customer_fulfillment', whatsappMessage: 'BCG 5\nOPV 4\nRota 4' });
  assert.equal(mismatch.body.isValid, false); assert.equal(mismatch.body.canCommit, false);
  assert.ok(mismatch.body.errors.some((value: string) => /QUANTITY MISMATCH/.test(value)));
});

test('authorized multi-product commit persists exact balances and transaction; repeated audits and retries deduct once', async () => {
  const app = fixture(); const audit = (await app.ready()).body;
  const denied = await app.invoke('commit', { orderId: audit.orderId, facilityId: audit.facilityId }, 'cca', { roles: ['auditor'] });
  assert.equal(denied.status, 403); assert.equal(app.balance('OPV'), 15);
  const confirmed = await app.invoke('commit', { orderId: audit.orderId, facilityId: audit.facilityId });
  assert.equal(confirmed.status, 200); assert.equal(app.balance('OPV'), 12);
  const [first, second] = await Promise.all([app.commit(audit), app.commit(audit)]);
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(app.balance('BCG'), 15); assert.equal(app.balance('OPV'), 12); assert.equal(app.balance('Rota'), 6);
  const writes = app.writes;
  assert.equal((await app.commit(audit)).status, 200); assert.equal(app.writes, writes);
  service.clearAllAllocations({ clearHistory: true });
  const refreshed = await app.ready(); assert.equal(refreshed.body.allocationStatus, 'deducted'); assert.equal(refreshed.body.canCommit, false);
  assert.equal(refreshed.body.isValid, true); assert.deepEqual(refreshed.body.errors, []);
  assert.equal(service.getAllFacilities()[0].vaccines.OPV.remaining, 12);
  assert.equal((await app.commit(audit)).status, 200); assert.equal(app.balance('OPV'), 12);
});

test('invalid facility, unknown product, missing allocation, pairing and excess never approve a deduction', async () => {
  const app = fixture();
  for (const fs of [
    'Facility: Other Clinic\nIPV [2/2]', 'IPV [2/2]',
    'Facility: Example Health Centre\nMystery Vaccine [2/2]',
    'Facility: Example Health Centre\nPCV [2/2]',
    'Facility: Example Health Centre\nOPV [3/3]\nOPV Dropper [2/2]',
    'Facility: Example Health Centre\nIPV [21/21]'
  ]) {
    const result = await app.ready({ fulfillmentConfirmation: fs });
    assert.equal(result.body.isValid, false, fs); assert.equal(result.body.canCommit, false, fs);
    assert.equal((await app.commit(result.body)).status, 404);
  }
  assert.equal(app.balance('IPV'), 20);
  assert.equal((await app.ready({ facilityId: 'missing' })).status, 404);
  assert.equal((await app.ready({ auditMode: 'invalid' })).status, 400);
  assert.equal((await app.ready({ auditMode: 'customer_fulfillment', whatsappMessage: '' })).status, 400);
});

test('changing balance, facility or actor blocks commit atomically; caller quantities cannot replace approved evidence', async () => {
  const app = fixture(); const audit = (await app.ready()).body;
  assert.equal((await app.commit(audit, { facilityId: 'wrong' })).status, 409);
  assert.equal((await app.commit(audit, {}, 'other')).status, 403);
  const sheet = app.records.get('vaccine_districts/isolated-test-sheet'); sheet.rows[0].vaccines.OPV.balance = 1;
  assert.equal((await app.commit(audit)).status, 409); assert.equal(app.balance('BCG'), 20); assert.equal(app.balance('Rota'), 10);
  sheet.rows[0].vaccines.OPV.balance = 15;
  assert.equal((await app.commit(audit, { items: [{ vaccine: 'BCG', currentOrder: 999 }] })).status, 200);
  assert.equal(app.balance('BCG'), 15);
});

test('read and write failures never publish success; lost post-commit response retries the persisted event safely', async () => {
  const app = fixture(); app.setReadFailure(true);
  assert.equal((await app.ready()).status, 503); app.setReadFailure(false);
  const audit = (await app.ready()).body; app.setWriteFailure(true);
  assert.equal((await app.commit(audit)).status, 503); assert.equal(app.balance('OPV'), 15);
  app.setWriteFailure(false); app.loseNextCommitResponse();
  assert.equal((await app.commit(audit)).status, 503); assert.equal(app.balance('OPV'), 12);
  assert.equal((await app.commit(audit)).status, 200); assert.equal(app.balance('OPV'), 12);
});

test('order identity is stable across whitespace, repeated audits and changed customer requests', () => {
  assert.equal(companionOrderId('one', 'Facility: Clinic\nIPV [2/2]'), companionOrderId('one', ' Facility:   Clinic IPV [2/2] '));
  assert.notEqual(companionOrderId('one', 'IPV [2/2]'), companionOrderId('two', 'IPV [2/2]'));
});

test('the actual verify route dispatches fulfilment only before the legacy two-input validation', async () => {
  const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const begin = source.indexOf("app.post('/api/verify'");
  const end = source.indexOf("app.post('/api/scan-screenshot'", begin);
  let handler: any, calls = 0;
  const context = vm.createContext({
    app: { post(_path: string, callback: any) { handler = callback; } },
    console: { log() {}, error() {}, warn() {} },
    normalizeCompanionAuditMode,
    companionVaccine: { verify(req: any, res: any) { calls++; assert.equal(req.body.auditMode, 'fulfillment_only'); return res.json({ dispatched: true }); } }
  });
  vm.runInContext(ts.transpile(source.slice(begin, end)), context);
  let response: any;
  await handler({ body: { auditMode: 'fulfillment_only', fulfillmentConfirmation: 'Facility: Clinic\nIPV 2' } }, { json(value: any) { response = value; } });
  assert.equal(calls, 1); assert.equal(response.dispatched, true);
});

test('authentication and role middleware protect the commit route', async () => {
  const authenticate = createAuthentication(async token => ({ uid: token, email: `${token}@test.invalid`, email_verified: true }), async email => ({
    id: email, email, name: 'Test', role: email.startsWith('auditor') ? 'auditor' : 'cca', district: 'Test', createdAt: ''
  }));
  const fixtureApp = fixture();
  const send = async (token?: string) => {
    let status = 200;
    const req = { method: 'POST', path: '/vaccine/allocations/commit', headers: token ? { authorization: `Bearer ${token}` } : {}, body: {} };
    const res = { locals: {}, status(code: number) { status = code; return this; }, json() { return this; } };
    await authenticate(req as any, res as any, () => { status = 204; });
    if (status === 204) await fixtureApp.handlers.commit(req as any, res as any, () => {});
    return status;
  };
  assert.equal(await send(), 401); assert.equal(await send('auditor'), 403); assert.equal(await send('cca'), 400);
});

test('effective roles independently guard confirmation and receipt lookup; admin and legacy CCA can confirm', async () => {
  for (const profile of [{ role: 'admin' }, { role: 'cca' }, { role: 'auditor', roles: ['cca'] }]) {
    const app = fixture(); const audit = (await app.ready()).body;
    const body = { orderId: audit.orderId, facilityId: audit.facilityId, authorized: true };
    const pending = await app.invoke('status', body);
    assert.equal(pending.body.allocationStatus, 'awaiting_confirmation'); assert.equal(app.balance('OPV'), 15);
    for (const denied of [{ role: 'cca', roles: ['auditor'] }, { role: 'cca', roles: [] }, { role: 'unknown' }]) {
      assert.equal((await app.invoke('commit', body, 'cca', denied)).status, 403);
      assert.equal((await app.invoke('status', body, 'cca', denied)).status, 403);
    }
    const committed = await app.invoke('commit', body, 'cca', profile);
    assert.equal(committed.status, 200); assert.equal(app.balance('OPV'), 12);
    const writes = app.writes;
    const receipt = await app.invoke('status', body, 'cca', profile);
    assert.equal(receipt.status, 200); assert.equal(receipt.body.allocationStatus, 'deducted');
    assert.deepEqual(receipt.body.transaction, JSON.parse(JSON.stringify(committed.body.transaction))); assert.equal(app.writes, writes);
    assert.equal((await app.invoke('status', body, 'other')).status, 403);
    assert.equal((await app.invoke('status', { orderId: '../invalid' })).status, 400);
    assert.equal((await app.invoke('status', { orderId: 'EXT-' + '0'.repeat(64) })).status, 404);
  }
});

test('inactive sheet or facility blocks verification and a later deactivation blocks the entire transaction', async () => {
  for (const scope of ['sheet', 'row']) {
    const app = fixture(); const audit = (await app.ready()).body;
    const sheet = app.records.get('vaccine_districts/isolated-test-sheet');
    (scope === 'sheet' ? sheet : sheet.rows[0]).active = false;
    const result = await app.commit(audit);
    assert.equal(result.status, 409); assert.match(result.body.error, /inactive/);
    assert.equal(app.balance('OPV'), 15); assert.equal(app.balance('BCG'), 20);
    assert.equal(app.records.has('vaccine_transactions/' + audit.orderId), false);
    const verified = await app.ready(); assert.equal(verified.status, 409); assert.equal(verified.body.allMatch, false);
  }
});

test('concurrent different orders recheck balances and preserve carry-over and original allocation', async () => {
  const app = fixture(); const sheet = app.records.get('vaccine_districts/isolated-test-sheet');
  Object.assign(sheet.rows[0].vaccines.IPV, { allocation: 15, carryOver: 5, balance: 20 });
  const source = 'Facility: Example Health Centre\nIPV [12/12]';
  const first = (await app.ready({ fulfillmentConfirmation: source + '\nOrder ID: A' })).body;
  const second = (await app.ready({ fulfillmentConfirmation: source + '\nOrder ID: B' })).body;
  assert.equal(first.canCommit, true); assert.equal(second.canCommit, true);
  const responses = await Promise.all([app.commit(first), app.commit(second)]);
  assert.deepEqual(responses.map(value => value.status).sort(), [200, 409]);
  const current = app.records.get('vaccine_districts/isolated-test-sheet').rows[0].vaccines.IPV;
  assert.equal(current.balance, 8); assert.equal(current.distributed, 12);
  assert.equal(current.allocation, 15); assert.equal(current.carryOver, 5);
});

test('recognized consumables without allocation records are validated but not deducted; tracked companions deduct once', async () => {
  const aliases = service.getAliases();
  try {
    service.updateAliases({ 'Soloshot 0.5ml': ['Soloshot 0.5ml'] });
    const app = fixture(); const sheet = app.records.get('vaccine_districts/isolated-test-sheet');
    sheet.rows[0].vaccines['BCG Diluent'] = { allocation: 20, balance: 20, distributed: 0 };
    const audit = (await app.ready({ fulfillmentConfirmation: app.fs + '\nSoloshot 0.5ml [5/5]' })).body;
    assert.equal(audit.allMatch, true, JSON.stringify(audit.errors));
    const result = await app.commit(audit); assert.equal(result.status, 200);
    assert.equal(app.balance('BCG'), 15); assert.equal(app.balance('BCG Diluent'), 15);
    assert.equal(result.body.transaction.items.filter((item: any) => item.vaccine === 'BCG Diluent').length, 1);
    assert.equal(result.body.transaction.items.some((item: any) => item.vaccine === 'Soloshot 0.5ml'), false);
  } finally { service.replaceAliases(aliases); }
});

test('actual extension adapter carries the server-issued reference through verification, deduction and retry in both modes', async () => {
  const { auditVaccineOrder, commitVaccineOrder, getDeductionStatus } = await import('../extension/vaccine-api.js');
  for (const mode of ['whatsapp_and_fulfillment', 'fulfillment_only']) {
    const app = fixture(); await app.refresh(); const facilityId = service.getAllFacilities()[0].id;
    const request = async (path: string, options?: any) => {
      const action = path.includes('/commit/') ? 'status' : path.endsWith('/commit') ? 'commit' : 'verify';
      const body = options?.body ? JSON.parse(options.body) : { orderId: decodeURIComponent(path.split('/').pop()!) };
      const response = await app.invoke(action, body);
      assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
    };
    const audit = await auditVaccineOrder(request, { mode, facilityId, fulfillmentConfirmation: app.fs, whatsappMessage: 'BCG 5\nOPV 3\nRota 4' });
    assert.match(audit.verificationId, /^EXT-[a-f0-9]{64}$/);
    assert.equal(audit.orderId, audit.verificationId); assert.equal(app.balance('OPV'), 15);
    const confirmed = await commitVaccineOrder(request, audit);
    assert.equal(confirmed.transaction.id, audit.verificationId); assert.equal(app.balance('OPV'), 12);
    assert.equal((await getDeductionStatus(request, audit)).transaction.id, audit.verificationId);
    await commitVaccineOrder(request, audit); assert.equal(app.balance('OPV'), 12);
  }
});

test('only persisted eligible verification references can deduct, independently of their spelling', async () => {
  const app = fixture(); const audit = (await app.ready()).body;
  assert.equal((await app.invoke('commit', { auditId: 'FS-ORDER-42', facilityId: audit.facilityId })).status, 404);
  assert.equal((await app.invoke('commit', { auditId: '../bad', facilityId: audit.facilityId })).status, 400);
  const saved = app.records.get('vaccine_verified_orders/' + audit.orderId);
  const reference = 'VAC-server-persisted-42';
  app.records.set('vaccine_verified_orders/' + reference, { ...saved, orderId: reference });
  const wrong = await app.invoke('commit', { auditId: reference, facilityId: 'wrong' });
  assert.equal(wrong.status, 409); assert.equal(app.balance('OPV'), 15);
  const receipt = await app.invoke('commit', { auditId: reference, facilityId: audit.facilityId });
  assert.equal(receipt.status, 200); assert.equal(receipt.body.transaction.id, reference);
  await app.invoke('commit', { verificationId: reference, facilityId: audit.facilityId });
  assert.equal(app.balance('OPV'), 12);
});

test('read-only status returns the committed transaction even if its allocation projection is unavailable', async () => {
  const app = fixture(); const audit = (await app.ready()).body;
  const committed = await app.commit(audit); assert.equal(committed.status, 200);
  app.records.delete('vaccine_allocations/' + audit.facilityId);
  const writes = app.writes;
  const receipt = await app.invoke('status', { orderId: audit.orderId });
  assert.equal(receipt.status, 200); assert.equal(receipt.body.allocationStatus, 'deducted');
  assert.equal(receipt.body.transaction.status, 'confirmed'); assert.equal(receipt.body.transaction.id, audit.orderId);
  assert.equal(receipt.body.updatedFacility, null); assert.equal(app.writes, writes);
  assert.equal(app.balance('OPV'), 12);
});

test('main app and actual extension audit body resolve the same saved catalogue IDs and quantity results',async()=>{
 const app=fixture();await app.refresh();const route=verifyRoute(app);
 const {auditBody}=await import('../extension/audit.js');
 const headers='Facility: Example HC\nOrderer: Test CCA\n';
 const customer=headers+'inj. Diclofenac 75mg/3ml - 30',fulfillment=headers+'Diclofenac 25mg/mL Injection, 3mL [10/10]';
 const main=await route({auditScope:'general_auditor',whatsappMessage:customer,fulfillmentConfirmation:fulfillment});
 const extension=await route(auditBody(customer,fulfillment,1));
 assert.equal(main.status,200);assert.equal(extension.status,200);
 const businessItems=(result:any)=>result.items.map(({provenance,...item}:any)=>({...item,provenance:provenance.map(({normalizedName,clinicalAttributes,...source}:any)=>source)}));
 assert.deepEqual(businessItems(extension.body),businessItems(main.body));
 assert.equal(extension.body.productMatchingDiagnostics[0].customer[0].catalogProductId,main.body.productMatchingDiagnostics[0].customer[0].catalogProductId);
 assert.equal(main.body.items.length,1);assert.equal(main.body.items[0].status,'pending order limit');
 assert.equal(main.body.items[0].name,'Diclofenac 25mg/mL Injection, 3mL');
 assert.equal(main.body.issueCount,0);assert.equal(main.body.allMatch,false);
 assert.equal(main.body.items[0].difference,20);assert.equal(main.body.items[0].fulfillment.orderLimitEligible,true);
 const proof=main.body.productMatchingDiagnostics[0];
 assert.equal(proof.customer[0].catalogProductId,proof.fulfillment[0].catalogProductId);
 assert.equal(proof.customer[0].geminiCalled,false);assert.equal(proof.fulfillment[0].geminiCalled,false);
 const key=main.body.items[0].fulfillment.key;
 for(const answer of [true,false]) {
  const body={auditScope:'general_auditor',whatsappMessage:customer,fulfillmentConfirmation:fulfillment,generalOrderLimitDecisions:{[key]:answer}};
  const saved=await route(body);
  assert.equal(saved.status,200);
  assert.equal(saved.body.items[0].status,answer?'order limit applied':'quantity mismatch');
  assert.equal(saved.body.allMatch,answer);assert.equal(saved.body.issueCount,answer?0:1);
 }
 assert.equal(app.balance('OPV'),15);
});

test('actual General Auditor route queues new wording for approval for both interfaces without changing allocations',async()=>{
 const app=fixture();await app.refresh();
 app.records.set('product_catalog/current',{revision:30,products:[{id:'verified-pcm',scope:'general',name:'Paracetamol 500mg Tablet',aliases:['PCM 500mg'],contextualAliases:[],category:'medicine',note:''}]});
 const route=verifyRoute(app),header='Facility: Example HC\nOrderer: Test CCA\n';
 const customer=header+'Paracet 500 tabs 20/20',fulfillment=header+'Paracetamol 500mg Tablet [20/20]';
 const first=await route({auditScope:'general_auditor',whatsappMessage:customer,fulfillmentConfirmation:fulfillment});
 assert.equal(first.status,200);assert.equal(first.body.allMatch,true);assert.equal(first.body.aliasLearning.saved,0);
 const saved=app.records.get('product_catalog/current');
 assert.equal(saved.products.length,1);assert.ok(!saved.products[0].aliases.includes('Paracet 500 tabs'));assert.equal(saved.aliasRecords[0].status,'pending');
 assert.ok([...app.records.keys()].some(key=>key.startsWith('product_catalog/current/alias_history/')));
 const {auditBody}=await import('../extension/audit.js');
 const second=await route(auditBody(customer,fulfillment,saved.revision));
 assert.equal(second.status,200);assert.equal(second.body.allMatch,true);
 assert.equal(second.body.productMatchingDiagnostics[0].customer[0].matchSource,'Normalized');
 assert.equal(second.body.geminiMetrics.requestStarted,false);assert.equal(second.body.aliasLearning.saved,0);
 assert.equal(app.balance('OPV'),15);
});

test('website and extension General verify route share documented full and partial stockout accounting',async()=>{
 const app=fixture();await app.refresh();
 app.records.set('product_catalog/current',{revision:90,products:[{id:'rdt',scope:'general',name:'Malaria Rapid Diagnostic Test Kit',aliases:['RDT','Malaria RDT'],contextualAliases:[],category:'diagnostic',note:''}]});
 const route=verifyRoute(app);const {auditBody}=await import('../extension/audit.js');
 for(const [quantity,supplied,status] of [[1,0,'Out of stock'],[1,1,'In stock'],[5,3,'Partially out of stock']] as const){
  const customer=`Orderer: Grace\nFacility: Abasua Health Centre\nRDT ${quantity}`;
  const confirmation=`Orderer: Grace Akabati\nFacility: Abasua HC\nMalaria Rapid Diagnostic Test Kit [${supplied}/${quantity}]\nStatus: ${status}`;
  for(const body of [{auditScope:'general_auditor',whatsappMessage:customer,fulfillmentConfirmation:confirmation},auditBody(customer,confirmation,90)]){
   const r=await route(body);assert.equal(r.status,200);assert.equal(r.body.allMatch,true);assert.equal(r.body.issueCount,0);
   assert.equal(r.body.generalAudit.products[0].supplied,supplied);assert.equal(r.body.generalAudit.productTotals.matched,1);
   assert.equal(r.body.generalAudit.productTotals.physicallyFulfilled,Number(supplied>0));
  }
 }
 assert.equal(app.balance('OPV'),15);
});
test('General verify retains a failed history write and a same-ID retry creates one saved audit without altering the verdict',async()=>{
 const app=fixture();await app.refresh();
 app.records.set('product_catalog/current',{revision:91,products:[{id:'rdt',scope:'general',name:'Malaria Rapid Diagnostic Test Kit',aliases:['RDT'],contextualAliases:[],category:'diagnostic',note:''}]});
 const route=verifyRoute(app);const body={checkId:'AUD-storage-retry',auditScope:'general_auditor',whatsappMessage:'Orderer: Grace Akabati\nFacility: Abasua HC\nRDT 5',fulfillmentConfirmation:'Orderer: Grace Akabati\nFacility: Abasua HC\nMalaria Rapid Diagnostic Test Kit [0/1] - out of stock'};
 app.setWriteFailure(true);const failed=await route(body);
 assert.equal(failed.status,200);assert.equal(failed.body.storage.status,'failed');assert.equal(failed.body.storage.category,'network');assert.equal(failed.body.issueCount,0);assert.equal(failed.body.generalAudit.productTotals.quantityReview,0);
 assert.equal(app.records.has('audits/'+body.checkId),false);
 app.setWriteFailure(false);const saved=await route(body);assert.equal(saved.body.storage.status,'saved');assert.equal(saved.body.id,body.checkId);
 assert.equal([...app.records.keys()].filter(key=>key.startsWith('audits/')).length,1);assert.equal(saved.body.generalAudit.counts.outOfStock,1);assert.equal(saved.body.createdByUserId,'cca');assert.equal(app.balance('OPV'),15);
});

test('General verify persists four-parameter clearance even when all optional metadata differs', async () => {
  const app = fixture(); await app.refresh();
  const catalog = {revision: 1300, products: [{id: 'rdt', scope: 'general' as const, name: 'Malaria Rapid Diagnostic Test Kit', aliases: ['RDT'], contextualAliases: [], category: 'diagnostic', note: ''}]};
  app.records.set('product_catalog/current', catalog); applyCatalog(catalog);
  const route = verifyRoute(app);
  const body = {checkId: 'AUD-four-parameters', auditScope: 'general_auditor',
    whatsappMessage: 'Orderer: Grace Akabati\nFacility: Example HC\nRDT 5\nDistrict: North\nDropsite: Front gate\nPhone: 0241234567\nDate: 30/10/2026',
    fulfillmentConfirmation: 'Orderer: Grace Akabati\nFacility: Example Health Centre\nMalaria Rapid Diagnostic Test Kit [5/5]\nDistrict: South\nDropsite: Back gate\nPhone: 0209998888\nDate: 01/11/2026'};
  const response = await route(body);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.allMatch, true, JSON.stringify(response.body)); assert.equal(response.body.issueCount, 0);
  assert.equal(response.body.generalAudit.finalStatus, 'NO DISCREPANCY');
  assert.equal(response.body.confidence, 100); assert.equal(response.body.storage.status, 'saved');
  const saved = app.records.get('audits/' + body.checkId);
  assert.equal(saved.finalVerdict, 'NO DISCREPANCY'); assert.equal(saved.issueCount, 0);
  assert.equal(saved.whatsappMessage, body.whatsappMessage);
  assert.equal(saved.fulfillmentConfirmation, body.fulfillmentConfirmation);
  assert.equal(app.balance('IPV'), 20, 'General auditing never deducts a vaccine allocation');
});

test('General verify returns verified findings while a slow history write remains explicitly pending',async(t)=>{
  const app=fixture();await app.refresh();
  const catalog={revision:1700,products:[{id:'rdt',scope:'general' as const,name:'Malaria Rapid Diagnostic Test Kit',aliases:['RDT'],contextualAliases:[],category:'diagnostic',note:''}]};
  app.records.set('product_catalog/current',catalog);applyCatalog(catalog);
  const write=app.storage.write;let release!:()=>void;
  const pending=new Promise<void>(resolve=>release=resolve);
  app.storage.write=async(path,value)=>{if(path.startsWith('audits/'))await pending;return write(path,value);};
  const route=verifyRoute(app),started=performance.now();
  const body={checkId:'AUD-speed-pending',auditScope:'general_auditor',whatsappMessage:'Orderer: Grace Akabati\nFacility: Example HC\nRDT 5',fulfillmentConfirmation:'Orderer: Grace Akabati\nFacility: Example Health Centre\nMalaria Rapid Diagnostic Test Kit [5/5]'};
  try {
    const response=await route(body);
    const elapsed=performance.now()-started;t.diagnostic(`Verified API result with a held Firestore write: ${elapsed.toFixed(1)} ms`);
    assert.ok(elapsed<10_000);
    assert.equal(response.status,200);assert.equal(response.body.allMatch,true);
    assert.equal(response.body.storage.status,'pending');assert.equal(app.records.has('audits/'+body.checkId),false);
    release();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(response.body.storage.status,'saved');
    assert.equal(app.records.get('audits/'+body.checkId).id,body.checkId);
    assert.equal(app.balance('IPV'),20);
  } finally {release();}
});
