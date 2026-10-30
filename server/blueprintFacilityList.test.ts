import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintFacilityChoices } from './fsAllocation';
import { fsContextHandlers } from './fsContext';

const sheets=[{id:'east-oct',district:'East Mamprusi',region:'North East',month:'October 2026',rows:[
 {id:'allocated',facility:'Buzulungu CHPS',vaccines:{BCG:{balance:4}}},
 {id:'empty',facility:'New Facility HC',vaccines:{}},
 {id:'inactive',facility:'Closed HC',active:false,vaccines:{BCG:{balance:8}}},
 {facility:'Legacy HC',vaccines:{BCG:{balance:2}}}
]}];
const allocations=[{id:'fac-real-buzulungu',facilityName:'Buzulungu CHPS',sourceSheetId:'east-oct',sourceRowId:'allocated'},
 {id:'fac-real-legacy',facilityName:'Legacy HC',sourceSheetId:'east-oct'}];

test('facility search comes from active Blueprint rows and retains the audit allocation IDs',()=>{
 const before=JSON.stringify(sheets),choices=blueprintFacilityChoices(sheets,allocations);
 assert.equal(choices.length,3);assert.ok(!choices.some(row=>row.facilityName==='Closed HC'));
 const existing=choices.find(row=>row.facilityName==='Buzulungu CHPS')!;
 assert.equal(existing.id,'fac-real-buzulungu');assert.equal(existing.sourceSheetId,'east-oct');assert.equal(existing.sourceRowId,'allocated');
 assert.equal(existing.cycle,'October 2026');assert.equal(existing.district,'East Mamprusi');assert.equal(existing.region,'North East');
 const empty=choices.find(row=>row.facilityName==='New Facility HC')!;
 assert.equal(empty.id,'');assert.equal(empty.allocationAvailable,false);assert.match(empty.allocationNotice,/No vaccine allocation/);
 assert.equal(choices.find(row=>row.facilityName==='Legacy HC')!.id,'fac-real-legacy');
 assert.equal(JSON.stringify(sheets),before);
});

test('cycles remain distinct and ambiguous legacy names cannot silently select an allocation',()=>{
 const november={...sheets[0],id:'east-nov',month:'November 2026'};
 const choices=blueprintFacilityChoices([...sheets,november],[...allocations,{...allocations[0],id:'fac-nov',sourceSheetId:'east-nov'}]);
 assert.deepEqual(choices.filter(row=>row.facilityName==='Buzulungu CHPS').map(row=>row.id),['fac-real-buzulungu','fac-nov']);
 const duplicate={...sheets[0],rows:[{facility:'Legacy HC'},{facility:'Legacy Health Centre'}]};
 const ambiguous=blueprintFacilityChoices([duplicate],allocations);
 assert.ok(ambiguous.every(row=>!row.id&&!row.allocationAvailable));
 assert.ok(ambiguous.every(row=>/Multiple/.test(row.allocationNotice)));
 assert.deepEqual(blueprintFacilityChoices([{...sheets[0],archived:true}],allocations),[]);
});

test('facility listing works when catalogue access fails and reads fresh Blueprint rows on reload',async()=>{
 let catalogReads=0,reads=0,payload:any;
 const handlers=fsContextHandlers({readSheets:async()=>{reads++;return sheets;},readCatalog:async()=>{catalogReads++;throw Error('Catalogue quota unavailable');},applyCatalog(){throw Error('Facility listing must not load products');},listFacilities:rows=>blueprintFacilityChoices(rows,allocations)});
 const response:any={setHeader(name:string,value:string){assert.equal(name,'Cache-Control');assert.equal(value,'no-store');},json(value:any){payload=value;},status(){assert.fail('Blueprint listing should succeed independently of the catalogue');}};
 await handlers.facilities({} as any,response,()=>{});assert.equal(payload.length,3);
 await handlers.facilities({} as any,response,()=>{});assert.equal(reads,2);assert.equal(catalogReads,0);
});
