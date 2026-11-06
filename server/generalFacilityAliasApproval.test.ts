import test from 'node:test';
import assert from 'node:assert/strict';
import {approveConfirmedFacilityAlias} from './generalFacilityAliasApproval';
import {activeGeneralFacilities,changeGeneralFacilityDirectory} from './generalFacilityDirectory';
import {compareGeneralFacilities} from '../src/utils/generalFacility';
import type {GeneralFacilityDirectoryState} from '../shared/generalFacilityDirectory';
const state=():GeneralFacilityDirectoryState=>({revision:1,added:[{key:'aurora-test-reference',id:'aurora-test-id',name:'Example Aurora Health Centre',source:'test-verified-record'}],removedKeys:[]});
const audit=(action='confirm',at='2026-11-04T10:00:00Z'):any=>({id:'facility-alias-audit',generalAudit:{facility:{whatsappValue:'Example Auroa Health Centre',fulfillmentValue:'Example Aurora Health Centre',fulfillmentFacilityId:'aurora-test-id',identityDecision:{action,at,actor:{id:'cca',name:'CCA'}}}}});
test('CCA approval binds an alias to one verified facility and future comparisons resolve locally',()=>{
 const saved=approveConfirmedFacilityAlias(state(),audit());assert.equal(saved.aliasApprovals?.length,1);assert.equal(saved.aliasApprovals![0].by,'cca');
 const records=activeGeneralFacilities(saved),result=compareGeneralFacilities('Example Auroa Health Centre','Example Aurora Health Centre','','',{records});assert.equal(result.status,'match');assert.equal(result.customerFacilityId,'aurora-test-id');assert.equal(result.fulfillmentFacilityId,'aurora-test-id');
 assert.equal(approveConfirmedFacilityAlias(saved,audit()),saved);
});
test('Change Decision withdraws a learned alias without altering the facility record',()=>{
 const first=approveConfirmedFacilityAlias(state(),audit()),changed=approveConfirmedFacilityAlias(first,audit('reset','2026-11-04T10:01:00Z'));
 assert.equal(changed.aliasApprovals![0].active,false);assert.equal(changed.aliasApprovals![0].history!.length,2);assert.deepEqual(changed.added,first.added);
 assert.equal(activeGeneralFacilities(changed).find(r=>r.key==='aurora-test-reference')?.verifiedAliases,undefined);
});
test('rejection and ambiguous facility references never become aliases',()=>{
 const initial=state();assert.equal(approveConfirmedFacilityAlias(initial,audit('reject')),initial);
 const ambiguous={...initial,added:[...initial.added,{...initial.added[0],key:'other-reference',id:'another-id'}]};assert.equal(approveConfirmedFacilityAlias(ambiguous,audit()),ambiguous);
 const conflict=audit();conflict.generalAudit.facility.customerFacilityId='different-id';assert.equal(approveConfirmedFacilityAlias(initial,conflict),initial);
});
test('facility edits preserve alias history and removed facilities cannot resolve their aliases',()=>{
 const approved=approveConfirmedFacilityAlias(state(),audit());
 const removed=changeGeneralFacilityDirectory(approved,'remove',{revision:approved.revision,key:'aurora-test-reference'},'admin');
 assert.deepEqual(removed.aliasApprovals,approved.aliasApprovals);assert.equal(activeGeneralFacilities(removed).some(r=>r.key==='aurora-test-reference'),false);
});
