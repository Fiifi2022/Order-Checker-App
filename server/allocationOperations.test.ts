import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {allocationArithmetic,allocationNumber,allocationUnit,allocationDoseFactor,inspectAllocationSheet,allocationFacilityAttention,allocationImportPreview,allocationSheetChanges,planAllocationCycle,transitionAllocationCycle,applyAllocationAdjustment,assertAllocationEditable,type AllocationSheet} from '../shared/allocationOperations';
import {validateAllocationUpdate,stageAllocationTransition,allocationOperationsHandlers} from './allocationOperations';
import {assertBlueprintActive} from './blueprintFacility';
import {applyConfirmedDhdTopUp} from './dhdInventory';
import Operations from '../src/components/AllocationOperations';
import type {CatalogProduct} from '../shared/productCatalog';

const products:CatalogProduct[]=[{id:'bcg',name:'BCG',scope:'vaccine',category:'vaccine',aliases:['BCG Vaccine'],contextualAliases:[],note:''},{id:'diluent',name:'BCG Diluent',scope:'vaccine',category:'companion',aliases:[],contextualAliases:[],note:''}];
const sheet=():AllocationSheet=>({id:'north_oct',district:'North',month:'October 2026',worksheetRole:'allocation',updatedAt:'v1',products:['BCG'],rows:[{id:'row',facility:'Example HC',subDistrict:'North Sub',vaccines:{BCG:{carryOver:5,allocation:10,distributed:3,balance:12,dhdTopUpTotal:2}}}]});

test('reconciliation preserves blank and zero, and never counts included top-ups twice',()=>{
 assert.equal(allocationNumber(''),null);assert.equal(allocationNumber('0'),0);assert.equal(allocationNumber('unknown'),null);
 const value=allocationArithmetic(sheet().rows[0].vaccines.BCG);assert.equal(value.expected,12);assert.equal(value.difference,0);
 assert.equal(allocationArithmetic({carryOver:'',allocation:10,distributed:0,balance:10}).expected,null);
 const bad=sheet();bad.rows[0].vaccines.BCG.balance=14;
 assert.ok(inspectAllocationSheet(bad,products).some(issue=>issue.code==='balance_mismatch'));
 assert.equal(inspectAllocationSheet(sheet(),products).some(issue=>issue.code==='balance_mismatch'),false);
});
test('Blueprint health finds duplicate facilities, invalid quantities, incomplete records and unknown products',()=>{
 const input=sheet();input.rows.push({...structuredClone(input.rows[0]),id:'second',facility:'Example Health Centre'});
 input.rows[0].vaccines.BCG.distributed=30;input.rows[0].vaccines.BCG.balance=-15;
 input.products!.push('Unknown Vaccine');input.rows[1].vaccines.BCG.carryOver='';
 const codes=new Set(inspectAllocationSheet(input,products).map(issue=>issue.code));
 for(const code of ['duplicate_facility','invalid_quantity','over_distributed','incomplete_quantities','unknown_product'])assert.ok(codes.has(code),code);
});
test('companion shortages are warnings, not invented accessory allocations',()=>{
 const input=sheet(),before=JSON.stringify(input);
 assert.ok(inspectAllocationSheet(input,products).some(issue=>issue.code==='companion_shortage'));
 input.rows[0].vaccines['BCG Diluent']={carryOver:0,allocation:12,distributed:0,balance:12};
 assert.ok(!inspectAllocationSheet(input,products).some(issue=>issue.code==='companion_shortage'));
 assert.equal(sheet().rows[0].vaccines['BCG Diluent'],undefined);assert.ok(before.includes('BCG'));
});
test('attention and coverage distinguish exhausted, untouched and incomplete facility-cycle records',()=>{
 const input=sheet(),row=input.rows[0];row.vaccines.BCG={carryOver:0,allocation:5,distributed:0,balance:5};
 const initial=allocationFacilityAttention(input,row,inspectAllocationSheet(input));assert.equal(initial.noDistribution,true);assert.equal(initial.exhausted,false);
 row.vaccines.BCG.distributed=5;row.vaccines.BCG.balance=0;
 const complete=allocationFacilityAttention(input,row,inspectAllocationSheet(input));assert.equal(complete.hasDistribution,true);assert.equal(complete.exhausted,true);
 row.vaccines.BCG.allocation='';assert.equal(allocationFacilityAttention(input,row,inspectAllocationSheet(input)).incomplete,true);
});
test('vials, pieces and configured dose equivalents stay separate',()=>{
 assert.equal(allocationUnit('BCG'),'vials');assert.equal(allocationUnit('BCG Diluent'),'vials');assert.equal(allocationUnit('Soloshot 0.5ml'),'pieces');assert.equal(allocationUnit('OPV Dropper'),'pieces');
 assert.equal(allocationDoseFactor('BCG Vaccine',products,{BCG:20}),20);
 assert.equal(allocationDoseFactor('Unknown Vaccine',products,{BCG:20}),null);
 assert.equal(allocationDoseFactor('BCG Diluent',products,{BCG:20}),null);
});
test('imports preview new, removed and changed facilities without mutating either source',()=>{
 const before=sheet(),incoming=structuredClone(before);incoming.rows[0].vaccines.BCG.allocation=20;incoming.rows[0].vaccines.BCG.balance=22;
 incoming.rows.push({id:'new',facility:'New CHPS',vaccines:{}});
 const saved=JSON.stringify([before,incoming]),preview=allocationImportPreview([before],[incoming],products)[0];
 assert.deepEqual(preview.newFacilities,['New CHPS']);assert.ok(preview.changes.some(change=>change.field==='allocation'&&change.before===10&&change.after===20));
 assert.equal(JSON.stringify([before,incoming]),saved);
 assert.ok(allocationImportPreview([{...before,cycleState:'closed'}],[incoming])[0].findings.some(issue=>issue.code==='closed_cycle'));
});
test('new cycles preview exact reconciled carry-over, preserve unknowns, start draft and cannot duplicate a month',()=>{
 const current=sheet();current.rows.push({id:'unknown',facility:'Unknown CHPS',vaccines:{BCG:{carryOver:'',allocation:10,distributed:'',balance:10}}});
 const [next]=planAllocationCycle([current],{districtId:current.id,month:'November 2026'});
 assert.equal(next.cycleState,'draft');assert.equal(next.rows[0].vaccines.BCG.carryOver,12);assert.equal(next.rows[0].vaccines.BCG.allocation,0);assert.equal(next.rows[1].vaccines.BCG.carryOver,'');assert.equal(next.sourceUpdatedAt,'v1');
 assert.throws(()=>planAllocationCycle([current,next],{districtId:current.id,month:'November 2026'}),{status:409});
 assert.throws(()=>planAllocationCycle([current],{districtId:current.id,month:'September 2026'}),{status:409});
 const future={...current,id:'future',month:'December 2026',cycleState:'draft' as const};
 assert.equal(planAllocationCycle([current,future],{districtId:current.id,month:'November 2026',scope:'all'})[0].sourceSheetId,current.id);
});
test('cycle lifecycle preserves legacy active sheets, locks closed cycles and records a reopening reason',()=>{
 const input=sheet();assert.doesNotThrow(()=>assertBlueprintActive(input));
 const draft={...input,cycleState:'draft' as const};assert.throws(()=>assertBlueprintActive(draft),/inactive/);
 const active=transitionAllocationCycle(draft,'active','','editor');const closed=transitionAllocationCycle(active,'closed','','editor');
 assert.throws(()=>assertBlueprintActive(closed),/inactive/);
 assert.throws(()=>stageAllocationTransition(closed,'draft','short',closed.updatedAt,'editor'),{status:400});
 const reopened=stageAllocationTransition(closed,'draft','Correcting an approved allocation error',closed.updatedAt,'editor');
 assert.equal(reopened.cycleState,'draft');assert.throws(()=>assertBlueprintActive(reopened),/inactive/);
 assert.equal(reopened.cycleChangedBy,'editor');assert.match(reopened.cycleChangeReason,/Correcting/);
 assert.throws(()=>stageAllocationTransition(closed,'draft','Correcting an approved allocation error','old-version','editor'),{status:409});
 const inconsistent={...closed,rows:structuredClone(closed.rows)};inconsistent.rows[0].vaccines.BCG.balance=999;
 const correction=stageAllocationTransition(inconsistent,'draft','Investigating an incorrect saved balance',inconsistent.updatedAt,'editor');
 assert.equal(correction.cycleState,'draft');assert.throws(()=>transitionAllocationCycle(correction,'active','','editor'),{status:409});
});
test('closed-cycle state and newer allocations cannot be bypassed by a save payload',()=>{
 const closed={...sheet(),cycleState:'closed' as const};
 assert.throws(()=>validateAllocationUpdate(closed,{...closed,cycleState:'active'}),{status:409});
 assert.throws(()=>validateAllocationUpdate(sheet(),{...sheet(),expectedUpdatedAt:'outdated'}),{status:409});
 assert.equal(validateAllocationUpdate(undefined,{...sheet(),cycleState:'active'}).cycleState,'draft');
 assert.equal(validateAllocationUpdate(sheet(),{...sheet(),cycleState:'closed',expectedUpdatedAt:'v1'}).cycleState,'active');
});
test('quota adjustments reconcile in native units, retain baseline information and cannot overdraw',()=>{
 const current=sheet(),updated=applyAllocationAdjustment(current,'row','BCG',4,'Approved additional monthly supply');
 assert.equal(updated.rows[0].vaccines.BCG.allocation,14);assert.equal(updated.rows[0].vaccines.BCG.allocationAdjustmentTotal,4);assert.equal(updated.rows[0].vaccines.BCG.balance,16);
 assert.equal(allocationArithmetic(updated.rows[0].vaccines.BCG).difference,0);assert.equal(current.rows[0].vaccines.BCG.allocation,10);
 assert.throws(()=>applyAllocationAdjustment(current,'row','BCG',-20,'Approved reduction in allocation'),{status:409});
 assert.throws(()=>applyAllocationAdjustment({...current,cycleState:'closed'},'row','BCG',4,'Approved additional monthly supply'),{status:409});
});
test('new top-ups cannot alter a closed cycle',()=>{
 const current=sheet();const result=applyConfirmedDhdTopUp({sheet:{...current,products:['BCG'],cycleState:'closed'} as any,inventory:{district:'North',stocks:{BCG:20},history:[],updatedAt:''},rowId:'row',vaccine:'BCG',quantity:2,distributedAfter:4,requestId:'new',user:'editor'});
 assert.equal(result.success,false);if(!result.success)assert.equal(result.status,409);
});
test('lifecycle and history endpoints enforce roles, exact rows, error categorisation and no-cache',async()=>{
 let writes=0,status=200,body:any;
 const handlers=allocationOperationsHandlers({read:async()=>sheet(),history:async()=>({events:[],transactions:[]}),transition:async(_id,state,reason,expected,actor)=>{writes++;return stageAllocationTransition(sheet(),state,reason,expected,actor);}});
 const response:any={locals:{authUser:{role:'cca',email:'member'}},setHeader(){},status(value:number){status=value;return this;},json(value:any){body=value;}};
 await handlers.lifecycle({params:{id:'north_oct'},body:{state:'closed',expectedUpdatedAt:'v1'}} as any,response,()=>{});assert.equal(status,403);assert.equal(writes,0);
 response.locals.authUser.role='warehouse';status=200;
 await handlers.lifecycle({params:{id:'north_oct'},body:{state:'closed',expectedUpdatedAt:'v1'}} as any,response,()=>{});assert.equal(status,200);assert.equal(body.saved,true);assert.equal(body.sheet.cycleState,'closed');
 await handlers.history({params:{id:'north_oct'},query:{rowId:'other'}} as any,response,()=>{});assert.equal(status,404);
 await handlers.history({params:{id:'north_oct'},query:{rowId:'row',cursor:'{"events":"../other","transactions":null}'}} as any,response,()=>{});assert.equal(status,400);
});
test('operations UI labels shared selection and exposes upgrade navigation without mixed-unit totals',()=>{
 const html=renderToStaticMarkup(createElement(Operations,{sheets:[sheet()]}));
 assert.match(html,/Allocation workspace/);assert.match(html,/Health, facilities, cycles and history/);assert.match(html,/Facility:.*Not selected/);
});

test('cycle creation rejects stale carry-over sources and publishes only after successful atomic persistence',async()=>{
 const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');const start=source.indexOf('// Preview and commit share');const code=source.slice(start,source.indexOf('// ADD a new district',start));
 const current=sheet(),records=new Map<string,any>([[current.id,structuredClone(current)]]),routes=new Map<string,any>();let fail=false;
 const context=vm.createContext({app:{post:(path:string,handler:any)=>routes.set(path,handler)},blueprintDistricts:{[current.id]:current},activeDistrictId:current.id,planAllocationCycle,
  async loadDistrictsFromFirestore(){context.blueprintDistricts=Object.fromEntries([...records].filter(([id])=>!id.includes('/')));},cleanFirestorePayload:(value:any)=>JSON.parse(JSON.stringify(value)),randomUUID:()=>String(Math.random()),
  adminDb:{collection(){return {doc(id:string){return {id,collection(){return {doc:(event:string)=>({id:`${id}/${event}`})};}};}};}},
  async runAdminTransaction(callback:any){const staged=new Map<string,any>();const result=await callback({get:async(ref:any)=>({exists:records.has(ref.id),data:()=>records.get(ref.id)}),set:(ref:any,value:any)=>staged.set(ref.id,value)});if(fail)throw Error('offline');for(const [id,value] of staged)records.set(id,value);return result;},syncAllBlueprintDistrictsToService(){},vaccineService:{getAllFacilities(){return[];}}});
 vm.runInContext(ts.transpile(code,{target:ts.ScriptTarget.ES2022}),context);
 const request=async(path:string,body:any)=>{let status=200,result:any;await routes.get(path)({body},{locals:{authUser:{email:'editor'}},status(value:number){status=value;return this;},json(value:any){result=value;return this;}});return {status,result};};
 const input={districtId:current.id,month:'November 2026'},preview=await request('/api/vaccine/blueprint-months/preview',input);assert.equal(preview.result.saved,false);assert.equal(records.size,1);
 records.get(current.id).updatedAt='v2';
 const stale=await request('/api/vaccine/blueprint-months/add',{...input,sourceVersions:[{id:current.id,updatedAt:'v1'}]});assert.equal(stale.status,409);assert.equal(records.size,1);
 fail=true;const failed=await request('/api/vaccine/blueprint-months/add',{...input,sourceVersions:[{id:current.id,updatedAt:'v2'}]});assert.equal(failed.status,503);assert.equal(records.size,1);
 fail=false;const saved=await request('/api/vaccine/blueprint-months/add',{...input,sourceVersions:[{id:current.id,updatedAt:'v2'}]});assert.equal(saved.status,200);assert.equal(saved.result.district.cycleState,'draft');assert.ok(records.size>1);
});

function mutationHarness() {
 const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8'),current=sheet();
 const records=new Map<string,any>([[`vaccine_districts/${current.id}`,structuredClone(current)]]),routes=new Map<string,any>();let fail=false,writes=0;
 const collection=(path:string):any=>({doc:(id:string)=>({id,path:`${path}/${id}`,collection:(name:string)=>collection(`${path}/${id}/${name}`)})});
 const context=vm.createContext({app:{post:(path:string,handler:any)=>routes.set(path,handler),patch:(path:string,handler:any)=>routes.set(path,handler)},
  structuredClone,blueprintDistricts:{[current.id]:structuredClone(current)},adminDb:{collection},validateAllocationUpdate,allocationSheetChanges,assertAllocationEditable,applyAllocationAdjustment,createHash,
  randomUUID:()=>String(Math.random()),cleanFirestorePayload:(value:any)=>JSON.parse(JSON.stringify(value)),async ensureBlueprintLoaded(){},
  async runAdminTransaction(callback:any){const staged=new Map<string,any>();const result=await callback({get:async(ref:any)=>({exists:records.has(ref.path),data:()=>structuredClone(records.get(ref.path))}),set:(ref:any,value:any)=>staged.set(ref.path,value)});if(fail)throw Error('offline');for(const [id,value] of staged){records.set(id,value);writes++;}return result;},
  syncAllBlueprintDistrictsToService(){},findMatchingVaccineKeyInBlueprint:(_values:any,name:string)=>name,
  vaccineService:{getFacilityById:(id:string)=>id==='facility'?{id,sourceSheetId:current.id,sourceRowId:'row'}:undefined,matchVaccineName:(name:string)=>({canonical:name,confidence:['BCG','OPV'].includes(name)?'exact':'none'}),getDosesPerVial:()=>20}});
 const start=source.indexOf('async function changeSavedAllocationSheets');vm.runInContext(ts.transpile(source.slice(start,source.indexOf('// Helper: Continuously sync',start)),{target:ts.ScriptTarget.ES2022}),context);
 const begin=source.indexOf('// Legacy editor controls use canonical');vm.runInContext(ts.transpile(source.slice(begin,source.indexOf("app.post('/api/vaccine/validate'",begin)),{target:ts.ScriptTarget.ES2022}),context);
 const adjust=source.indexOf("app.post('/api/vaccine/adjust'");vm.runInContext(ts.transpile(source.slice(adjust,source.indexOf('// Fetch transaction history',adjust)),{target:ts.ScriptTarget.ES2022}),context);
 return {records,context,get writes(){return writes;},setFail(value:boolean){fail=value;},async request(path:string,body:any,params={facilityId:'facility',id:'facility'}){
   let status=200,result:any;await routes.get(path)({body,params},{locals:{authUser:{email:'verified-editor',name:'Verified Editor'}},status(value:number){status=value;return this;},json(value:any){result=value;return this;}});return {status,result};
 }};
}
test('facility edits and top-ups persist with the Blueprint and actor history, including failed-save protection',async()=>{
 const app=mutationHarness();
 app.setFail(true);const failed=await app.request('/api/vaccine/facilities/:id',{facilityName:'Changed HC'});
 assert.equal(failed.status,503);assert.equal(app.records.get('vaccine_districts/north_oct').rows[0].facility,'Example HC');assert.equal(app.context.blueprintDistricts.north_oct.rows[0].facility,'Example HC');
 app.setFail(false);const saved=await app.request('/api/vaccine/facilities/:id',{facilityName:'Changed HC'});assert.equal(saved.status,200);
 assert.equal(app.records.get('vaccine_districts/north_oct').rows[0].id,'row');
 const topUp=await app.request('/api/vaccine/allocations/:facilityId/topup',{vaccine:'BCG',topUp:3,unit:'vials',user:'FORGED'});assert.equal(topUp.status,200);
 assert.equal(app.records.get('vaccine_districts/north_oct').rows[0].vaccines.BCG.balance,15);
 assert.ok([...app.records].some(([path,event])=>path.includes('allocation_events')&&event.actor==='verified-editor'&&event.kind==='facility_top_up'));
 assert.equal((await app.request('/api/vaccine/allocations/:facilityId/topup',{vaccine:'BCG',topUp:1,unit:'doses'})).status,400);
});
test('bulk sheet mutations read current cycle locks and cannot partially publish when one sheet is closed',async()=>{
 const app=mutationHarness(),other={...sheet(),id:'second',cycleState:'closed'};app.records.set('vaccine_districts/second',other);
 await assert.rejects(app.context.changeSavedAllocationSheets(['north_oct','second'],'editor','clear','Reviewed change',(sheet:any)=>({...sheet,rows:[]})),{status:409});
 assert.equal(app.records.get('vaccine_districts/north_oct').rows.length,1);assert.equal(app.writes,0);
});
test('recorded quota adjustments are idempotent and reject conflicting retries without double additions',async()=>{
 const app=mutationHarness(),input={sheetId:'north_oct',rowId:'row',vaccine:'BCG',adjustment:2,reason:'Approved additional allocation',requestId:'stable-request',expectedUpdatedAt:'v1',unit:'vials'};
 const first=await app.request('/api/vaccine/adjust',input);assert.equal(first.status,200);const writes=app.writes;
 const again=await app.request('/api/vaccine/adjust',input);assert.equal(again.status,200);assert.equal(app.writes,writes);
 assert.equal(app.records.get('vaccine_districts/north_oct').rows[0].vaccines.BCG.allocation,12);
 assert.equal((await app.request('/api/vaccine/adjust',{...input,adjustment:4})).status,409);assert.equal(app.writes,writes);
});
