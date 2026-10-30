import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { loadFacilities,normalizeFacilities,VACCINE_API } from './sidepanel-vaccine-api.js';
import { setupVaccine } from './sidepanel-vaccine.js';
const html=await readFile(new URL('./sidepanel.html',import.meta.url),'utf8');
const records=[{id:'fac-buzulungu',facilityName:'Buzulungu CHPS',district:'East Mamprusi',region:'North East',cycle:'October 2026',sourceSheetId:'east',sourceRowId:'one'},
 {id:'',facilityName:'New Facility HC',district:'East Mamprusi',cycle:'October 2026',sourceSheetId:'east',sourceRowId:'two',allocationAvailable:false,allocationNotice:'No vaccine allocation record is set for this facility.'}];
const storage={get:async(_key,callback)=>{callback?.({});return{facilityRoute:'/old/facilities'};},set:async()=>{}};

test('authoritative Blueprint facilities are preferred and an empty list never revives an unrelated saved route',async()=>{
 const previous=globalThis.chrome;globalThis.chrome={storage:{local:storage}};
 try {
  for(const response of [records,[],{facilities:[]}]) {
   const calls=[];const result=await loadFacilities(async route=>{calls.push(route);return response;});
   assert.deepEqual(calls,[VACCINE_API.facilities]);assert.equal(result.facilities.length,Array.isArray(response)?response.length:0);
   if(Array.isArray(response)&&response.length){assert.equal(result.facilities[0].id,'fac-buzulungu');assert.equal(result.facilities[1].allocationAvailable,false);}
  }
  const error=Object.assign(Error('Please sign in'),{status:401});
  let calls=0;await assert.rejects(loadFacilities(async()=>{calls++;throw error;}),{status:401});assert.equal(calls,1);
 }finally{globalThis.chrome=previous;}
});

test('unallocated facilities in different Blueprint cycles are not deduplicated together',()=>{
 const rows=normalizeFacilities([{...records[1]},{...records[1],sourceSheetId:'east-next',cycle:'November 2026'}]);
 assert.equal(rows.length,2);assert.ok(rows.every(row=>!row.id&&!row.allocationAvailable));
});

test('search displays Blueprint names, districts and cycles, supports HC wording, and preserves real selection IDs',async()=>{
 const {document,window}=parseHTML(html),previous={document:globalThis.document,chrome:globalThis.chrome};
 globalThis.document=document;globalThis.chrome={storage:{local:storage}};
 let reads=0;
 try {
  const ui=setupVaccine({request:async route=>{assert.equal(route,VACCINE_API.facilities);reads++;return records;}});
  ui.activate();await new Promise(resolve=>setImmediate(resolve));
  const rows=[...document.querySelectorAll('#vxFacilities button')];
  assert.equal(rows.length,2);assert.match(rows[0].textContent,/Buzulungu CHPS.*East Mamprusi.*October 2026/);
  assert.equal(rows[0].dataset.id,'fac-buzulungu');assert.equal(rows[1].disabled,false);
  const search=document.getElementById('vxSearch');search.value='New Health Centre';search.dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelectorAll('#vxFacilities button').length,1);
  search.value='Buzulungu October';search.dispatchEvent(new window.Event('input'));
  const selected=document.querySelector('#vxFacilities button');selected.dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.equal(document.getElementById('vxFacilityName').textContent,'Buzulungu CHPS');
  assert.equal(document.getElementById('vxAudit').hidden,false);
  document.getElementById('vxChange').dispatchEvent(new window.Event('click'));
  ui.activate();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);
 }finally{Object.assign(globalThis,previous);}
});
