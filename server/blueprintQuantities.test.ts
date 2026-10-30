import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintFacilityQuantities, facilityQuantitiesHandler } from './currentBlueprint';
import { needsProductCatalog } from './catalogReadPolicy';
const sheet={id:'east',month:'October 2026',rows:[{id:'one',facility:'Buzulungu CHPS',vaccines:{
 BCG:{allocation:4,carryOver:'',distributed:'',balance:4},
 OPV:{allocation:3,distributed:3,balance:0},
 HPV:{carryOver:14,allocation:2,distributed:3},
 R21:{allocation:'',carryOver:'',distributed:'',balance:''},
 Invalid:{allocation:'bad',balance:6},
}}]};
const selection={name:'Buzulungu CHPS',rowId:'one',cycle:'October 2026'};

test('saved Blueprint quantities preserve zero, carry-over and unknown cells without changing allocations',()=>{
 const before=JSON.stringify(sheet),result=blueprintFacilityQuantities(sheet,selection);
 assert.equal(result.sourceRowId,'one');assert.equal(result.cycle,'October 2026');
 assert.deepEqual(result.products.map(p=>[p.name,p.available]),[['BCG',4],['OPV',0],['HPV',13],['R21',null],['Invalid',null]]);
 assert.equal(result.products[0].taken,null);assert.equal(result.products[1].taken,3);
 assert.equal(JSON.stringify(sheet),before);
});

test('quantity reads require exact facility, row and cycle and reject inactive or duplicate records',()=>{
 for(const change of [{name:'Other CHPS'},{rowId:'wrong'},{cycle:'November 2026'}]) assert.throws(()=>blueprintFacilityQuantities(sheet,{...selection,...change}),/not found/);
 assert.throws(()=>blueprintFacilityQuantities({...sheet,archived:true},selection),/inactive/);
 assert.throws(()=>blueprintFacilityQuantities({...sheet,rows:[sheet.rows[0],sheet.rows[0]]},selection),/Multiple/);
 const legacy={...sheet,rows:[{...sheet.rows[0],id:undefined}]};
 assert.equal(blueprintFacilityQuantities(legacy,{...selection,rowId:''}).products[0].available,4);
});

async function readQuantities(read:any,query:any=selection,id='east') {
 let status=200,body:any; const headers:any={};
 await facilityQuantitiesHandler(read)({params:{id},query} as any,{setHeader(k:string,v:string){headers[k]=v;},status(code:number){status=code;return this;},json(value:any){body=value;}} as any,()=>{});
 return {status,body,headers};
}
test('quantity endpoint reads only the requested fresh sheet and fails clearly without catalogue dependency',async()=>{
 const ids:string[]=[];let balance=4;
 const read=async(id:string)=>{ids.push(id);return {...sheet,rows:[{...sheet.rows[0],vaccines:{BCG:{balance}}}]};};
 assert.equal((await readQuantities(read)).body.products[0].available,4);
 balance=2;const updated=await readQuantities(read);
 assert.equal(updated.body.products[0].available,2);assert.equal(updated.headers['Cache-Control'],'no-store');
 assert.deepEqual(ids,['east','east']);assert.equal(needsProductCatalog('GET','/vaccine/blueprint-districts/east/facility-quantities'),false);
 assert.equal((await readQuantities(async()=>null)).status,404);
 assert.equal((await readQuantities(async()=>{throw Error('database offline');})).status,503);
 assert.equal((await readQuantities(read,{...selection,rowId:'wrong'})).status,409);
 assert.equal((await readQuantities(read,{...selection,name:[]})).status,400);
 assert.equal((await readQuantities(read,selection,'invalid/path')).status,400);
});
