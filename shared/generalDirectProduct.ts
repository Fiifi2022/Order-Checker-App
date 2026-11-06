import {generalCatalogAttributeConflict,generalCatalogStrengthConflict} from '../src/utils/generalProductLog';
import {syringeDescriptionConflict} from './syringeIdentity';
/** Preserve word boundaries, decimals, ratios and clinical qualifiers. No inferred synonyms. */
export function directProductNameKey(name:string){
 return (name.normalize('NFKC').toLowerCase().match(/\d+(?:\.\d+)?|[\p{L}]+|[+/%]/gu)||[]).join('|');
}
export function directProductMatch(a:string,b:string){
 return !!directProductNameKey(a)&&directProductNameKey(a)===directProductNameKey(b)&&!generalCatalogAttributeConflict(a,b)&&!syringeDescriptionConflict(a,b);
}
/** A broad catalogue ID may own several presentations. Partition conflicting
 * source descriptions before quantity aggregation. Equal conflict sets permit
 * harmless omissions/wording changes; an unspecified description cannot bridge
 * two different strengths. These keys belong only to the current comparison. */
export function catalogueProductVariantKeys(requested:{name:string}[],supplied:{name:string}[],resolve:(name:string)=>{id:string;scope?:string;category?:string}|undefined){
 const grouped=new Map<string,Set<string>>(),result=new Map<string,string>();
 for(const p of [...requested,...supplied]){
  const product=resolve(p.name);if(!product||product.scope==='vaccine'||product.category==='vaccine'||product.category==='companion')continue;
  const names=grouped.get(product.id)||new Set<string>();names.add(p.name);grouped.set(product.id,names);
 }
 for(const [id,names] of grouped){
  const all=[...names];if(all.length<2)continue;
  const sameSideConflict=[requested,supplied].some(side=>{
   const members=side.filter(p=>names.has(p.name));
   return members.some(a=>members.some(b=>!!generalCatalogAttributeConflict(a.name,b.name)));
  });
  if(!sameSideConflict&&!all.some(a=>all.some(b=>generalCatalogStrengthConflict(a,b))))continue;
  for(const name of all){
   const conflicts=[...new Set(all.filter(other=>!!generalCatalogAttributeConflict(name,other)).map(directProductNameKey))].sort();
   result.set(name,`${id}:variant:${JSON.stringify(conflicts)}`);
  }
 }
 return result;
}
/** Ephemeral source identity, never a catalogue ID or a permanent alias. */
export function directProductKeys(requested:{name:string}[],supplied:{name:string}[],resolve:(name:string)=>{id:string}|undefined,confirmed:{alias:string;sourceName:string}[]=[],variants:Map<string,string>=new Map()){
 const result=new Map<string,string>();
 for(const a of requested){
  const matches=supplied.filter(b=>directProductMatch(a.name,b.name));if(!matches.length)continue;
  const names=[...requested,...supplied].filter(p=>directProductMatch(a.name,p.name)).map(p=>p.name);
  const ids=[...new Set(names.flatMap(name=>resolve(name)?.id||[]))];
  const key=ids.length===1?variants.get(a.name)||ids[0]:`source-direct:${directProductNameKey(a.name)}`;
  for(const name of names)result.set(name,key);
 }
 for(const pair of confirmed){
  if(!requested.some(p=>p.name===pair.alias)||!supplied.some(p=>p.name===pair.sourceName)||generalCatalogAttributeConflict(pair.alias,pair.sourceName)||syringeDescriptionConflict(pair.alias,pair.sourceName))continue;
  const target=result.get(pair.sourceName)||variants.get(pair.sourceName)||resolve(pair.sourceName)?.id||`source-confirmed:${directProductNameKey(pair.sourceName)}`;
  result.set(pair.alias,target);result.set(pair.sourceName,target);
 }
 return result;
}
