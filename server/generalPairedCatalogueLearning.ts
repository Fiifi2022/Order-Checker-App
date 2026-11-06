import {catalogProductNames, type ProductCatalog, type CatalogAliasEvent} from '../shared/productCatalog';
import {resolveGeneralCatalogIdentity, generalCatalogAttributeConflict} from '../src/utils/generalProductLog';
import {trackCatalogueAliasEdits} from './catalogAliasLearning';
import {saveCatalogProduct} from './productCatalog';

export interface GeneralCatalogueSourcePair {customerName:string;fulfillmentName:string}
// Only spacing, case and grouping punctuation may differ. Preserve every word,
// digit, decimal, slash, strength, formulation and presentation qualifier.
export const pairedCatalogueNameKey=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/[\s()[\]{},]/g,'');
const numberTokens=(name:string)=>JSON.stringify(name.match(/\d+(?:\.\d+)?/g)||[]);
const validName=(name:unknown):name is string=>typeof name==='string' && name.trim().length>=6 && name.length<=160 &&
  /^[\p{L}]/u.test(name) && !/[\r\n!?<>:=@]|https?:|\b(?:receiver|reciever|orderer|facility|patient|phone|delivery|instructions|assistant|ignore|unknown|unspecified|unidentified)\b/i.test(name);

/** Both complete descriptions must agree independently of AI. Call again inside
 * the catalogue transaction; never create duplicates or bypass saved decisions. */
export function learnPairedCatalogueProducts(catalog:ProductCatalog,pairs:GeneralCatalogueSourcePair[],actor:string) {
 let current=catalog;let added=0;const events:CatalogAliasEvent[]=[];
 for(const pair of pairs.slice(0,24)) {
  if(!validName(pair.customerName)||!validName(pair.fulfillmentName) || /^(?:(?:new|test|other|some|requested)\s+)?(?:products?|medicines?|drugs?|items?|vaccines?)(?:\s+\d+)?$/i.test(pair.customerName.trim()))continue;
  const key=pairedCatalogueNameKey(pair.customerName);
  if(key!==pairedCatalogueNameKey(pair.fulfillmentName) || numberTokens(pair.customerName)!==numberTokens(pair.fulfillmentName) ||
    generalCatalogAttributeConflict(pair.customerName,pair.fulfillmentName))continue;
  if([pair.customerName,pair.fulfillmentName].some(name=>resolveGeneralCatalogIdentity(name,current.products).recognized))continue;
  if(current.products.some(product=>catalogProductNames(product).some(name=>pairedCatalogueNameKey(name)===key)) ||
    current.aliasRecords?.some(record=>pairedCatalogueNameKey(record.text)===key))continue;
  try {
  // No medicine class, packaging factor, vaccine identity or clinical equivalence
  // is invented. The FS description is the canonical headline.
  let next=saveCatalogProduct(current,{revision:current.revision,scope:'general',name:pair.fulfillmentName,displayName:pair.fulfillmentName,
    fulfillmentSystemName:pair.fulfillmentName,category:'product',aliases:pair.customerName!==pair.fulfillmentName?[pair.customerName]:[],contextualAliases:[],
    note:'Learned from matching complete product descriptions in customer and fulfilment messages.'},actor);
  const product=next.products.find(product=>product.name===pair.fulfillmentName && product.scope==='general');
  if(!product)continue;
  const tracked=trackCatalogueAliasEdits(current,next,actor);
  const learnedEvents=tracked.events.map(event=>({...event,after:{...event.after,source:'deterministic' as const,confidence:1,clinicalUncertainty:false,
    reason:'The complete customer and fulfilment descriptions agree after spacing and grouping punctuation normalization.'}}));
  const learnedRecords=new Map(learnedEvents.map(event=>[event.after.id,event.after]));
  next={...tracked.catalog,aliasRecords:tracked.catalog.aliasRecords?.map(record=>learnedRecords.get(record.id)||record)};
  events.push(...learnedEvents);
  current=next;added++;
  } catch { /* A conflict or invalid catalogue entry remains unresolved. */ }
 }
 return {catalog:current,events,added};
}
