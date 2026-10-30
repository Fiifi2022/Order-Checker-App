import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupFsAllocation} from './fsAllocation';
import {fsContextHandlers} from './fsContext';
const sheet=(id:string,month:string,balance:number)=>({id,month,district:'East Mamprusi',region:'North East',rows:[{id:'gbangu',facility:'Gbangu CHPS',vaccines:{BCG:{allocation:balance,balance}}}]});
const september=sheet('east','September 2026',4),november=sheet('east-nov','November 2026',9);
const input={facility:{name:'Gbangu CHPS',district:'East Mamprusi',region:'North East'},products:[{name:'Bacille Calmette-Guerin Vaccine',quantity:'1'}]};
const october={automaticCycle:true,now:new Date('2026-10-27T15:00:00Z')};

test('Gbangu automatically uses latest started saved cycle and never combines future carry-over',()=>{
 const sheets=[september,november],before=JSON.stringify(sheets);
 const result=lookupFsAllocation(sheets,input,october);
 assert.equal(result.status,'matched');assert.equal(result.facility.sourceSheetId,'east');assert.equal(result.facility.cycle,'September 2026');assert.equal(result.products[0].balance,4);
 const roll=lookupFsAllocation(sheets,input,{automaticCycle:true,now:new Date('2026-11-01T00:00:00Z')});
 assert.equal(roll.facility.sourceSheetId,'east-nov');assert.equal(roll.products[0].balance,9);
 assert.equal(JSON.stringify(sheets),before);
});

test('current saved cycle wins over older cycles even when its balance is zero',()=>{
 const current=sheet('east-oct','October 2026',0);
 const result=lookupFsAllocation([september,current,november],input,october);
 assert.equal(result.facility.sourceSheetId,'east-oct');assert.equal(result.products[0].balance,0);
 const dec=sheet('dec','December 2026',8),jan=sheet('jan','January 2027',12);
 assert.equal(lookupFsAllocation([dec,jan],input,{automaticCycle:true,now:new Date('2027-01-01T00:00:00Z')}).facility.sourceSheetId,'jan');
});

test('future-only, duplicate current cycles, conflicting geography and unknown cycle labels never silently choose a balance',()=>{
 const future=lookupFsAllocation([november],input,october);assert.equal(future.status,'cycle_not_started');assert.equal(future.products[0].balance,null);
 const duplicate=lookupFsAllocation([september,{...september,id:'copy'},november],input,october);
 assert.equal(duplicate.status,'ambiguous');assert.doesNotMatch(duplicate.message,/manually/);
 const unknown=lookupFsAllocation([september,sheet('unknown','Allocation A',3)],input,october);assert.equal(unknown.status,'ambiguous');
 const other={...november,district:'Another District',region:'Another Region'};
 assert.equal(lookupFsAllocation([september,other],{...input,facility:{name:'Gbangu CHPS'}},october).status,'ambiguous');
 assert.equal(lookupFsAllocation([{...november,archived:true},september],input,october).facility.sourceSheetId,'east');
});

test('automatic backend policy ignores a stale manual future choice and remains scoped to exact facility geography',()=>{
 assert.equal(lookupFsAllocation([september,november],{...input,manualFacilityId:'east-nov:gbangu'},october).facility.sourceSheetId,'east');
 assert.equal(lookupFsAllocation([september],{...input,facility:{...input.facility,district:'Other'}},october).status,'not_found');
});

test('FS context resolves cycles in the backend without any open Blueprint page or page selection',async()=>{
 let payload:any,status=200,reads=0;
 const context=fsContextHandlers({readSheets:async()=>{reads++;return[september,november];},readCatalog:async()=>({}),applyCatalog(){},now:()=>october.now,log(){}}).context;
 const response:any={setHeader(){},status(value:number){status=value;return this;},json(value:any){payload=value;}};
 await context({query:{selection:JSON.stringify(input)}} as any,response,()=>{});
 assert.equal(status,200);assert.equal(payload.status,'matched');assert.equal(payload.products[0].balance,4);assert.equal(payload.facility.sourceSheetId,'east');assert.equal(reads,1);
});

test('explicit user cycle overrides automatic resolution including future cycles, without fallback or mixed balances',()=>{
 const selected={...input,allocationCycle:'November 2026'};
 const result=lookupFsAllocation([september,november],selected,october);
 assert.equal(result.facility.sourceSheetId,'east-nov');assert.equal(result.products[0].balance,9);
 assert.equal(lookupFsAllocation([september,november],{...input,allocationCycle:'Nov 2026'},october).facility.sourceSheetId,'east-nov');
 assert.equal(lookupFsAllocation([september,november],{...input,allocationCycle:'December 2026'},october).status,'not_found');
 assert.equal(lookupFsAllocation([september],selected,october).products[0].balance,null);
 assert.equal(lookupFsAllocation([november,{...november,id:'duplicate'}],selected,october).status,'ambiguous');
});

test('context validates selected cycle and applies it on the actual FS endpoint',async()=>{
 let payload:any,status=200;
 const context=fsContextHandlers({readSheets:async()=>[september,november],readCatalog:async()=>({}),applyCatalog(){},now:()=>october.now,log(){}}).context;
 const response:any={setHeader(){},status(code:number){status=code;return this;},json(value:any){payload=value;}};
 await context({query:{selection:JSON.stringify({...input,allocationCycle:'November 2026'})}} as any,response,()=>{});
 assert.equal(status,200);assert.equal(payload.facility.sourceSheetId,'east-nov');
 await context({query:{selection:JSON.stringify({...input,allocationCycle:[]})}} as any,response,()=>{});assert.equal(status,400);
});
