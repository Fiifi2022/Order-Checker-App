import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {setupVaccine} from './sidepanel-vaccine.js';
import {allocationCycleKey} from './allocation-cycle.js';
import {normalizeFacilities,VACCINE_API} from './sidepanel-vaccine-api.js';
const html=await readFile(new URL('./sidepanel.html',import.meta.url),'utf8');
const records=[
 {id:'east-sep',facilityName:'Gbangu CHPS',district:'East Mamprusi',subDistrict:'Gambaga',cycle:'September 2026',sourceSheetId:'east',sourceRowId:'g'},
 {id:'east-nov',facilityName:'Gbangu CHPS',district:'East Mamprusi',subDistrict:'Gambaga',cycle:'November 2026',sourceSheetId:'east-nov',sourceRowId:'g'},
 {id:'mmd-oct',facilityName:'Kubori HC',district:'MMD',cycle:'October 2026',sourceSheetId:'mmd',sourceRowId:'k'},
 {id:'',facilityName:'New HC',district:'MMD',cycle:'November 2026',sourceSheetId:'mmd-nov',sourceRowId:'new',allocationAvailable:false},
];
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('districts remain separate from subdistrict metadata; filtering, counts and show-all expose every saved row',async()=>{
 const normalized=normalizeFacilities(records);assert.equal(normalized.find(row=>row.id==='east-sep').districtName,'East Mamprusi');
 const {document,window}=parseHTML(html),previous={document:globalThis.document,chrome:globalThis.chrome,Event:globalThis.Event};
 const saved={[allocationCycleKey('http://localhost:3000')]:'September 2026'};
 globalThis.document=document;globalThis.Event=window.Event;
 globalThis.chrome={storage:{local:{async get(key,callback){callback?.({});return{[key]:saved[key]};},async set(value){Object.assign(saved,value);}}},runtime:{async sendMessage(){}}};
 try{
  const ui=setupVaccine({getBackendUrl:()=> 'http://localhost:3000',request:async()=>records});ui.activate();await tick();
  const district=document.getElementById('vxDistrict'),status=document.getElementById('vxFacilityStatus');
  assert.deepEqual([...district.options].map(row=>row.textContent),['All districts','East Mamprusi','MMD']);
  assert.match(status.textContent,/Showing 1 of 4/);
  district.querySelector('option[value="MMD"]').selected=true;district.dispatchEvent(new window.Event('change'));await tick();
  const cycle=document.getElementById('vxCycle');
  assert.deepEqual([...cycle.options].map(row=>row.value).sort(),['','November 2026','October 2026'].sort());
  assert.equal(cycle.value,'');assert.match(status.textContent,/Showing 2 of 4/);
  cycle.querySelector('option[value="October 2026"]').selected=true;cycle.dispatchEvent(new window.Event('change'));await tick();
  assert.match(status.textContent,/Showing 1 of 4/);assert.match(document.getElementById('vxFacilities').textContent,/Kubori HC/);
  assert.equal(saved[allocationCycleKey('http://localhost:3000')],'October 2026');
  district.querySelector('option[value="East Mamprusi"]').selected=true;district.dispatchEvent(new window.Event('change'));await tick();
  assert.equal(cycle.value,'');assert.equal(saved[allocationCycleKey('http://localhost:3000')],'');
  assert.deepEqual([...cycle.options].map(row=>row.value).sort(),['','November 2026','September 2026'].sort());
  cycle.querySelector('option[value="November 2026"]').selected=true;cycle.dispatchEvent(new window.Event('change'));await tick();
  assert.match(status.textContent,/Showing 1 of 4/);assert.match(document.getElementById('vxFacilities').textContent,/Gbangu CHPS/);
  document.getElementById('vxSearch').value='unmatched search';
  document.getElementById('vxShowAll').dispatchEvent(new window.Event('click'));await tick();
  assert.equal(district.value,'');assert.equal(document.getElementById('vxCycle').value,'');assert.equal(document.getElementById('vxSearch').value,'');
  assert.match(status.textContent,/Showing 4 of 4/);assert.equal(document.querySelectorAll('#vxFacilities button').length,4);
  assert.equal(saved[allocationCycleKey('http://localhost:3000')],'');
 }finally{Object.assign(globalThis,previous);}
});

test('unallocated source rows can be inspected individually while audit remains blocked without a real allocation ID',async()=>{
 const {document,window}=parseHTML(html),previous={document:globalThis.document,chrome:globalThis.chrome};
 globalThis.document=document;globalThis.chrome={storage:{local:{async get(_,callback){callback?.({});return{};},async set(){}}}};
 const unallocated=[records[3],{...records[3],facilityName:'Another HC',sourceRowId:'other'}],calls=[];
 try{
  const ui=setupVaccine({request:async route=>{calls.push(route);return route===VACCINE_API.facilities?unallocated:{sourceSheetId:'mmd-nov',sourceRowId:'other',cycle:'November 2026',products:[],checkedAt:new Date().toISOString()};}});
  ui.activate();await tick();
  const target=[...document.querySelectorAll('#vxFacilities button')].find(row=>row.textContent.includes('Another HC'));
  assert.equal(target.disabled,false);target.dispatchEvent(new window.Event('click',{bubbles:true}));await tick();
  assert.equal(document.getElementById('vxFacilityName').textContent,'Another HC');assert.ok(calls.at(-1).includes('rowId=other'));
  assert.match(document.getElementById('vxBlueprintStatus').textContent,/No vaccine quantities/);
  document.getElementById('vxAnalyze').dispatchEvent(new window.Event('click'));await tick();
  assert.match(document.getElementById('vxResults').textContent,/real record ID/);
  assert.ok(calls.every(route=>route!==VACCINE_API.verify&&route!==VACCINE_API.commit));
 }finally{Object.assign(globalThis,previous);}
});
