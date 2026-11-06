import type {CatalogProduct} from './productCatalog';

export interface SyringeSpecifications {
 capacityMl?:number;
 needleIncluded?:boolean;
 gauge?:number;
 needleLengthMm?:number;
 use?:string;
 mechanism?:string;
 connector?:string;
}
export function normalizeSyringeText(raw:string):string {
 let value=raw.replace(/½/g,'0.5').replace(/¼/g,'0.25').replace(/¾/g,'0.75').normalize('NFKC').toLowerCase()
  .replace(/\bhalf\s*(?:a\s*)?(?:ml|millilit(?:re|er)s?)\b/g,'0.5ml')
  .replace(/\bsolo[\s-]*shots?\b/g,'soloshot').replace(/\b(?:syringes|syring|syringes?)\b/g,'syringe')
  .replace(/\bneedles\b/g,'needle').replace(/\bdisp\.?\b/g,'disposable')
  .replace(/(\d+(?:\.\d+)?)\s*(?:microlit(?:re|er)s?|[uµμ]l)\b/g,(_,n)=>`${Number((Number(n)/1000).toPrecision(12))}ml`)
  .replace(/(\d+(?:\.\d+)?)\s*(?:cc|mls?|millilit(?:re|er)s?)\b/g,(_,n)=>`${Number(n)}ml`)
  .replace(/\b(\d*\.\d+)\s*(?=soloshot\b)/g,'$1ml ')
  .replace(/\b(soloshot)\s+(\d*\.\d+)(?![\d.]|\s*ml)\b/g,'$1 $2ml')
  .replace(/\bauto[ -]?disable(?:d)?\b/g,'auto-disable').replace(/\bwithout\s+(?:a\s+)?needle\b/g,'without needle')
  .replace(/\bwith\s+(?:a\s+)?needle\b/g,'and needle').replace(/[&+]/g,' and ')
  .replace(/\s+/g,' ').trim();
 return value;
}
export function isSyringeDescription(name:string):boolean {return /\b(?:syring(?:e|es)?|needles?|solo[\s-]*shots?)\b/i.test(name);}
export function syringeSpecifications(name:string):SyringeSpecifications|undefined {
 if(!isSyringeDescription(name))return;
 const value=normalizeSyringeText(name),volumes=[...value.matchAll(/\b(\d+(?:\.\d+)?)ml\b/g)].map(m=>Number(m[1]));
 const gauge=value.match(/\b(\d{1,2})\s*(?:g|gauge)\b|\bgauge\s*(\d{1,2})\b/);
 const length=value.match(/\b(\d+(?:\.\d+)?)\s*(mm|inches?|inch|in)\b/);
 const use=value.match(/\b(insulin|tuberculin|oral|enteral|irrigation)\b/);
 const mechanism=value.match(/\b(auto-disable|safety|retractable)\b/);
 const connector=value.match(/\bluer[ -]?(lock|slip)\b/);
 return {...(volumes.length===1?{capacityMl:volumes[0]}:{}),
  ...(/\bwithout needle\b/.test(value)?{needleIncluded:false}:/\bsyringe\s*(?:and|with)\s*needle\b/.test(value)?{needleIncluded:true}:{}),
  ...(gauge?{gauge:Number(gauge[1]||gauge[2])}:{}),...(length?{needleLengthMm:Number((Number(length[1])*(length[2]==='mm'?1:25.4)).toPrecision(12))}:{}),
  ...(use?{use:use[1]}:{}),...(mechanism?{mechanism:mechanism[1].replace(/[ -]/g,'')}:{}),...(connector?{connector:connector[1]}:{}),
 };
}
export function productSyringeSpecifications(product:CatalogProduct):SyringeSpecifications|undefined {
 const parsed=syringeSpecifications(product.name);
 return parsed?{...parsed,...product.deviceSpecifications}:undefined;
}
export function syringeSpecificationConflict(left:SyringeSpecifications|undefined,right:SyringeSpecifications|undefined):string|undefined {
 if(!left||!right)return;
 for(const key of ['capacityMl','needleIncluded','gauge','needleLengthMm','use','mechanism','connector'] as const) {
  if(left[key]!==undefined&&right[key]!==undefined&&left[key]!==right[key])return key==='capacityMl'?'Product Size Mismatch: syringe capacities differ.':`Syringe ${key==='needleIncluded'?'needle inclusion':key} differs.`;
 }
}
export function syringeDescriptionConflict(a:string,b:string){return syringeSpecificationConflict(syringeSpecifications(a),syringeSpecifications(b));}
const label=(value:string)=>normalizeSyringeText(value).replace(/[^a-z0-9.]+/g,' ').trim().split(/\s+/).sort().join(' ');
export function unsafeSyringeAlias(alias:string,product:CatalogProduct):boolean {
 const target=productSyringeSpecifications(product);if(!target)return false;
 if(/[:=]\s*\d|\[\s*\d+(?:\s*\/\s*\d+)?\s*\]|\bx\s*\d+\s*$/i.test(alias))return true;
 const normalized=normalizeSyringeText(alias);
 if(/\b(?:syringe|needle|soloshot)\s+\d+(?:\.\d+)?(?:\s*(?:pieces?|units?))?$/.test(normalized))return true;
 if(/^\d+(?:\.\d+)?ml$/.test(normalized))return true;
 const source=syringeSpecifications(alias);
 return !!syringeSpecificationConflict(source,target)||!!source?.capacityMl&&!target.capacityMl;
}
/** Literal units only; never take a capacity as a count or infer a package conversion. */
export function normalizeSyringeOrderLine(line:string):string {
 if(!isSyringeDescription(line))return line;
 let value=line.replace(/½/g,'0.5').replace(/¼/g,'0.25').replace(/¾/g,'0.75')
  .replace(/\bhalf\s*(?:a\s*)?(?:ml|millilit(?:re|er)s?)\b/gi,'0.5ml')
  .replace(/(\d+(?:\.\d+)?)\s*(?:microlit(?:re|er)s?|[uµμ]l)\b/gi,(_,n)=>`${Number((Number(n)/1000).toPrecision(12))}ml`)
  .replace(/(\d+(?:\.\d+)?)\s*cc\b/gi,'$1ml')
  .replace(/\b(\d*\.\d+)\s*(?=solo[\s-]*shots?\b)/gi,'$1ml ');
 return value.replace(/^(\d+)\s+of\s+(?:the\s+)?/i,'$1 pieces of ')
  .replace(/^(\d+)\s+(pieces?|units?)\s+of\s+the\s+/i,'$1 $2 of ');
}
export function resolveSyringeCatalogue(name:string,products:readonly CatalogProduct[]):{product?:CatalogProduct;recognized:boolean;source?:'Exact'|'Alias'|'Normalized';alias?:string;reason?:string;normalizedName:string}|undefined {
 if(!isSyringeDescription(name))return;
 const normalizedName=label(name),source=syringeSpecifications(name)!;
 const records=products.filter(p=>!!productSyringeSpecifications(p));
 const unresolved=(reason:string)=>({normalizedName,recognized:false,reason});
 const compatible=(p:CatalogProduct)=>{
  const target=productSyringeSpecifications(p)!;
  if(syringeSpecificationConflict(source,target))return false;
  if(source.capacityMl!==undefined&&target.capacityMl===undefined)return false;
  if(['gauge','needleLengthMm','use','mechanism','connector','needleIncluded'].some(key=>source[key as keyof SyringeSpecifications]!==undefined&&target[key as keyof SyringeSpecifications]===undefined))return false;
  return true;
 };
 const choose=(matches:CatalogProduct[],kind:'Exact'|'Alias'|'Normalized',alias?:string)=>{
  const unique=[...new Map(matches.map(p=>[p.id,p])).values()];
  if(unique.length!==1)return unresolved('Syringe capacity or configuration requires confirmation against the catalogue.');
  return {product:unique[0],normalizedName,recognized:true,source:kind,alias};
 };
 const named=records.filter(p=>compatible(p)&&label(p.name)===normalizedName);
 if(named.length)return choose(named,'Exact');
 const aliases=records.filter(p=>compatible(p)&&[p.displayName,p.fulfillmentSystemName,...p.aliases].some(a=>a&&!unsafeSyringeAlias(a,p)&&!p.contextualAliases.some(c=>label(c)===label(a))&&label(a)===normalizedName));
 if(aliases.length&&source.capacityMl!==undefined)return choose(aliases,'Alias',name);
 if(source.capacityMl===undefined)return unresolved('Specify the syringe capacity and any required needle configuration.');
 // Never interpret a solo-shot description as a combination unless an approved
 // whole-label alias or the canonical catalogue family supports that wording.
 const family=/\bsoloshot\b/.test(normalizeSyringeText(name))?'soloshot':/\bsyringe\b/.test(normalizeSyringeText(name))?'syringe':'needle';
 const residual=normalizeSyringeText(name).replace(/\b\d+(?:\.\d+)?(?:ml|mm|g|gauge|inches?|inch|in)\b/g,' ')
  .replace(/\b(?:disposable|syringe|soloshot|needle|and|with|without|insulin|tuberculin|oral|enteral|irrigation|auto-disable|safety|retractable|luer|lock|slip|gauge)\b/g,' ').replace(/[\s,()./-]/g,'');
 if(residual)return unresolved('Unfamiliar syringe terminology requires a verified catalogue alias.');
 const candidates=records.filter(p=>compatible(p)&&productSyringeSpecifications(p)!.capacityMl===source.capacityMl&&
  (family==='soloshot'?/\bsoloshot\b/.test(normalizeSyringeText(p.name)):
   family==='needle'?!/\bsyringe\b/.test(normalizeSyringeText(p.name)):/\bsyringe\b/.test(normalizeSyringeText(p.name))));
 return choose(candidates,'Normalized');
}
