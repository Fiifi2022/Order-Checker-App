import {createHash} from 'node:crypto';
import {catalogAliasKey,type ProductCatalog,type CatalogAliasEvent,type CatalogProduct} from '../shared/productCatalog';
import {productSyringeSpecifications,normalizeSyringeText,unsafeSyringeAlias} from '../shared/syringeIdentity';
import {catalogueAliasRecords,changeCatalogueAlias} from './catalogAliasLearning';

/** Explicit requested catalogue registration only; the matcher itself has no size list. */
export function registerConfirmedSyringes(original:ProductCatalog,actor:string){
 let catalog=structuredClone(original);const events:CatalogAliasEvent[]=[];
 const apply=(input:any)=>{const changed=changeCatalogueAlias(catalog,{...input,revision:catalog.revision},actor);catalog=changed.catalog;events.push(...changed.events);};
 // Preserve history for incorrect generic mappings rather than deleting records.
 for(const product of [...catalog.products])for(const alias of [...product.aliases])if(unsafeSyringeAlias(alias,product)){
  const record=catalogueAliasRecords(catalog).find(r=>r.productId===product.id&&r.normalizedText===catalogAliasKey(alias));
  if(record?.status==='approved'&&record.active)apply({action:'deactivate',id:record.id});
 }
 const approved=[
  {capacity:.05,legacy:'Soloshot 0.05ml',aliases:['0.05 solo shots','0.05ml syringe','0.05cc syringe','50 microlitre syringe','0.05ml solo shot']},
  {capacity:.5,legacy:'Soloshot 0.5ml',aliases:['0.5 solo shots','half ml syringe','½ml syringe','0.5cc syringe','0.5ml solo shot']},
  {capacity:2,legacy:'Syringe and needle 2ml',aliases:['2ml syringe','2cc syringe','2 mls syringe','disposable syringe 2ml','2ml syringe and needle']},
  {capacity:5,legacy:'Syringe and needle 5ml',aliases:['5ml syringe','5cc syringe','5 mls syringe','disposable syringe 5ml','5ml syringe and needle']},
 ];
 for(const row of approved){
  const name=`Disp Syringe & Needle, ${row.capacity}mL`;
  const exact=catalog.products.filter(p=>normalizeSyringeText(p.name)===normalizeSyringeText(row.legacy)||normalizeSyringeText(p.name)===normalizeSyringeText(name));
  const candidates=exact.length?exact:catalog.products.filter(p=>{const spec=productSyringeSpecifications(p);return spec?.capacityMl===row.capacity&&spec.needleIncluded===true&&!/\[/.test(p.name);});
  if(candidates.length>1)throw Error(`Multiple existing syringe identities for ${row.capacity}mL require catalogue confirmation.`);
  let product=candidates[0];
  if(!product){product={id:createHash('sha256').update(`general:${name.toLowerCase()}`).digest('hex'),scope:'general',name,category:'device',aliases:[],contextualAliases:[],note:'User-requested syringe and needle product.'};catalog={...catalog,products:[...catalog.products,product],revision:catalog.revision+1};}
  if(product.displayName!==name||product.fulfillmentSystemName!==name||product.deviceSpecifications?.capacityMl!==row.capacity||product.deviceSpecifications?.needleIncluded!==true)catalog={...catalog,products:catalog.products.map(p=>p.id===product.id?{...p,displayName:name,fulfillmentSystemName:name,deviceSpecifications:{...p.deviceSpecifications,capacityMl:row.capacity,needleIncluded:true}}:p),revision:catalog.revision+1};
  for(const text of [name,...row.aliases]){
   const existing=catalogueAliasRecords(catalog).find(r=>r.productId===product.id&&r.normalizedText===catalogAliasKey(text));
   if(existing?.status==='approved'&&existing.active)continue;
   if(existing){apply({action:'correct',id:existing.id,text,productId:product.id,identityConfirmed:true});continue;}
   if(catalogAliasKey(product.name)===catalogAliasKey(text))continue;
   apply({action:'propose',text,productId:product.id});
   const pending=catalog.aliasRecords!.find(r=>r.productId===product.id&&r.normalizedText===catalogAliasKey(text))!;
   apply({action:'approve',id:pending.id,identityConfirmed:true});
  }
 }
 return {catalog:{...catalog,updatedAt:new Date().toISOString(),updatedBy:actor},events};
}
