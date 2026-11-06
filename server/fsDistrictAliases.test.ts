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

const west={id:'west',district:'WM',region:'North East',month:'October 2026',cycleState:'active',rows:[{id:'west-row',facility:'Walewale HC',vaccines:{BCG:{allocation:12,distributed:2,balance:10}}}]};
test('West Mamprusi FS district labels resolve WM Blueprint allocations without changing saved data',()=>{
 const before=JSON.stringify(west);
 for(const district of ['WM','West Mamprusi','West Mamprusi Municipal','West Mamprusi Municipality','West Mamprusi District']){
  const result=lookupFsAllocation([west],{facility:{name:'Walewale Health Centre',district,region:'North East'},products:[{name:'Bacille Calmette-Guerin Vaccine'}]},{automaticCycle:true});
  assert.equal(result.status,'matched',district);assert.equal(result.products[0].balance,10);assert.equal(result.facility.district,'West Mamprusi');
 }
 assert.equal(JSON.stringify(west),before);
 for(const facility of [{name:'Walewale HC',district:'East Mamprusi'},{name:'Walewale HC',district:'WM',region:'Central'},{name:'Another HC',district:'WM'}]){
  assert.equal(lookupFsAllocation([west],{facility,products:[]}).status,'not_found');
 }
});

test('WM aliases do not create false conflicts between the same facility monthly cycles',()=>{
 const november={...west,id:'west-nov',district:'West Mamprusi Municipal',month:'November 2026'};
 const result=lookupFsAllocation([west,november],{facility:{name:'Walewale HC',district:'West Mamprusi'},products:[{name:'BCG'}]},{automaticCycle:true,now:new Date('2026-11-03')});
 assert.equal(result.status,'matched');assert.equal(result.facility.sourceSheetId,'west-nov');assert.equal(result.products[0].balance,10);
});

test('draft allocations explain why FS cannot use them without exposing or activating balances',()=>{
 const draft={...west,cycleState:'draft'};const before=JSON.stringify(draft);
 const input={facility:{name:'Walewale HC',district:'West Mamprusi'},products:[{name:'BCG'}]};
 const result=lookupFsAllocation([draft],input,{automaticCycle:true});
 assert.equal(result.status,'allocation_inactive');assert.match(result.message,/draft.*activate/i);assert.equal(result.products[0].balance,null);
 assert.equal(activeFsFacilities([draft]).length,0);assert.equal(JSON.stringify(draft),before);
 assert.equal(lookupFsAllocation([draft],{...input,allocationCycle:'November 2026'},{automaticCycle:true}).status,'not_found');
 assert.equal(lookupFsAllocation([{...draft,cycleState:'closed'}],input).status,'not_found');
 assert.equal(lookupFsAllocation([{...draft,active:false}],input).status,'not_found');
 assert.equal(lookupFsAllocation([{...draft,worksheetRole:'other'}],input).status,'not_found');
 assert.equal(lookupFsAllocation([west,draft],input).status,'matched');
});
