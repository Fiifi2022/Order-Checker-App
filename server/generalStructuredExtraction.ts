import {generalAccessoryPreviewChecks,prepareGeneralVaccineList,buildGeneralAccessoryCatalog} from './generalAccessoryAudit';
import {extractGeneralOrderDeterministically,redactGeneralClinicalText} from './generalOrderExtraction';
import {recoverGeneralOrderer} from './generalOrdererExtraction';
import {locateGeneralSystemOrderer,locateGeneralCustomerFacility,locateGeneralSystemFacility,parseGeneralProducts,generalFourParameterRecord,type GeneralProductSource,type GeneralProductEvidence} from './generalAuditor';
import {createGeneralCatalogResolver} from '../src/utils/generalProductLog';
import {stripGeneralNonOrderInformation,generalOrderRelevantText} from '../src/utils/generalTextClassification';
import {projectFourFieldFulfillment} from './generalFourFieldInput';
import {unreadGeneralProductLines} from './generalExtractionCompleteness';
import {generalDocumentLabel} from '../src/utils/generalDocumentStructure';
import {GENERAL_COUNT_UNIT_PATTERN} from '../shared/generalQuantityUnits';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import type {ProductCatalog} from '../shared/productCatalog';
import type {GeneralFacilityContext} from '../src/utils/generalFacility';
import type {GeneralStructuredField,GeneralStructuredSource,GeneralStructuredProduct,GeneralStructuredPreview,GeneralExtractionSubmission,GeneralExtractionChange} from '../shared/generalStructuredExtraction';

/** General website only. Irrelevant clinical/contact details never reach matching,
 * AI, preview JSON or persistence. The untouched draft remains in the browser. */
export function cleanGeneralStructuredSource(raw:string){
 return redactGeneralClinicalText(stripGeneralNonOrderInformation(raw)).replace(/\[patient redacted\]|\[clinical detail redacted\]|\[contact redacted\]/g,'').trim();
}
const field=(value:string|null,ambiguous=false):GeneralStructuredField=>({value:value==='N/A'?null:value,status:ambiguous?'ambiguous':value&&value!=='N/A'?'extracted':'not detected'});
function extractSource(raw:string,source:GeneralProductSource,catalog:ProductCatalog,context:GeneralFacilityContext):GeneralStructuredSource{
 const sourceText=cleanGeneralStructuredSource(raw),resolve=createGeneralCatalogResolver(catalog.products);
 let prepared=source==='fulfillment_confirmation'?projectFourFieldFulfillment(sourceText)
  .replace(/\bWe\s+(?:will(?:\s+now)?|can)\s+prepare\s+the\s+following\s+(?:items|products)(?:\s+for\s+delivery)?\s*:/gi,'\n'):sourceText;
 // Only an independently recognized catalogue expression can be stripped of
 // request wording. Never turn arbitrary prose into a medicine by guessing.
 if(source==='customer_request')prepared=prepareGeneralVaccineList(prepared,catalog,buildGeneralAccessoryCatalog(catalog));
 prepared=prepared.split('\n').map(line=>{
  const candidate=line.trim().replace(/^(?:please|kindly)\s+/i,'').replace(/^(?:additional|more|urgent(?:ly)?)\s+/i,'').replace(/\s+(?:is\s+)?(?:needed|required)[.!]?$/i,'').trim();
  return candidate!==line.trim()&&resolve(candidate).product?candidate:line;
 }).join('\n');
 let input:Pick<ReturnType<typeof extractGeneralOrderDeterministically>,'text'|'unresolvedText'|'conflictingFields'>;
 try{input=extractGeneralOrderDeterministically(prepared,source,context,undefined,catalog.products.flatMap(p=>[p.name,...p.aliases]),{requestLanguage:true});}
 catch{input={text:prepared,unresolvedText:[]};}
 let parsed:GeneralProductEvidence[]=[],productFailure=false;
 try{parsed=parseGeneralProducts(input.text,source);}catch{productFailure=true;}
 const products:GeneralStructuredProduct[]=parsed.map((p,index)=>({entryId:`line:${p.line}:${index}`,name:p.name,quantity:p.quantityReview?null:p.quantity,unit:p.unit||'',confirmationRequested:p.ratioRequestedQuantity??null,
  originalText:p.originalText,status:p.quantityReview?'ambiguous':'extracted',...(p.quantityReview?{reason:p.quantityReview}:{}),stockout:!!(p.stockSection||p.stockIndicator),orderLimit:!!p.orderLimitApplied}));
 // Keep unquantified known products visible and associate a separate quantity
 // only when exactly one product lacks a count and exactly one count is stated.
 for(const line of input.text.split('\n')){
  const label=generalDocumentLabel(line);
  const name=(label?.field==='products'?label.value:line).replace(/^\s*(?:[-*•]|\d+[.)-]|\(\d+\))\s*/,'').trim();
  if(resolve(name).product&&!products.some(p=>p.name.toLowerCase()===name.toLowerCase()||p.originalText===line.trim()))products.push({entryId:`unquantified:${products.length}`,name,quantity:null,unit:'',confirmationRequested:null,originalText:line.trim(),status:'ambiguous',reason:'Quantity not detected.',stockout:false,orderLimit:false});
 }
 const countPattern=new RegExp(`^\\s*(?:(?:quantity(?: needed)?|qty|amount|NB)\\s*[:=]\\s*)?(\\d+(?:,\\d{3})*(?:\\.\\d+)?)(?:\\s*\\/\\s*\\1)?\\s*(${GENERAL_COUNT_UNIT_PATTERN})?\\s*[.!]?\\s*$`,'i');
 const counts=prepared.split('\n').map(line=>line.match(countPattern)).filter((m):m is RegExpMatchArray=>!!m);
 const pending=products.filter(p=>p.quantity===null);
 if(pending.length===1&&products.length===1&&counts.length===1){pending[0].quantity=Number(counts[0][1].replace(/,/g,''));pending[0].unit=counts[0][2]||'';pending[0].status='extracted';delete pending[0].reason;}
 const identityText=generalOrderRelevantText(input.text);
 let orderer:GeneralStructuredField,facility:GeneralStructuredField;
 try{orderer=field(locateGeneralSystemOrderer(identityText,'N/A',undefined,source==='fulfillment_confirmation'),input.conflictingFields?.includes('ordererName'));}catch{orderer={value:null,status:'parsing failure',reason:'Orderer parsing failed. Other fields were extracted independently.'};}
 try{facility=field(source==='customer_request'?locateGeneralCustomerFacility(identityText):locateGeneralSystemFacility(identityText,'N/A'),input.conflictingFields?.includes('facilityName'));}catch{facility={value:null,status:'parsing failure',reason:'Facility parsing failed. Other fields were extracted independently.'};}
 if(orderer.value&&facility.value&&orderer.value.toLowerCase()===facility.value.toLowerCase())orderer=field(null);
 let unreadProducts:string[]=[];
 try{unreadProducts=unreadGeneralProductLines(input.unresolvedText,source).filter(line=>!products.some(p=>p.originalText===line.trim()||p.name===line.trim())&&!countPattern.test(line));}catch{productFailure=true;}
 if(productFailure)unreadProducts.push('Product parsing failed. Confirm the products against the source.');
 return {sourceText,orderer,facility,products,unreadProducts};
}
export function extractGeneralStructuredPreview(customer:string,fulfillment:string,catalog:ProductCatalog,context:GeneralFacilityContext={}):GeneralStructuredPreview{
 const failure=(raw:string):GeneralStructuredSource=>({sourceText:cleanGeneralStructuredSource(raw),orderer:{value:null,status:'parsing failure',reason:'Identity parsing failed; correct or retry extraction.'},facility:{value:null,status:'parsing failure'},products:[],unreadProducts:['Product parsing failed. Confirm the products in the source.']});
 let a:GeneralStructuredSource,b:GeneralStructuredSource;
 try{a=extractSource(customer,'customer_request',catalog,context);}catch{a=failure(customer);}
 try{b=extractSource(fulfillment,'fulfillment_confirmation',catalog,context);}catch{b=failure(fulfillment);}
 if(!a.orderer.value&&a.orderer.status!=='parsing failure'){
  const recovered=recoverGeneralOrderer(a.sourceText,b.sourceText,catalog,{facilityContext:context});
  a.orderer={value:recovered.value,status:recovered.status==='needs confirmation'?'ambiguous':recovered.status==='extraction error'?'parsing failure':recovered.value?'extracted':'not detected',reason:recovered.reason};
 }
 const accessoryChecks=generalAccessoryPreviewChecks(a.products,b.products,catalog);
 return {...(accessoryChecks.length?{accessoryChecks}:{}),version:1,catalogRevision:catalog.revision,inputFingerprint:generalInputFingerprint({whatsappMessage:a.sourceText,fulfillmentConfirmation:b.sourceText}),customer:a,fulfillment:b};
}
const fail=(message:string):never=>{throw Object.assign(Error(message),{status:400});};
export function applyGeneralExtractionSubmission(preview:GeneralStructuredPreview,submission:GeneralExtractionSubmission,actor:{id:string;name:string}){
 if(submission?.version!==1||submission.inputFingerprint!==preview.inputFingerprint||submission.catalogRevision!==preview.catalogRevision)fail('The source text or catalogue changed. Extract the current messages again.');
 if(!Array.isArray(submission.edits)||submission.edits.length>6||!Array.isArray(submission.confirmedFields)||submission.confirmedFields.some(key=>!/^\b(customer|fulfillment)\.(orderer|facility|products)\b$/.test(key)))fail('Choose corrections for the current structured preview.');
 const result=structuredClone(preview),changes:GeneralExtractionChange[]=[],seen=new Set<string>();
 for(const edit of submission.edits){
  if(!edit||!['customer','fulfillment'].includes(edit.source)||!['orderer','facility','products'].includes(edit.field))fail('Invalid extraction correction.');
  const key=`${edit.source}.${edit.field}`;if(seen.has(key))fail('Correct each field once.');seen.add(key);
  const source=result[edit.source];const before=edit.field==='products'?{products:source.products,unreadProducts:source.unreadProducts}:source[edit.field].value;
  if(edit.field==='products'){
   if(!Array.isArray(edit.value)||edit.value.length>100)fail('Provide individual product entries.');
   source.products=(edit.value as GeneralStructuredProduct[]).map((entry,index)=>{
    if(!entry||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>300||/[\r\n]/.test(entry.name)||typeof entry.unit!=='string'||entry.unit.length>40||/[\r\n]/.test(entry.unit)||![entry.quantity,entry.confirmationRequested].every(n=>n===null||typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e9))fail('Check each product name, quantity and unit.');
    const original=source.products.find(p=>p.entryId===entry.entryId&&typeof entry.entryId==='string');
    return {...(original?{entryId:original.entryId}:{}),name:entry.name.trim(),quantity:entry.quantity,unit:entry.unit,confirmationRequested:entry.confirmationRequested,originalText:original?.originalText||'CCA added from original source',status:entry.quantity===null?'ambiguous':'extracted',stockout:original?.stockout||false,orderLimit:original?.orderLimit||false};
   });
   source.unreadProducts=[];
  }else{
   if(edit.value!==null&&(typeof edit.value!=='string'||edit.value.length>300||/[\r\n]/.test(edit.value)))fail('Provide one extracted identity value.');
   source[edit.field]=field((edit.value as string|null)?.trim()||null);
  }
  const after=edit.field==='products'?source.products:source[edit.field].value;
  if(JSON.stringify(before)!==JSON.stringify(after))changes.push({source:edit.source,field:edit.field,before,after,reason:submission.reason,actor,at:new Date().toISOString()});
 }
 if(changes.length&&(submission.acknowledged!==true||typeof submission.reason!=='string'||!submission.reason.trim()||submission.reason.length>500))fail('Acknowledge manual corrections and give a brief reason before comparing.');
 if(submission.confirmedFields.length&&submission.acknowledged!==true)fail('Acknowledge verification against the original messages.');
 for(const key of submission.confirmedFields){const [side,name]=key.split('.') as ['customer'|'fulfillment','orderer'|'facility'|'products'];const source=result[side];
  if(name==='products'){for(const p of source.products)if(p.quantity!==null)p.status='extracted';}
  else if(source[name].value)source[name].status='extracted';
 }
 return {preview:result,changes,confirmedFields:submission.confirmedFields,actor,at:new Date().toISOString()};
}
export function projectGeneralStructuredSource(source:GeneralStructuredSource,side:'customer'|'fulfillment'){
 return [source.orderer.value?`Orderer: ${source.orderer.value}`:'',source.facility.value?`Facility: ${source.facility.value}`:'',...source.products.map(p=>{
  const quantity=p.quantity===null?'':side==='fulfillment'?`[${p.quantity}/${p.confirmationRequested??p.quantity}]`:`- ${p.quantity}`;
  const heading=side==='fulfillment'?(p.stockout?'We are partially out of stock for the following items:':'We will now prepare the following items for delivery:')+'\n- ':'';
  return `${heading}${p.name} ${quantity}${p.unit?' '+p.unit:''}${p.orderLimit?' (order limit applied)':''}`.trim();
 }),...source.unreadProducts].filter(Boolean).join('\n');
}
export function finishGeneralStructuredAudit(record:any,extraction:ReturnType<typeof applyGeneralExtractionSubmission>){
 // Projection is a comparison format, never the original evidence. Restore
 // source wording by occurrence, without borrowing names/counts across sides.
 const originals=new Map<GeneralProductEvidence,string>();
 for(const side of ['customer','fulfillment'] as const){
  const source=side==='customer'?'customer_request':'fulfillment_confirmation';
  const remaining=[...extraction.preview[side].products];
  const evidence:GeneralProductEvidence[]=record.items.flatMap((item:any)=>item.provenance).filter((p:GeneralProductEvidence)=>p.source===source).sort((a:GeneralProductEvidence,b:GeneralProductEvidence)=>a.line-b.line);
  for(const p of evidence){
   const index=remaining.findIndex(row=>row.name===p.name&&(row.quantity===null?!!p.quantityReview:row.quantity===p.quantity));
   if(index<0)continue;
   originals.set(p,remaining.splice(index,1)[0].originalText);
  }
 }
 const items=record.items.map((item:any)=>({...item,provenance:item.provenance.map((p:GeneralProductEvidence)=>originals.has(p)?{...p,sourceOriginalText:originals.get(p)}:p)}));
 const details={...record.generalAudit,structuredExtraction:extraction};
 for(const field of ['orderer','facility'] as const)if(['customer','fulfillment'].some(side=>['ambiguous','parsing failure'].includes(extraction.preview[side as 'customer'|'fulfillment'][field].status)))details[field]={...details[field],status:'review required',reason:'The extracted source identity requires CCA confirmation.'};
 const extractionReviews=(['customer','fulfillment'] as const).flatMap(side=>extraction.preview[side].unreadProducts.map(originalText=>({kind:'unparsed_text' as const,field:'products' as const,
  source:side==='customer'?'customer_request' as const:'fulfillment_confirmation' as const,originalText,requiresConfirmation:true,possibleMatches:[],reason:'Product extraction is incomplete. Confirm or correct this source entry before clearing the audit.'})));
 details.semanticReviews=[...(details.semanticReviews||[]),...extractionReviews];
 return generalFourParameterRecord({...record,items,generalAudit:details});
}
