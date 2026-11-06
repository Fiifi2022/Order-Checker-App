import test from 'node:test';
import assert from 'node:assert/strict';
import {registerR21ForAuditing} from './r21Catalogue';
import {defaultProducts,applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {matchVaccineName,parseVaccineLinesDetailed} from './vaccineService';
import {resolveGeneralCatalogIdentity,generalCatalogAttributeConflict} from '../src/utils/generalProductLog';
import {changeCatalogueAlias} from './catalogAliasLearning';
import {completeGeneralAuditRun,createGeneralAuditRun} from '../src/utils/generalAuditRun';
import {buildGeneralReport} from '../extension/general-report.js';
import {catalogAliasKey} from '../shared/productCatalog';
const seed=()=>registerR21ForAuditing({revision:1,products:defaultProducts()},'Test').catalog;
const header='Orderer: Mary Mensah\nFacility: Example HC\n';
const noAI=()=>{throw Error('Known R21 aliases must not call Gemini');};
for(const alias of ['Malaria vaccine','R21','Malaria R21','Malaria Vaccine (R21)','R21 malaria vaccine','MALARIA VACCINE'])test(`R21 identity is shared across General, Vaccine and extension: ${alias}`,async()=>{
 const c=seed();applyCatalog(c);const general=c.products.find(p=>p.scope==='general'&&p.linkedProductId===c.products.find(v=>v.scope==='vaccine'&&v.name==='R21')!.id)!;
 assert.equal(resolveGeneralCatalogIdentity(alias,c.products).product?.id,general.id);
 assert.equal(matchVaccineName(alias).canonical,'R21');assert.equal(matchVaccineName(alias).confidence,'high');
 const result=await runGeneralProductNameAudit(header+alias+' 10',header+'Malaria Vaccine (R21) [10/10]',c,{semanticTimeoutMs:1000},noAI);
 assert.equal(result.allMatch,true,JSON.stringify(result.generalAudit));assert.equal(result.items[0].catalogProductId,general.id);assert.equal(result.geminiMetrics.calls,0);
 const inputs={whatsappMessage:header+alias+' 10',fulfillmentConfirmation:header+'Malaria Vaccine (R21) [10/10]'};
 const record=completeGeneralAuditRun(createGeneralAuditRun(inputs,1,{}, {},true),{...result,...inputs});assert.equal(record.allMatch,true);assert.match(buildGeneralReport(record),/ORDER CONFIRMED/);
 const vaccine=parseVaccineLinesDetailed(alias+' [10/10]');assert.deepEqual(vaccine.errors,[]);assert.equal(vaccine.items[0].canonical,'R21');assert.equal(vaccine.items[0].quantity,10);
});
test('General catalogue entry is linked once, preserves the Vaccine allocation key and is editable as a General product',()=>{
 const c=seed();const a=registerR21ForAuditing(c,'Test');assert.equal(a.catalog,c);assert.equal(a.added,0);assert.equal(a.events.length,0);
 const vaccine=c.products.find(p=>p.scope==='vaccine'&&p.name==='R21')!;const general=c.products.find(p=>p.id===vaccine.linkedProductId)!;
 assert.equal(general.scope,'general');assert.equal(general.category,'vaccine');assert.equal(general.linkedProductId,vaccine.id);
 for(const alias of ['Malaria vaccine','Malaria R21','R21'])assert.ok(general.aliases.includes(alias));
});
test('RTS,S and conflicting codes are never inferred as R21; genuine quantity differences remain flagged',async()=>{
 const c=seed();applyCatalog(c);
 for(const name of ['Malaria Vaccine RTS,S','Mosquirix malaria vaccine','R21 RTS,S vaccine'])assert.equal(matchVaccineName(name).confidence,'none',name);
 assert.ok(generalCatalogAttributeConflict('Malaria vaccine RTS,S','Malaria Vaccine (R21)'));
 const quantity=await runGeneralProductNameAudit(header+'Malaria R21 10',header+'R21 [12/12]',c,{semanticTimeoutMs:0},noAI);assert.equal(quantity.allMatch,false);assert.ok(quantity.issueCount>0);
 const wrong=await runGeneralProductNameAudit(header+'Malaria R21 10',header+'Yellow Fever Vaccine [10/10]',c,{semanticTimeoutMs:0},noAI);assert.equal(wrong.allMatch,false);
 const p=c.products.find(p=>p.scope==='general'&&p.name==='Malaria Vaccine (R21)')!;
 const proposal=changeCatalogueAlias(c,{revision:c.revision,action:'propose',text:'RTS,S malaria vaccine',productId:p.id},'Test');
 const a=proposal.catalog.aliasRecords!.find(r=>r.text==='RTS,S malaria vaccine')!;
 assert.throws(()=>changeCatalogueAlias(proposal.catalog,{revision:proposal.catalog.revision,action:'approve',id:a.id,identityConfirmed:true},'Test'),/Different malaria vaccine/);
});
test('registration refuses ambiguous records and rejected aliases rather than overriding previous decisions',()=>{
 const c=seed();const conflict={...c,products:[...c.products,{...c.products.find(p=>p.scope==='general'&&p.name==='Malaria Vaccine (R21)')!,id:'other-r21'}]};
 assert.throws(()=>registerR21ForAuditing(conflict,'Test'),/Multiple General/);
 const rejected={revision:1,products:defaultProducts(),aliasRecords:[{id:'rejected',productId:'test',text:'Malaria vaccine',normalizedText:catalogAliasKey('Malaria vaccine'),source:'manual' as const,status:'rejected' as const,active:false,createdAt:null,approvedAt:null,approvedBy:null,updatedAt:null}]};
 assert.throws(()=>registerR21ForAuditing(rejected,'Test'),/rejected or deactivated/);
});
