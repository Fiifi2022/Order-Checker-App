import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as service from './vaccineService';
import { resolveBlueprintFacility, normalizeFacilityName, FACILITY_NOT_FOUND, FACILITY_AMBIGUOUS } from './blueprintFacility';
import { persistBlueprintConfirmation, blueprintSaveError } from './blueprintConfirmation';
import { deductValidatedVaccineAudit, type VaccineAuditSnapshot } from '../src/utils/vaccineAuditDeduction';
import type { VaccineValidationResult } from '../src/types';

const snapshot: VaccineAuditSnapshot = { facilityId: 'auto', orderSource: 'whatsapp', whatsappMessage: 'OPV 10', fulfillmentConfirmation: 'OPV [10/10]\nOPV Dropper [10/10]', ccaUser: 'Test CCA' };
const approved = { isValid: true, facilityId: 'resolved-facility', auditLogId: 'stable-audit-id', items: [{ vaccine:'OPV',fsQty:10,requestedQty:15,status:'valid' },{ vaccine:'OPV Dropper',fsQty:10,requestedQty:0,status:'valid' },{ vaccine:'IPV',fsQty:0,requestedQty:0,status:'not_in_order' }] } as VaccineValidationResult;

test('successful audit deducts only fulfilled quantities at the resolved facility using its audit ID', async () => {
  let calls = 0;
  const request = (async (url, options) => {
    calls++; assert.equal(url,'/api/vaccine/confirm');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.facilityId,'resolved-facility'); assert.equal(body.orderId,'stable-audit-id');
    assert.deepEqual(body.items,[{vaccine:'OPV',currentOrder:10},{vaccine:'OPV Dropper',currentOrder:10}]);
    assert.equal(body.rawOrderText,snapshot.whatsappMessage);
    return new Response(JSON.stringify({ success:true, transaction:{id:body.orderId} }));
  }) as typeof fetch;
  assert.equal((await deductValidatedVaccineAudit(approved,snapshot,request)).transaction.id,'stable-audit-id');
  assert.equal(calls,1);
});

test('failed audits, invalid quantities and missing identity never submit a deduction', async () => {
  const request = (async () => { throw new Error('must not deduct'); }) as typeof fetch;
  assert.equal(await deductValidatedVaccineAudit({...approved,isValid:false},snapshot,request),null);
  for (const audit of [{...approved,auditLogId:undefined},{...approved,facilityId:undefined},{...approved,items:[{...approved.items[0],fsQty:1.5}]},{...approved,items:[{...approved.items[0],status:'quantity_mismatch' as const}]}]) {
    await assert.rejects(deductValidatedVaccineAudit(audit,snapshot,request));
  }
});

test('deduction failures are surfaced instead of reporting a saved Blueprint', async () => {
  await assert.rejects(deductValidatedVaccineAudit(approved,snapshot,(async () => new Response(JSON.stringify({error:'Allocation changed'}),{status:409})) as typeof fetch), /Allocation changed/);
});

// Exercise the actual Express confirmation handler against the real allocation service.
// Firestore writes are captured locally; no external records are changed.
function confirmationHarness(failWrites = false) {
  service.clearAllAllocations({clearHistory:true});
  const row = {id:'facility-row',facility:'Audit Deduction Clinic',vaccines:{OPV:{carryOver:0,allocation:100,distributed:10,balance:90,takenHistory:'5 + 5'},'OPV Dropper':{carryOver:0,allocation:100,distributed:10,balance:90}},processing:'',completed:''};
  const sheet = {id:'test-sheet',district:'Test',month:'Test cycle',products:['OPV','OPV Dropper'],rows:[row]};
  const blueprintDistricts: any = {'test-sheet':sheet};
  const sync = () => {
    const current = blueprintDistricts['test-sheet'];
    service.syncAllDistrictsToFacilities(current.rows.flatMap((row:any) => Object.entries(row.vaccines).map(([vaccine,value]:any) => ({sourceSheetId:current.id,sourceRowId:row.id,facility:row.facility,vaccine,allocation:value.allocation,taken:value.distributed,remaining:value.balance,district:'Test',cycle:'Test cycle',tabName:'Test cycle',takenHistory:value.takenHistory}))),'unit test');
  };
  sync(); const facilityId = service.getAllFacilities()[0].id;
  const audit = service.validateVaccineOrder({facilityId,orderSource:'whatsapp',whatsappMessage:'OPV 10',fulfillmentConfirmation:'OPV [10/10]\nOPV Dropper [10/10]',checkId:'deduction-audit'});
  assert.equal(audit.isValid,true);
  const source = readFileSync(new URL('../server.ts',import.meta.url),'utf8');
  const start = source.indexOf('const blueprintConfirmationLocks =');
  const handlerSource = source.slice(start,source.indexOf('// Record DCO Quota',start));
  let handler:any;
  const writes:Array<{path:string;data:any}> = [];
  const records = new Map<string,any>([['vaccine_districts/test-sheet',structuredClone(sheet)]]);
  let attempts=0;
  let beforeCommit: (() => Promise<void>) | undefined;
  const runTransaction = async (_db:any,callback:any) => {
    attempts++;
    const pending:Array<{path:string;data:any}> = [];
    const result = await callback({
      async get(path:string){return {exists:() => records.has(path),data:() => structuredClone(records.get(path))};},
      set(path:string,data:any){pending.push({path,data:structuredClone(data)});}
    });
    await beforeCommit?.();
    if (failWrites) throw Object.assign(new Error('Private storage error must never reach the client'),{code:'permission-denied'});
    for (const write of pending) {records.set(write.path,write.data);writes.push(write);}
    return result;
  };
  vm.runInNewContext(ts.transpile(handlerSource),{
    app:{post(_path:string,callback:any){handler=callback;}},vaccineService:service,
    async ensureVaccineHistoryLoaded(){},async ensureBlueprintLoaded(){},syncAllBlueprintDistrictsToService:sync,blueprintDistricts,
    resolveBlueprintFacility,normalizeFacilityName,FACILITY_NOT_FOUND,FACILITY_AMBIGUOUS,persistBlueprintConfirmation,blueprintSaveError,
    findMatchingVaccineKeyInBlueprint(vaccines:any,name:string){return Object.keys(vaccines).find(key => service.matchVaccineName(key).canonical === service.matchVaccineName(name).canonical) || name;},
    getFacilityBlueprintStatus(row:any){return row.vaccines.OPV.balance === 0 ? 'completed' : 'in_progress';},
    getFirestoreDb(){return {};},doc(_db:any,collection:string,id:string){return `${collection}/${id}`;},runTransaction,
    cleanFirestorePayload(value:any){return JSON.parse(JSON.stringify(value));},
    getActiveActor(){return {name:'Test CCA',role:'cca'};},activityService:{logActivity(value:any){return value;}},async persistActivityLogToFirestore(){},console:{warn(){},info(){}}
  });
  async function confirm(id='deduction-audit') {
    let status=200,body:any;
    await handler({body:{facilityId,orderSource:'whatsapp',items:[{vaccine:'OPV',currentOrder:10},{vaccine:'OPV Dropper',currentOrder:10}],ccaUser:'Test CCA',orderId:id,rawOrderText:'OPV 10',rawFsText:'OPV [10/10]\nOPV Dropper [10/10]'}},{status(code:number){status=code;return this;},json(value:any){body=value;return this;}});
    return {status,body};
  }
  return {confirm,get row(){return blueprintDistricts['test-sheet'].rows[0];},writes,facilityId,records,blueprintDistricts,get attempts(){return attempts;},setFailWrites(value:boolean){failWrites=value;},setBeforeCommit(callback:() => Promise<void>){beforeCommit=callback;}};
}

test('actual confirmation updates facility Blueprint distributed/remaining totals and persists the matched sheet', async () => {
  const app = confirmationHarness();
  const response = await app.confirm();
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.deepEqual(app.row.vaccines.OPV,{carryOver:0,allocation:100,distributed:20,balance:80,takenHistory:'5 + 5 + 10'});
  assert.equal(app.row.vaccines['OPV Dropper'].balance,80);
  assert.equal(response.body.updatedBlueprint.districtId,'test-sheet');
  assert.equal(app.writes.find(write => write.path==='vaccine_districts/test-sheet')?.data.rows[0].vaccines.OPV.balance,80);
  assert.equal(service.getAuditLog('deduction-audit')?.confirmed,true);
  assert.equal(app.records.get('vaccine_allocations/' + app.facilityId).vaccines.OPV.remaining,80);
  assert.equal(app.records.get('vaccine_transactions/deduction-audit').sourceSheetId,'test-sheet');
});

test('retrying the same successful audit does not deduct a second time', async () => {
  const app = confirmationHarness();
  assert.equal((await app.confirm()).status,200); assert.equal((await app.confirm()).status,200);
  assert.equal(app.row.vaccines.OPV.balance,80); assert.equal(app.row.vaccines.OPV.distributed,20);
  assert.equal(service.getTransactions().length,1);
});

test('concurrent requests cannot resync an outdated Blueprint over an active deduction', async () => {
  const app = confirmationHarness();
  const responses = await Promise.all([app.confirm(),app.confirm()]);
  assert.deepEqual(responses.map(response => response.status).sort(),[200,409]);
  assert.equal(app.row.vaccines.OPV.balance,80);
  assert.equal(service.getTransactions().length,1);
});

test('stale allocated companion balance blocks all deductions atomically', async () => {
  service.clearAllAllocations({clearHistory:true});
  service.syncAllDistrictsToFacilities([{facility:'Stale Pair Clinic',vaccine:'OPV',allocation:20,remaining:20},{facility:'Stale Pair Clinic',vaccine:'OPV Dropper',allocation:5,remaining:5}],'unit test');
  const facility = service.getAllFacilities()[0];
  const result = await service.confirmVaccineOrder({facilityId:facility.id,orderSource:'whatsapp',items:[{vaccine:'OPV',currentOrder:10},{vaccine:'OPV Dropper',currentOrder:10}],ccaUser:'Test CCA',orderId:'stale-pair-audit'});
  assert.equal(result.success,false); assert.equal(facility.vaccines.OPV.remaining,20); assert.equal(service.getTransactions().length,0);
});


function auditButtonHarness(result = approved) {
  const source = readFileSync(new URL('../src/components/VaccineAllocationChecker.tsx',import.meta.url),'utf8');
  const start = source.indexOf('const handleValidate =');
  const code = source.slice(start,source.indexOf('// Confirm Order & Update Allocation',start));
  let validations = 0, deductions = 0;
  const ids: string[] = [], errors: string[] = [];
  let uuid = 0;
  const context: any = vm.createContext({
    selectedFacilityId:'selected-facility', orderSource:'whatsapp',whatsappMessage:'OPV 10',fulfillmentConfirmation:'OPV [10/10]\nOPV Dropper [10/10]',ccaName:'Test CCA',fsAudit:null,
    manualAuditInFlight:{current:false},allocationUpdateInFlight:{current:false},manualAuditIdentity:{current:null},latestAuditInputKey:{current:'draft-key'},debounceTimerRef:{current:null},
    crypto:{randomUUID(){return String(++uuid);}},clearTimeout,
    async authFetch(_url:string,options:any){validations++;ids.push(JSON.parse(options.body).checkId);return new Response(JSON.stringify(result));},
    async handleConfirmOrder(audit:any,snapshot:any){deductions++;assert.equal(audit.auditLogId,result.auditLogId);assert.equal(snapshot.facilityId,result.facilityId);},
    setValidationError(message:string){if(message)errors.push(message);},setSelectedFacilityId(){},setValidating(){},setIsStaleValidation(){},setValidationResult(){},setConfirmationSuccess(){},setConfirmationError(){}
  });
  vm.runInContext(ts.transpile(code + '\nglobalThis.runAudit = handleValidate;'),context);
  return {context,ids,errors,get validations(){return validations;},get deductions(){return deductions;}};
}

test('button-run successful audit deducts automatically, while typing rechecks and failed audits do not', async () => {
  const preview = auditButtonHarness(); await preview.context.runAudit(); assert.equal(preview.deductions,0);
  const button = auditButtonHarness(); await button.context.runAudit(true); assert.equal(button.deductions,1);
  const failed = auditButtonHarness({...approved,isValid:false}); await failed.context.runAudit(true);assert.equal(failed.deductions,0);
});

test('changed inputs while audit is pending cannot deduct stale quantities', async () => {
  const app = auditButtonHarness();
  app.context.authFetch = async () => { app.context.latestAuditInputKey.current='edited-draft';return new Response(JSON.stringify(approved)); };
  await app.context.runAudit(true);assert.equal(app.deductions,0);assert.match(app.errors.join(' '),/inputs changed/);
});

test('concurrent clicks submit one audit; retrying the same draft keeps its identity', async () => {
  const app = auditButtonHarness();
  await Promise.all([app.context.runAudit(true),app.context.runAudit(true)]);
  assert.equal(app.validations,1);assert.equal(app.deductions,1);
  await app.context.runAudit(true); assert.equal(app.ids[0],app.ids[1]);
  app.context.latestAuditInputKey.current='new-draft';
  await app.context.runAudit(true); assert.notEqual(app.ids[1],app.ids[2]);
});

test('failed atomic save publishes no deduction or success and the same audit can retry', async () => {
  const app = confirmationHarness(true);
  const response = await app.confirm();
  assert.equal(response.status,503);
  assert.match(response.body.error,/No deduction was applied/);
  assert.equal(response.body.success,undefined);
  assert.equal(app.row.vaccines.OPV.balance,90);
  assert.equal(service.getFacilityById(app.facilityId)!.vaccines.OPV.remaining,90);
  assert.equal(service.getTransactions().length,0);
  assert.equal(service.getAuditLog('deduction-audit')!.confirmed,false);
  assert.equal(app.records.size,1);
  app.setFailWrites(false);
  assert.equal((await app.confirm()).status,200);
  assert.equal(app.row.vaccines.OPV.balance,80);
  assert.equal(service.getTransactions().length,1);
});

test('refreshing after an auto-resolved audit keeps the audited facility selected', async () => {
  const source = readFileSync(new URL('../src/components/VaccineAllocationChecker.tsx',import.meta.url),'utf8');
  const start = source.indexOf('const fetchFacilities =');
  const code = source.slice(start,source.indexOf('// Fetch audit logs',start));
  let selected = '';
  const context = vm.createContext({
    selectedFacilityId:'',
    async authFetch(){return new Response(JSON.stringify([{id:'first',facilityName:'First Clinic'},{id:'audited',facilityName:'Audited Clinic'}]));},
    setFacilities(){},setLoadingFacilities(){},setSelectedFacilityId(id:string){selected=id;},console
  });
  vm.runInContext(ts.transpile(code + '\nglobalThis.refresh = fetchFacilities;'),context);
  await context.refresh(false,'audited');
  assert.equal(selected,'audited');
});

test('same-named facilities stay separate across districts and allocation months', async () => {
  service.clearAllAllocations({clearHistory:true});
  const sheets = [
    {id:'east-september',district:'East Mamprusi',month:'September 2026',remaining:9},
    {id:'west-september',district:'West Mamprusi',month:'September 2026',remaining:20},
    {id:'west-october',district:'West Mamprusi',month:'October 2026',remaining:30}
  ];
  service.syncAllDistrictsToFacilities(sheets.map(sheet => ({sourceSheetId:sheet.id,facility:'Gbangu CHPS',district:sheet.district,cycle:sheet.month,tabName:`${sheet.district} Allocation`,vaccine:'IPV',allocation:sheet.remaining,remaining:sheet.remaining})),'unit test');
  const facilities = service.getAllFacilities();
  assert.equal(facilities.length,3);
  assert.equal(new Set(facilities.map(facility => facility.id)).size,3);
  const selected = facilities.find(facility => facility.sourceSheetId === 'west-october')!;
  const audit = service.validateVaccineOrder({facilityId:selected.id,orderSource:'whatsapp',whatsappMessage:'IPV 4',fulfillmentConfirmation:'Facility: Gbangu CHPS\nIPV [4/4]',checkId:'scoped-deduction'});
  assert.equal(audit.isValid,true,JSON.stringify(audit.errors));
  const confirmation = await service.confirmVaccineOrder({facilityId:selected.id,orderSource:'whatsapp',items:[{vaccine:'IPV',currentOrder:4}],ccaUser:'Test CCA',orderId:audit.auditLogId});
  assert.equal(confirmation.success,true);
  assert.deepEqual(facilities.map(facility => facility.vaccines.IPV.remaining),[9,20,26]);

  const blueprintSheets = sheets.map(sheet => ({...sheet,rows:[{facility:'Gbangu CHPS'}]}));
  assert.equal(resolveBlueprintFacility(blueprintSheets,{facilityName:selected.facilityName,sheetId:selected.sourceSheetId,district:selected.district,cycle:selected.cycle}).sheet.id,'west-october');
  assert.throws(() => resolveBlueprintFacility(blueprintSheets,{facilityName:selected.facilityName,sheetId:'missing-sheet'}),new RegExp(FACILITY_NOT_FOUND));
});

test('Blueprint opens the checker-selected sheet instead of the previously active district', async () => {
  const source = readFileSync(new URL('../src/components/VaccineAllocationBlueprint.tsx',import.meta.url),'utf8');
  const start = source.indexOf('const loadBlueprintFromServer =');
  const code = source.slice(start,source.indexOf('const handleSwitchDistrict',start));
  let selected = '', rows:any[]=[];
  const noOp = () => {};
  const context = vm.createContext({
    preferredSheetId:'east',setBlueprintLoadError:noOp,historyResetPendingRef:{current:false},DEFAULT_BLUEPRINT_PRODUCTS:[],DEFAULT_BLUEPRINT_HEADER_LABELS:[],
    async safeFetchJson(){return {activeDistrictId:'west',districts:[{id:'west',district:'West',rows:[{balance:3}]},{id:'east',district:'East',rows:[{balance:1}]}]};},
    setLoading:noOp,setDistricts:noOp,setActiveDistrictId(id:string){selected=id;},setDistrict:noOp,setMonth:noOp,setProducts:noOp,
    setRows(value:any[]){rows=value;},normalizeBlueprintRowsProgress(value:any[]){return value;},setCellMerges:noOp,setHeaderLabels:noOp,setActiveHeaderCell:noOp,
    updateDeletedColumns:noOp,setHiddenRowIds:noOp,setMergeHeaders:noOp,setFreezeRows:noOp,setFreezeColumns:noOp,initializeDefaultRows(){throw new Error('Unexpected default sheet');},console
  });
  vm.runInContext(ts.transpile(code+'\nglobalThis.load = loadBlueprintFromServer;'),context);
  await context.load();assert.equal(selected,'east');assert.equal(rows[0].balance,1);
  context.preferredSheetId='deleted';await context.load();assert.equal(selected,'west');
});

test('missing or ambiguous cloud rows never save or publish a deduction', async () => {
  for (const ambiguous of [false,true]) {
    const app = confirmationHarness();
    const sheet = app.records.get('vaccine_districts/test-sheet');
    sheet.rows = ambiguous ? [sheet.rows[0],structuredClone(sheet.rows[0])] : [];
    const response = await app.confirm();
    assert.equal(response.status,ambiguous ? 409 : 404);
    assert.equal(response.body.error,ambiguous ? FACILITY_AMBIGUOUS : FACILITY_NOT_FOUND);
    assert.equal(app.writes.length,0);assert.equal(app.row.vaccines.OPV.balance,90);
    assert.equal(service.getTransactions().length,0);
  }
});

test('Firestore balances are authoritative when the local sheet is stale', async () => {
  const app = confirmationHarness();
  const remote = app.records.get('vaccine_districts/test-sheet').rows[0].vaccines.OPV;
  Object.assign(remote,{distributed:30,balance:70,takenHistory:'10 + 20'});
  assert.equal((await app.confirm()).status,200);
  assert.equal(app.row.vaccines.OPV.balance,60);assert.equal(app.row.vaccines.OPV.distributed,40);
  assert.equal(app.row.vaccines.OPV.allocation,100);
  assert.equal(app.row.vaccines.OPV.takenHistory,'10 + 20 + 10');
});

test('pending Firestore commit leaves the displayed ledger and audit unconfirmed', async () => {
  const app = confirmationHarness();
  let reached!: () => void, release!: () => void;
  const pending = new Promise<void>(resolve => {release=resolve;});
  const reachedCommit = new Promise<void>(resolve => {reached=resolve;});
  app.setBeforeCommit(async () => {reached();await pending;});
  const confirmation = app.confirm();await reachedCommit;
  assert.equal(app.row.vaccines.OPV.balance,90);
  assert.equal(service.getFacilityById(app.facilityId)!.vaccines.OPV.remaining,90);
  assert.equal(service.getTransactions().length,0);
  assert.equal(service.getAuditLog('deduction-audit')!.confirmed,false);
  release();assert.equal((await confirmation).status,200);
  assert.equal(app.row.vaccines.OPV.balance,80);
});

test('a persisted audit remains idempotent after the local transaction cache is cleared', async () => {
  const app = confirmationHarness();await app.confirm();
  service.clearAllAllocations({clearHistory:true});
  assert.equal((await app.confirm()).status,200);
  assert.equal(app.row.vaccines.OPV.balance,80);
  assert.equal(app.writes.length,3);
  assert.equal(service.getTransactions().length,1);
});

test('frontend failed-save handling preserves order text and shows no success state', async () => {
  const source = readFileSync(new URL('../src/components/VaccineAllocationChecker.tsx',import.meta.url),'utf8');
  const start = source.indexOf('const handleConfirmOrder =');
  const code = source.slice(start,source.indexOf('// Handle Unrelieved Top-Up',start));
  let customer='OPV 10',fulfilment='OPV [10/10]\nOPV Dropper [10/10]',success:any='previous-success',error='';
  const noOp = () => {};
  const context = vm.createContext({
    validationResult:approved,isStaleValidation:false,allocationUpdateInFlight:{current:false},latestAuditInputKey:{current:'draft'},selectedFacilityId:'resolved-facility',orderSource:'whatsapp',whatsappMessage:customer,fulfillmentConfirmation:fulfilment,ccaName:'Test CCA',manualAuditIdentity:{current:{key:'draft',id:'same-audit'}},
    setConfirming:noOp,setConfirmationSuccess(value:any){success=value;},setConfirmationError(value:string){error=value;},
    async handleValidate(){return approved;},async deductValidatedVaccineAudit(){throw new Error('Could not save the order to Firestore. No deduction was applied. Your order is preserved; please retry.');},
    setWhatsappMessage(value:string){customer=value;},setFulfillmentConfirmation(value:string){fulfilment=value;},
    setShowReviewModal:noOp,setOrderSource:noOp,setSelectedFacilityId:noOp,setFacilities:noOp,setValidationResult:noOp,
    setValidationError:noOp,setIsStaleValidation:noOp,setFacilitySearch:noOp,setSelectedWorksheetFilter:noOp,setSelectedDistrictFilter:noOp,
    setIsFacilityDropdownOpen:noOp,setAuditMatrixFilter:noOp,setVaccineTableSearch:noOp,setUnitDisplayMode:noOp,async fetchFacilities(){throw new Error('Unexpected refresh after failed save');}
  });
  vm.runInContext(ts.transpile(code+'\nglobalThis.confirm = handleConfirmOrder;'),context);
  await context.confirm();
  assert.equal(success,null);assert.match(error,/please retry/);
  assert.equal(customer,'OPV 10');assert.equal(fulfilment,'OPV [10/10]\nOPV Dropper [10/10]');
  assert.equal(context.manualAuditIdentity.current.id,'same-audit');
});

test('sheet/row document identity is stable through name formatting and avoids punctuation collisions', () => {
  const rows = ['row:a','row_a'].map(sourceRowId => ({sourceSheetId:'sheet',sourceRowId,facility:'Wundua CHPS',vaccine:'IPV',allocation:20,remaining:20}));
  service.syncAllDistrictsToFacilities(rows,'unit test');
  const first = service.getAllFacilities().map(facility => facility.id);
  assert.equal(new Set(first).size,2);
  assert.ok(first.every(id => id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id)));
  service.syncAllDistrictsToFacilities(rows.map(row => ({...row,facility:'WUNDUA  CHPS'})),'unit test');
  assert.deepEqual(service.getAllFacilities().map(facility => facility.id),first);
});
