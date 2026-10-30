import test from 'node:test';
import assert from 'node:assert/strict';
import {activeFsFacilities,blueprintFacilityChoices,lookupFsAllocation} from './fsAllocation';
const sheet={id:'mmd',district:'MMD',month:'October 2026',rows:[{id:'kpatorigu',facility:'KPATORIGU CHPS',vaccines:{BCG:{allocation:1,balance:1},PCV:{allocation:10,balance:10}}}]};

test('Kpatorigu resolves MMD and official Mamprugu Moagduri geography without changing saved data',()=>{
 const before=JSON.stringify(sheet);
 assert.equal(activeFsFacilities([sheet])[0].district,'Mamprugu Moagduri');assert.equal(activeFsFacilities([sheet])[0].region,'North East');
 for(const district of ['MMD','Mamprugu Moagduri']){
  const result=lookupFsAllocation([sheet],{facility:{name:'Kpatorigu CHPS',district,region:'North East'},products:[{name:'Bacille Calmette-Guerin Vaccine'}],allocationCycle:'October 2026'},{automaticCycle:true});
  assert.equal(result.status,'matched');assert.equal(result.facility.sourceRowId,'kpatorigu');assert.equal(result.products[0].balance,1);
 }
 const listed=blueprintFacilityChoices([sheet],[{id:'real-kpatorigu',facilityName:'KPATORIGU CHPS',sourceSheetId:'mmd',sourceRowId:'kpatorigu'}]);
 assert.equal(listed[0].district,'Mamprugu Moagduri');assert.equal(listed[0].id,'real-kpatorigu');assert.equal(JSON.stringify(sheet),before);
});

test('district alias never bypasses wrong regions or different districts',()=>{
 for(const facility of [{name:'Kpatorigu CHPS',district:'East Mamprusi'},{name:'Kpatorigu CHPS',district:'MMD',region:'Central'}]){
  assert.equal(lookupFsAllocation([sheet],{facility,products:[]}).status,'not_found');
 }
 assert.equal(activeFsFacilities([{...sheet,rows:[{...sheet.rows[0],district:'Another District'}]}])[0].district,'Another District');
});
