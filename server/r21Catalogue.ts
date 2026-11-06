import {catalogKey,catalogProductNames,type ProductCatalog} from '../shared/productCatalog';
import {saveCatalogProduct} from './productCatalog';
import {trackCatalogueAliasEdits} from './catalogAliasLearning';
import {APPROVED_VACCINE_CATALOGUE_LABELS} from '../shared/generalVaccineCatalog';

/** Confirmed local names, shared through the existing cross-checker catalogue link. */
export function registerR21ForAuditing(catalog:ProductCatalog,actor:string){
 const vaccines=catalog.products.filter(p=>p.scope==='vaccine'&&catalogKey(p.name)==='r21');
 if(vaccines.length!==1)throw Error('A single existing R21 Vaccine Checker record is required.');
 const vaccine=vaccines[0];
 const names=['R21',...APPROVED_VACCINE_CATALOGUE_LABELS.R21],keys=new Set(names.map(catalogKey));
 const candidates=catalog.products.filter(p=>p.scope==='general'&&(p.id===vaccine.linkedProductId||p.linkedProductId===vaccine.id||catalogProductNames(p).some(n=>keys.has(catalogKey(n)))));
 if(candidates.length>1)throw Error('Multiple General catalogue entries claim R21; confirm the intended record before linking.');
 const existing=candidates[0];
 if(existing&&/\brts\s*[,/-]?\s*s\b|mosquirix/i.test(existing.name))throw Error('A different malaria vaccine cannot be linked to R21.');
 const aliases=[...new Map([...(existing?.aliases||[]),...names].map(n=>[catalogKey(n),n])).values()];
 if(names.some(n=>catalog.aliasRecords?.some(r=>r.normalizedText===catalogKey(n).replace(/[^a-z0-9./+]+/g,' ').split(/\s+/).filter(Boolean).sort().join(' ')&&(r.status==='rejected'||r.status==='approved'&&!r.active))))throw Error('A rejected or deactivated R21 alias requires explicit catalogue correction.');
 const input={revision:catalog.revision,id:existing?.id,scope:'general',name:existing?.name||'Malaria Vaccine (R21)',displayName:'Malaria Vaccine (R21)',fulfillmentSystemName:'Malaria Vaccine (R21)',category:'vaccine',aliases,contextualAliases:existing?.contextualAliases||[],linkedProductId:vaccine.id,note:existing?.note||'User-confirmed local names: malaria vaccine, R21 and Malaria R21 refer to this catalogue product.'};
 const already=existing&&existing.linkedProductId===vaccine.id&&vaccine.linkedProductId===existing.id&&names.every(n=>[existing,vaccine].every(p=>catalogProductNames(p).some(v=>catalogKey(v)===catalogKey(n))));
 if(already)return {catalog,events:[],added:0};
 const updated=saveCatalogProduct(catalog,input,actor);
 const tracked=trackCatalogueAliasEdits(catalog,updated,actor);
 return {...tracked,added:existing?0:1};
}
