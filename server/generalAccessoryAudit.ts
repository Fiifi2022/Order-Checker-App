import {CLINICAL_PAIRINGS} from '../shared/vaccinePairing';
import type {ProductCatalog} from '../shared/productCatalog';
import type {GeneralComparisonItem,GeneralProductEvidence} from './generalAuditor';
import {parseGeneralProducts} from './generalAuditor';
import {buildGeneralAccessoryCatalog,generalAccessoryIdentity,generalAccessoryProduct,generalAccessoryLabelKey,type GeneralAccessoryCatalog} from '../shared/generalAccessoryCatalog';
import {catalogProductNames} from '../shared/productCatalog';
import {generalCatalogAttributeConflict,createGeneralCatalogResolver} from '../src/utils/generalProductLog';
import {directProductNameKey} from '../shared/generalDirectProduct';
import type {ProductResearchSuggestion} from '../shared/productResearch';
export {buildGeneralAccessoryCatalog,generalAccessoryIdentity,generalAccessoryProduct};
export function createGeneralAccessoryResolver(catalog:ProductCatalog,context?:GeneralAccessoryCatalog){
 const resolve=createGeneralCatalogResolver(catalog.products);
 return ((name:string,preferred?:string[])=>{
  const result=resolve(name,preferred);if(!context||result.product)return result;
  const product=generalAccessoryProduct(context,name,catalog);
  return product?{...result,product,recognized:true,source:'Alias' as const}:result;
 }) as typeof resolve;
}
export function generalVaccineListHeading(text:string){
 return /^(?:(?:please|kindly)\s+)?(?:serve|supply|send|provide)(?:\s+us)?\s+(?:with\s+)?(?:the\s+)?following\s+vaccines?(?:\s+in\s+(?:vials?|doses?|units?))?\s*[:.]?$/i.test(text.trim());
}
/** Remove a list instruction, retaining an explicitly stated count unit for
 * recognized primary vaccines. Explicit per-line units always take precedence. */
export function prepareGeneralVaccineList(text:string,catalog:ProductCatalog,context:GeneralAccessoryCatalog){
 const resolve=createGeneralAccessoryResolver(catalog,context);let unit='';
 return text.split('\n').map(line=>{
  if(generalVaccineListHeading(line)){unit=line.match(/\bin\s+(vials?|doses?|units?)\b/i)?.[1]||'';return '';}
  if(!unit||!line.trim())return line;
  const entries=parseGeneralProducts(line,'customer_request');
  if(entries.length===1){const p=entries[0],product=resolve(p.name).product;
   if(!p.unit&&!p.quantityReview&&product&&generalAccessoryIdentity(context,p.name,product.id)?.role==='vaccine')return `${line} ${unit}`;
   return line;
  }
  unit='';return line;
 }).join('\n');
}
export function generalVaccineIdentityChoices(requested:GeneralProductEvidence[],supplied:GeneralProductEvidence[],context:GeneralAccessoryCatalog,catalog:ProductCatalog,resolve:(name:string)=>any){
 const groups=new Map<string,ProductResearchSuggestion>();
 for(const p of requested){
  const own=resolve(p.name).product;if(!own)continue;
  const hinted=generalAccessoryIdentity(context,p.name);
  if(!hinted||hinted.role!=='vaccine'||generalAccessoryIdentity(context,own.name,own.id))continue;
  const candidates=supplied.filter(q=>{const target=resolve(q.name).product,identity=target&&generalAccessoryIdentity(context,q.name,target.id);return identity?.role==='vaccine'&&identity.family===hinted.family&&!generalCatalogAttributeConflict(p.name,q.name);});
  if(!candidates.length)continue;
  groups.set(p.name,{alias:p.name,customerValue:p.name,fulfillmentValue:candidates.map(q=>q.name).join('; '),status:'suggested',researchStatus:'catalogue',confidenceCategory:'MEDIUM',options:candidates.map(q=>({productId:`source:${directProductNameKey(q.name)}`,kind:'source',sourceName:q.name,name:q.name,confidenceCategory:'MEDIUM',evidenceSource:'source',reason:'Catalogue wording overlaps distinct vaccine records. Confirm the intended vaccine formulation; its accessory is checked independently.'})),nextSteps:['Confirm the requested vaccine formulation or retain the product discrepancy.']});
 }
 for(const p of supplied){
  const hint=generalAccessoryIdentity(context,p.name);
  if(!hint||hint.role!=='accessory'||resolve(p.name).product)continue;
  const candidates=catalog.products.filter(product=>catalogProductNames(product).some(label=>generalAccessoryLabelKey(label)===generalAccessoryLabelKey(p.name))&&!generalCatalogAttributeConflict(p.name,product.name));
  if(candidates.length<2)continue;
  groups.set(p.name,{alias:p.name,status:'suggested',researchStatus:'catalogue',confidenceCategory:'MEDIUM',options:candidates.map(product=>({productId:product.id,name:product.name,confidenceCategory:'MEDIUM',evidenceSource:'catalogue',reason:'Multiple catalogue records use this accessory label. An authorized catalogue editor must verify the canonical mapping; no record has been removed.'})),nextSteps:['Ask a catalogue editor to correct the conflicting mapping before approval.','The accessory is present; do not substitute a different vaccine or accessory.']});
 }
 return groups;
}
export function prepareGeneralAccessoryItems(items:GeneralComparisonItem[],context:GeneralAccessoryCatalog){
 return items.map(item=>{
  const fs=item.provenance.filter(p=>p.source==='fulfillment_confirmation');
  if(!fs.length)return item;
  const identities=fs.map(p=>p.canonicalId?generalAccessoryIdentity(context,p.name,p.canonicalId):undefined);
  const identity=identities[0];
  const hints=fs.map(p=>generalAccessoryIdentity(context,p.name));
  if(!identity&&hints.every(h=>h?.role==='accessory')&&!item.provenance.some(p=>p.source==='customer_request'))return {...item,status:'product identity discrepancy' as const,
    action:'Accessory is present; confirm the conflicting catalogue mapping.',fulfillment:{...item.fulfillment,identityReviewRequired:true,identityConflictConfirmed:false,
      identityError:'Accessory is present; confirm the conflicting catalogue mapping.',quantityError:undefined,fulfillmentStatus:'discrepancy' as const,orderLimitEligible:false}};
  if(!identity||identity.role!=='accessory'||identities.some(other=>other?.canonical!==identity.canonical)||item.fulfillment.identityConflictConfirmed||item.fulfillment.quantityError&&!/cannot yet be compared|comparison paused/i.test(item.fulfillment.quantityError))return item;
  // A known FS accessory has independent identity even when the customer list
  // has an unread/uncertain vaccine. Pairing still checks its actual quantity.
  if(item.provenance.some(p=>p.source==='customer_request')||item.status!=='product identity discrepancy')return item;
  return {...item,status:item.fulfillment.supplied>0?'extra item' as const:'out of stock' as const,action:'Catalogue accessory identity recognized; validate the associated FS vaccine.',
   fulfillment:{...item.fulfillment,identityError:undefined,identityReviewRequired:false,quantityError:undefined,requestedQuantityMissing:false,fulfillmentStatus:item.fulfillment.supplied>0?'discrepancy' as const:'out of stock' as const}};
 });
}

export function generalAccessoryPreviewChecks(customer:{name:string;quantity:number|null}[],fulfillment:{name:string;quantity:number|null}[],catalog:ProductCatalog){
 const context=buildGeneralAccessoryCatalog(catalog),resolve=createGeneralAccessoryResolver(catalog,context);
 return Object.entries(CLINICAL_PAIRINGS).flatMap(([family,rule])=>{
  const role=(name:string)=>{const product=resolve(name).product;return product?generalAccessoryIdentity(context,name,product.id):undefined;};
  const fs=fulfillment.filter(p=>role(p.name)?.canonical===family);if(!fs.length)return [];
  const requested=customer.filter(p=>role(p.name)?.canonical===family||!role(p.name)&&generalAccessoryIdentity(context,p.name)?.canonical===family);
  const accessories=fulfillment.filter(p=>role(p.name)?.canonical===rule.accessoryCanonical||!resolve(p.name).product&&generalAccessoryIdentity(context,p.name)?.canonical===rule.accessoryCanonical);
  return [{family,customerProduct:requested.map(p=>p.name).join('; '),requestedQuantity:requested.length&&requested.every(p=>p.quantity!==null)?requested.reduce((n,p)=>n+p.quantity!,0):null,
   fsProduct:fs.map(p=>p.name).join('; '),fulfilledQuantity:fs.reduce((n,p)=>n+(p.quantity||0),0),requiredAccessory:rule.name,accessoryFound:accessories.map(p=>p.name),accessoryQuantity:accessories.length?accessories.reduce((n,p)=>n+(p.quantity||0),0):null,status:'awaiting comparison' as const}];
 });
}
