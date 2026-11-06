import {catalogKey,catalogProductNames,type ProductCatalog,type CatalogProduct} from './productCatalog';
import {CLINICAL_PAIRINGS} from './vaccinePairing';
import {generalVaccineCounterpart} from './generalVaccineCatalog';
export interface GeneralAccessoryIdentity {productId:string;family:string;role:'vaccine'|'accessory';canonical:string;labels:string[]}
export interface GeneralAccessoryCatalog {identities:GeneralAccessoryIdentity[]}
/** Closed presentation normalization only: never remove strength, size or route. */
export const generalAccessoryLabelKey=(text:string)=>catalogKey(text).replace(/&/g,' and ').replace(/\band\b/g,' ').replace(/[^a-z0-9./+]+/g,' ').replace(/\s+/g,' ').trim();
export function buildGeneralAccessoryCatalog(catalog:ProductCatalog):GeneralAccessoryCatalog{
 const identities:GeneralAccessoryIdentity[]=[];
 const add=(product:CatalogProduct,family:string,role:GeneralAccessoryIdentity['role'],canonical:string)=>{
  const blocked=new Set((catalog.aliasRecords||[]).filter(r=>r.productId===product.id&&(r.status==='rejected'||r.status==='approved'&&!r.active)).map(r=>generalAccessoryLabelKey(r.text)));
  const labels=catalogProductNames(product).filter(label=>!product.contextualAliases.some(a=>catalogKey(a)===catalogKey(label))&&!blocked.has(generalAccessoryLabelKey(label)));
  identities.push({productId:product.id,family,role,canonical,labels});
 };
 for(const [family,rule] of Object.entries(CLINICAL_PAIRINGS))for(const [name,role] of [[family,'vaccine'],[rule.accessoryCanonical,'accessory']] as const){
  const anchors=catalog.products.filter(p=>p.scope==='vaccine'&&catalogKey(p.name)===catalogKey(name));
  if(anchors.length!==1)continue;
  const anchor=anchors[0],counterpart=generalVaccineCounterpart(anchor,catalog.products);
  add(anchor,family,role,name);if(counterpart)add(counterpart,family,role,name);
 }
 return {identities};
}
export function generalAccessoryIdentity(context:GeneralAccessoryCatalog,name:string,productId?:string){
 const exactId=productId?context.identities.filter(i=>i.productId===productId):[];
 const matches=productId?exactId:context.identities.filter(i=>i.labels.some(label=>generalAccessoryLabelKey(label)===generalAccessoryLabelKey(name)));
 const targets=new Set(matches.map(i=>`${i.family}:${i.role}`));
 return targets.size===1?matches[0]:undefined;
}
/** Only a unique catalogue target can repair punctuation/conjunction wording. */
export function generalAccessoryProduct(context:GeneralAccessoryCatalog,name:string,catalog:ProductCatalog){
 const key=generalAccessoryLabelKey(name),matches=context.identities.filter(i=>i.labels.some(label=>generalAccessoryLabelKey(label)===key));
 const ids=[...new Set(matches.map(i=>i.productId))];
 const others=catalog.products.filter(p=>catalogProductNames(p).some(label=>generalAccessoryLabelKey(label)===key));
 if(others.some(p=>!ids.includes(p.id)))return undefined;
 const rows=ids.map(id=>catalog.products.find(p=>p.id===id)!).filter(Boolean);
 const general=rows.filter(p=>p.scope==='general');
 if(general.length===1&&rows.every(p=>p.id===general[0].id||p.scope==='vaccine'&&generalVaccineCounterpart(p,catalog.products)?.id===general[0].id))return general[0];
 return rows.length===1?rows[0]:undefined;
}

export interface GeneralAccessoryCheck {
 family:string;customerProduct:string;requestedQuantity:number|null;fsProduct:string;fulfilledQuantity:number;
 requiredAccessory:string;accessoryFound:string[];accessoryQuantity:number|null;
 status:'awaiting comparison'|'verified'|'needs confirmation'|'missing'|'quantity mismatch'|'not required'|'orphan';
}
export function generalAccessoryChecks(items:import('../src/utils/generalAuditor').GeneralComparisonItem[],context:GeneralAccessoryCatalog):GeneralAccessoryCheck[]{
 const identity=(item:typeof items[number])=>{
  const fs=item.provenance.filter(p=>p.source==='fulfillment_confirmation');
  const found=fs.map(p=>p.canonicalId?generalAccessoryIdentity(context,p.name,p.canonicalId):undefined);
  return found.length&&found[0]&&found.every(i=>i?.canonical===found[0]?.canonical)?found[0]:undefined;
 };
 return Object.entries(CLINICAL_PAIRINGS).flatMap(([family,rule])=>{
  const primary=items.filter(item=>identity(item)?.canonical===family);
  if(!primary.length)return [];
  const accessory=items.filter(item=>identity(item)?.canonical===rule.accessoryCanonical);
  const unresolvedAccessories=items.filter(item=>!identity(item)&&item.provenance.some(p=>p.source==='fulfillment_confirmation'&&!p.canonicalId&&generalAccessoryIdentity(context,p.name)?.canonical===rule.accessoryCanonical));
  const displayedAccessories=[...accessory,...unresolvedAccessories];
  const requested=primary.flatMap(item=>item.provenance.filter(p=>p.source==='customer_request'));
  const quantity=primary.reduce((total,item)=>total+item.fulfillment.supplied,0),accessoryQuantity=accessory.reduce((total,item)=>total+item.fulfillment.supplied,0);
  const pairing=primary.some(item=>item.fulfillment.vaccinePairingError);
  const status:GeneralAccessoryCheck['status']=quantity===0?'not required':unresolvedAccessories.length?'needs confirmation':pairing?!accessory.length||accessoryQuantity===0?'missing':'quantity mismatch':primary.some(item=>item.status==='product identity discrepancy'||item.status==='pending order limit')?'needs confirmation':!accessory.length?'needs confirmation':'verified';
  return [{family,customerProduct:[...new Set(requested.map(p=>p.name))].join('; '),requestedQuantity:requested.length?requested.reduce((n,p)=>n+p.quantity,0):null,
   fsProduct:[...new Set(primary.flatMap(item=>item.provenance.filter(p=>p.source==='fulfillment_confirmation').map(p=>p.name)))].join('; '),fulfilledQuantity:quantity,
   requiredAccessory:rule.name,accessoryFound:[...new Set(displayedAccessories.flatMap(item=>item.provenance.filter(p=>p.source==='fulfillment_confirmation').map(p=>p.name)))],accessoryQuantity:displayedAccessories.length?displayedAccessories.reduce((n,item)=>n+item.fulfillment.supplied,0):null,status}];
 });
}
