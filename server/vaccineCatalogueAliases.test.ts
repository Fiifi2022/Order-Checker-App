import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCatalog} from './productCatalog';
import {runGeneralProductNameAudit} from './generalProductNameAudit';
import {resolveGeneralCatalogIdentity} from '../src/utils/generalProductLog';
import {generalVaccineCounterpart} from '../shared/generalVaccineCatalog';
import {matchExactVaccineName,matchVaccineName,replaceAliases} from './vaccineService';
import type {CatalogProduct,ProductCatalog} from '../shared/productCatalog';
const row=(id:string,name:string,aliases:string[],scope:'general'|'vaccine'='general'):CatalogProduct=>({id,name,aliases,scope,category:'vaccine',contextualAliases:[],note:''});
const definitions=[
 ['bcg','Bacille Calmette-Guerin Vaccine','BCG',['BCG vaccine','bcg inj','bcg injection','B.C.G','Bacillus Calmette-Guerin','TB vaccine']],
 ['opv','Oral Polio Vaccine','OPV',['bOPV','Oral Polio Vaccine (1&3)','OPV (One and Three)','polio drops']],
 ['ipv','Inactivated Polio Vaccine','IPV',['IPV vaccine','injectable polio','polio injection']],
 ['penta','Pentavalent Vaccine','Penta',['DTP-HepB-Hib','Pentavalent (5-in-1)','5 in 1','five-in-one vaccine']],
 ['pcv','Pneumococcal Conjugate Vaccine','PCV',['PCV13','PCV 13','pneumococcal vaccine']],
 ['rota','Rotavirus Vaccine','Rota',['RV','RV vaccine','Rotarix','Rotasiil']],
 ['mr','Measles-Rubella Vaccine','MR',['MR vaccine','M&R','Measles/Rubella','Measles and Rubella']],
 ['yf','Yellow Fever Vaccine','Yellow Fever',['YF','YF vaccine','Stamaril']],
 ['hpv','HPV Vaccine','HPV',['Human Papilloma Virus vaccine','Human Papillomavirus Vaccine']],
 ['mena','Meningococcal Vaccine','Men A',['Mena','Men-A','MenAfriVac','Meningococcal Conjugate A Vaccine']],
 ['covid','COVID-19 Vaccine','COVID-19',['Covid','COVID vaccine']],
 ['diluent','BCG Vaccine Diluent','BCG Diluent',['BCG water','water for BCG','B.C.G diluent']],
 ['mr-diluent','Measles-Rubella Vaccine Diluent','MR Diluent',['MR water']],
 ['yf-diluent','Yellow Fever Vaccine Diluent','Yellow Fever Diluent',['YF water']],
 ['rota-dropper','Rotavirus Vaccine Dropper','Rota Dropper',['RV dropper']],
 ['mena-diluent','Meningococcal Conjugate A Vaccine Diluent','Men A Diluent',['Men A water']],
 ['dropper','Oral Polio Vaccine Dropper','OPV Dropper',['OPV droppers','OPV vaccine dropper','Polio dropper']],
] as [string,string,string,string[]][];
const products=definitions.flatMap(([id,name,key,aliases])=>[row('g-'+id,name,[key,...(id==='covid'?['Covid']:[])]),row('v-'+id,key,aliases,'vaccine')]);
const catalog:ProductCatalog={revision:1,products};
const header='Facility: Test CHPS\nOrderer: Test Operator\n';
async function audit(request:string,supply:string,c:ProductCatalog=catalog){
 applyCatalog(c);let calls=0;
 const result=await runGeneralProductNameAudit(header+request,header+supply,c,{semanticTimeoutMs:0},()=>{calls++;throw Error('Approved vaccine aliases do not need AI');});
 assert.equal(calls,0);return result;
}
test('General Auditor uses every approved cross-checker vaccine alias under the existing General identity',async()=>{
 for(const [id,name,key,aliases] of definitions)for(const alias of [key,...aliases]){
  const result=await audit(alias+' - 5',name+' [0/1]');
  assert.equal(result.allMatch,true,alias+': '+result.generalAudit.discrepancies.join(';'));
  assert.equal(result.items.length,1);assert.equal(result.productMatchingDiagnostics[0].customer[0].catalogProductId,'g-'+id);
  assert.equal(result.generalAudit.counts.outOfStock,1);assert.equal(result.generalAudit.productTotals?.quantityReview,0);
 }
});
test('dotted and spaced initialisms match approved acronyms in both checkers',async()=>{
 for(const [alias,key,full] of [
 ['B. C. G. vaccine','BCG','Bacille Calmette-Guerin Vaccine'],['I.P.V.','IPV','Inactivated Polio Vaccine'],
 ['O. P. V.','OPV','Oral Polio Vaccine'],['P.C.V.','PCV','Pneumococcal Conjugate Vaccine'],
 ['H.P.V.','HPV','HPV Vaccine'],['M.R. vaccine','MR','Measles-Rubella Vaccine'],['Y.F.','Yellow Fever','Yellow Fever Vaccine'],
 ]){
  const r=await audit(alias+' - 5',full+' [0/5]');assert.equal(r.allMatch,true,alias);
  assert.deepEqual(matchExactVaccineName(alias),{canonical:key,confidence:'high'});
 }
});
test('numeric vaccine labels retain their names and actual trailing requested quantities',async()=>{
 const r=await audit('5 in 1 - 12','Pentavalent Vaccine [12/12]');
 assert.equal(r.allMatch,true);assert.equal(r.items[0].fulfillment.requested,12);assert.equal(r.items[0].provenance[0].name,'5 in 1');
});
test('different vaccines, explicit valencies and vaccine/accessory identities are never merged',async()=>{
 const c={revision:2,products:[...products,row('measles','Measles Vaccine',['Measles']),row('pcv10','PCV10 Vaccine',['PCV10']),row('pcv13','PCV13 Vaccine',['PCV13'])]};
 for(const [request,supply] of [['OPV','Inactivated Polio Vaccine'],['BCG','BCG Vaccine Diluent'],['Measles','Measles-Rubella Vaccine'],['PCV10','PCV13 Vaccine']]){
  const r=await audit(request+' - 5',supply+' [0/5]',c);assert.equal(r.allMatch,false,request+' vs '+supply);assert.ok(r.issueCount>0);
 }
});
test('context-required DT resolves only against its approved vaccine counterpart and never TT or Td',async()=>{
 const child={...row('child','Diphtheria-Tetanus Vaccine',['DT','DT vaccine']),contextualAliases:['DT']};
 const c={revision:3,products:[child,row('adult','Tetanus-Diphtheria Vaccine',['TD']),row('toxoid','Tetanus Toxoid',['TT']),{...row('opaque','DT',['DT']),category:'medicine',contextualAliases:['DT']},row('v-dt','DT',['Diphtheria Tetanus','DT vaccine'],'vaccine')]};
 const r=await audit('DT - 5','Diphtheria-Tetanus Vaccine [0/5]',c);assert.equal(r.allMatch,true);assert.equal(r.productMatchingDiagnostics[0].customer[0].catalogProductId,'child');
 for(const [request,supply] of [['TT','Tetanus-Diphtheria Vaccine'],['TD','Diphtheria-Tetanus Vaccine']])assert.equal((await audit(request+' - 5',supply+' [0/5]',c)).allMatch,false);
});
test('alias edits invalidate inherited matching, and competing catalogue identities remain unresolved',()=>{
 const current=structuredClone(products);const before=resolveGeneralCatalogIdentity('RV',current);assert.equal(before.product?.id,'g-rota');
 current.find(p=>p.id==='v-rota')!.aliases=current.find(p=>p.id==='v-rota')!.aliases.filter(alias=>alias!=='RV');
 assert.equal(resolveGeneralCatalogIdentity('RV',current).product,undefined);
 const v=row('v','Fixture Vaccine',['Shared label'],'vaccine');
 assert.equal(generalVaccineCounterpart(v,[v,row('a','Vaccine Alpha',['Shared label']),row('b','Vaccine Beta',['Shared label'])]),undefined);
 replaceAliases({Alpha:['Shared vaccine'],Beta:['Shared vaccine']});
 assert.equal(matchVaccineName('Shared vaccine').confidence,'none');assert.equal(matchExactVaccineName('Shared vaccine').confidence,'none');
});
test('a full vaccine order using abbreviations matches its full-name confirmation and required accessories',async()=>{
 const ids=['bcg','opv','ipv','penta','pcv','rota','mr','yf','hpv','mena'];
 const request=ids.map((id,index)=>definitions.find(row=>row[0]===id)![3][0]+' - '+(index+2)).join('\n');
 const supply=ids.map((id,index)=>definitions.find(row=>row[0]===id)![1]+` [${index+2}/${index+2}]`);
 const accessories=[['bcg','diluent'],['opv','dropper'],['mr','mr-diluent'],['yf','yf-diluent'],['rota','rota-dropper'],['mena','mena-diluent']];
 for(const [primary,accessory] of accessories){const quantity=ids.indexOf(primary)+2;supply.push(definitions.find(row=>row[0]===accessory)![1]+` [${quantity}/${quantity}]`);}
 const result=await audit(request,supply.join('\n'));
 assert.equal(result.allMatch,true,result.generalAudit.discrepancies.join(';'));assert.equal(result.issueCount,0);
 const missing=await audit(request,supply.filter(line=>!line.startsWith('BCG Vaccine Diluent')).join('\n'));
 assert.equal(missing.allMatch,false);assert.ok(missing.items.some(item=>item.status==='vaccine pairing mismatch'));
 const short=await audit('RV - 5','Rotavirus Vaccine [4/5]\nRotavirus Vaccine Dropper [4/4]');
 assert.equal(short.allMatch,false);assert.equal(short.generalAudit.pendingOrderLimitCount,1);
});
test('conflicting broad vaccine aliases produce one identity review rather than a false missing product',async()=>{
 const rows=structuredClone(products);rows.find(p=>p.id==='v-mr')!.aliases.push('Measles','Measles Vaccine');rows.push(row('measles-only','Measles Vaccine',['Measles']));
 const r=await audit('Measles - 5','Measles-Rubella Vaccine [0/1]',{revision:8,products:rows});
 assert.equal(r.allMatch,false);assert.equal(r.issueCount,1);assert.equal(r.items.length,1);assert.equal(r.items[0].status,'product identity discrepancy');
 assert.doesNotMatch(r.generalAudit.discrepancies.join(';'),/missing from|extra in/);assert.match(r.generalAudit.discrepancies[0],/Conflicting vaccine catalogue mappings/);
});
