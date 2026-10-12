import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { companionVaccineHandlers } from './companionVaccine';
import * as service from './vaccineService';

// Never load production credentials or run this integration test against a cloud project.
test('Firestore emulator persists an atomic deduction and deduplicates retries after a fresh service load', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST && 'Start the local Firestore emulator to run the persistence integration test.'
}, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/, 'Only a local emulator is allowed.');
  const { initializeApp, deleteApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  // An ephemeral key for a nonexistent demo account prevents ADC/metadata lookups.
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const app = initializeApp({ projectId: 'demo-ordercheck-extension', credential: cert({
    projectId: 'demo-ordercheck-extension', clientEmail: 'emulator@demo-ordercheck-extension.iam.gserviceaccount.com', privateKey
  }) }, 'extension-test-' + randomUUID());
  const db = getFirestore(app);
  const sheetId = 'extension-test-' + randomUUID();
  const sheetRef = db.collection('vaccine_districts').doc(sheetId);
  const sheet = { id: sheetId, district: 'Isolated Test', month: 'Test cycle', products: ['OPV', 'BCG'], rows: [{ id: 'test-row', facility: 'Isolated Test Clinic',
    vaccines: { OPV: { allocation: 15, distributed: 0, balance: 15 }, BCG: { allocation: 20, distributed: 0, balance: 20 } } }] };
  let orderId = '', facilityId = '';
  service.clearAllAllocations({ clearHistory: true });
  const refresh = async () => {
    const current: any = (await sheetRef.get()).data();
    service.syncAllDistrictsToFacilities(current.rows.flatMap((row: any) => Object.entries(row.vaccines).map(([vaccine, value]: any) => ({
      sourceSheetId: sheetId, sourceRowId: row.id, facility: row.facility, district: current.district, cycle: current.month,
      vaccine, allocation: value.allocation, taken: value.distributed, remaining: value.balance
    }))), 'local emulator');
  };
  const handlers = companionVaccineHandlers({ refresh, storage: () => ({
    db, doc: (db: any, collection: string, id: string) => db.collection(collection).doc(id),
    runTransaction: (db: any, callback: any) => db.runTransaction((tx: any) => callback({
      get: async (ref: any) => { const snap = await tx.get(ref); return { exists: () => snap.exists, data: () => snap.data() }; },
      set: (ref: any, value: any, options?: any) => options ? tx.set(ref, value, options) : tx.set(ref, value)
    })),
    clean: data => JSON.parse(JSON.stringify(data)), productKey: (values, name) => Object.keys(values).find(key => service.matchVaccineName(key).canonical === service.matchVaccineName(name).canonical) || name,
    progress: () => 'in_progress', debug: () => {}
  }), publish: value => service.publishConfirmedVaccineOrder(value.result.updatedFacility!, value.result.transaction!),
    activity: (event, data) => ({ id: event === 'confirmed' ? data.transaction.id + '-confirmed' : data.orderId,
      event, facilityId: event === 'confirmed' ? data.updatedFacility.id : data.facilityId }) });
  const invoke = async (action: 'verify' | 'commit' | 'status', body: any) => {
    let status = 200, result: any;
    await handlers[action]({ body, params: { orderId: body.orderId } } as any, { locals: { authUser: { id: 'local-test-cca', name: 'Local Test CCA', role: 'cca' } },
      status(value: number) { status = value; return this; }, json(value: any) { result = value; return this; } } as any, () => {});
    assert.equal(status, 200, JSON.stringify(result)); return result;
  };
  try {
    await sheetRef.set(sheet); await refresh(); facilityId = service.getAllFacilities()[0].id;
    const verified = await invoke('verify', { auditMode: 'fulfillment_only', facilityId,
      fulfillmentConfirmation: 'Facility: Isolated Test Clinic\nOPV [3/3]\nOPV Dropper [3/3]\nBCG [5/5]\nBCG Diluent [5/5]' });
    orderId = verified.orderId; assert.equal(verified.canCommit, true);
    assert.equal(verified.allMatch, true);
    assert.equal(verified.auditMode, 'fulfillment_only');
    assert.ok(verified.items.length > 0);
    assert.equal(verified.items.find((item: any) => item.name === 'OPV').found, '3');
    assert.equal((await sheetRef.get()).data()!.rows[0].vaccines.OPV.balance, 15);
    const commit = { orderId, facilityId };
    assert.equal((await invoke('status', commit)).allocationStatus, 'awaiting_confirmation');
    await Promise.all([invoke('commit', commit), invoke('commit', commit)]);
    const receipt = await invoke('status', commit);
    assert.equal(receipt.allocationStatus, 'deducted');
    assert.equal(receipt.transaction.id, orderId);
    assert.equal(receipt.updatedFacility.vaccines.OPV.remaining, 12);
    service.clearAllAllocations({ clearHistory: true });
    await invoke('commit', commit); await refresh();
    const persisted = (await sheetRef.get()).data()!;
    assert.equal(persisted.rows[0].vaccines.OPV.balance, 12); assert.equal(persisted.rows[0].vaccines.BCG.balance, 15);
    assert.equal(service.getFacilityById(facilityId)!.vaccines.OPV.remaining, 12);
    assert.equal((await db.collection('vaccine_allocations').doc(facilityId).get()).data()!.vaccines.OPV.remaining, 12);
    assert.equal((await db.collection('vaccine_transactions').doc(orderId).get()).data()!.items.length, 2);
    assert.equal((await db.collection('activity_logs').doc(orderId + '-confirmed').get()).data()!.event, 'confirmed');
  } finally {
    await Promise.all([sheetRef.delete(), ...(orderId ? [db.collection('vaccine_verified_orders').doc(orderId).delete(), db.collection('vaccine_transactions').doc(orderId).delete(),
      db.collection('activity_logs').doc(orderId).delete(), db.collection('activity_logs').doc(orderId + '-confirmed').delete()] : []),
      ...(facilityId ? [db.collection('vaccine_allocations').doc(facilityId).delete()] : [])]);
    await db.terminate(); await deleteApp(app);
  }
});
