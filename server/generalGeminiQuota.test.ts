import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import type {ProductCatalog} from '../shared/productCatalog';

test('extraction and catalogue fallback share quota pause; known orders still pass without AI and unknown evidence stays in review',async()=>{
  const catalog:ProductCatalog={revision:2700,products:[{id:'ors',scope:'general',name:'Oral Rehydration Salts',aliases:['ORS'],contextualAliases:[],category:'medicine',note:''}]};
  applyCatalog(catalog);let calls=0;
  const client={models:{generateContent:async()=>{calls++;throw Object.assign(Error('private provider detail'),{status:429});}}};
  const support={semanticTimeoutMs:1000,semanticCacheScope:'shared-quota',facilityContext:{records:[{id:'example',name:'Example HC',source:'test/directory'}]}};
  const fs='Orderer: Ama Boateng\nFacility: Example HC\nOral Rehydration Salts [5/5]';
  const first=await runGeneralProductNameAudit('Order placed by Ama Boateng at Example HC\nLocal rehydration 5',fs,catalog,support,()=>client);
  assert.equal(calls,1);assert.equal(first.allMatch,false);
  assert.notEqual(first.generalAudit.orderer.status,'match');
  const second=await runGeneralProductNameAudit('Orderer: Ama Boateng\nFacility: Example HC\nLocal rehydration supply 5',fs,catalog,support,()=>client);
  assert.equal(calls,1);assert.equal(second.allMatch,false);assert.ok(second.items.some(item=>item.fulfillment.identityReviewRequired));
  const known=await runGeneralProductNameAudit('Orderer: Ama Boateng\nFacility: Example HC\nORS 5',fs,catalog,support,()=>{throw Error('Known catalogue orders must not initialize Gemini');});
  assert.equal(calls,1);assert.equal(known.allMatch,true);
  assert.doesNotMatch(JSON.stringify([first,second]),/private provider detail/);
});
