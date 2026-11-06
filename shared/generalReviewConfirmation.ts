import {generalReviewField} from '../src/utils/generalAuditReviews';
import type {GeneralSemanticReview,GeneralOrderExtractionSnapshot} from '../src/utils/generalAuditTypes';
import {parseGeneralProducts,stripGeneralListPrefix,type GeneralProductEvidence} from '../src/utils/generalAuditor';
import {generalInputFingerprint} from './generalAuditFingerprint';
import {generalOrderRelevantText} from '../src/utils/generalTextClassification';
import {recognizeGeneralDocument,generalDocumentLabel} from '../src/utils/generalDocumentStructure';
import {cleanGeneralProductDescription} from '../src/utils/generalProductMatching';

const sourceWords=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/(?<!\d)\.|\.(?!\d)/g,' ').replace(/[^\p{L}\p{N}.%]+/gu,' ').replace(/\s+/g,' ').trim();
const containsProduct=(text:string,name:string)=>!!sourceWords(name)&&(` ${sourceWords(text)} `).includes(` ${sourceWords(name)} `);

export type ReviewProduct = {line:number|null;name:string;quantity:string;unit:string;confirmationRequested:string};
export type ReviewConfirmation = {reviewKey:string;products:ReviewProduct[];verified:true};
export const generalReviewKey=(review:GeneralSemanticReview)=>JSON.stringify([review.source,generalReviewField(review),generalOrderRelevantText(review.originalText).trim()]);
export const canConfirmProductReview=(review:GeneralSemanticReview)=>!review.dosageFormKey&&['products','quantity'].includes(generalReviewField(review));
export function reviewProductEvidence(items:{provenance:GeneralProductEvidence[]}[],review:GeneralSemanticReview) {
 const text=generalOrderRelevantText(review.originalText).trim();
 const evidence=[...new Map(items.flatMap(item=>item.provenance).filter(p=>p.source===review.source&&p.originalText.trim())
  .map(p=>[JSON.stringify([p.source,p.line,p.originalText]),p])).values()];
 const linked=evidence.filter(p=>
  (text===generalOrderRelevantText(p.originalText).trim()||text.split('\n').some(line=>line.trim()===generalOrderRelevantText(p.originalText).trim())||containsProduct(text,p.name)))
 ;
 if(linked.length)return linked;
 // A separate "Quantity:" line belongs to a single unread quantity only.
 // Never choose between several products or borrow from the other source.
 const unread=evidence.filter(p=>p.quantityReview);
 return generalReviewField(review)==='quantity'&&unread.length===1?unread:[];
}
export function reviewProductDrafts(items:{provenance:GeneralProductEvidence[]}[],review:GeneralSemanticReview,snapshot?:GeneralOrderExtractionSnapshot):ReviewProduct[]{
 const evidence=reviewProductEvidence(items,review);
 if(evidence.length)return evidence.map(p=>({line:p.line,name:p.name,quantity:p.quantityReview?'':String(p.quantity),unit:p.unit||'',confirmationRequested:p.source!=='fulfillment_confirmation'||p.ratioRequestedQuantity===undefined?'':String(p.ratioRequestedQuantity)}));
 const text=generalOrderRelevantText(review.originalText).trim();
 const parsed=parseGeneralProducts(text,review.source);
 if(parsed.length)return parsed.map(p=>({line:null,name:p.name,quantity:p.quantityReview?'':String(p.quantity),unit:p.unit||'',confirmationRequested:review.source==='fulfillment_confirmation'&&p.ratioRequestedQuantity!==undefined?String(p.ratioRequestedQuantity):''}));
 // Reuse that source's extracted view. Never borrow an FS name or count to
 // manufacture a customer request (or the other way around).
 const source=snapshot?.[review.source==='customer_request'?'customer':'fulfillment'];
 const candidates=source?.products.filter(p=>containsProduct(text,p.name)||generalReviewField(review)==='quantity'&&source.products.length===1)||[];
 if(candidates.length)return candidates.map(p=>({line:null,name:p.name,quantity:p.quantity===null||!Number.isFinite(p.quantity)?'':String(p.quantity),unit:p.unit||'',confirmationRequested:''}));
 // A labelled or recognised unquantified product still supplies its own name.
 // Keep the count blank for explicit CCA verification rather than guessing it.
 const names=recognizeGeneralDocument(review.originalText).lines.flatMap(line=>{
  const label=generalDocumentLabel(line.originalText)||generalDocumentLabel(line.auditText);
  if(!(label?.field==='products'&&label.value)){
   if(line.kind!=='PRODUCT_ENTRY')return [];
  }
  const name=cleanGeneralProductDescription(stripGeneralListPrefix(label?.field==='products'?label.value:line.auditText));
  return name&&name.length<=160&&/[a-z]/i.test(name)&&!/[\n:?!]|https?:|\b(?:confirm|attached|following|contact|received|quantity|unclear|unknown)\b/i.test(name)?[name]:[];
 });
 return [...new Set(names)].map(name=>({line:null,name,quantity:'',unit:'',confirmationRequested:''}));
}
/** Confirmation is source-specific. It never approves product equivalence or a quantity shortfall. */
export async function confirmGeneralReview(request:(url:string,options:any)=>Promise<any>,record:any,decision:ReviewConfirmation){
 const updated=await request(`/api/audits/${encodeURIComponent(record.id)}/review-confirmation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...decision,whatsappMessage:record.whatsappMessage,fulfillmentConfirmation:record.fulfillmentConfirmation,inputFingerprint:generalInputFingerprint(record)})});
 if(updated?.id!==record.id||!updated.generalAudit?.reviewConfirmations?.some((c:any)=>c.reviewKey===decision.reviewKey))throw Error('The server did not confirm this review. Please retry.');
 return updated;
}
