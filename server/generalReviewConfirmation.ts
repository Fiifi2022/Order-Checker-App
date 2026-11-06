import type {RequestHandler} from 'express';
import {canConfirmProductReview,generalReviewKey,reviewProductDrafts,reviewProductEvidence,type ReviewConfirmation} from '../shared/generalReviewConfirmation';
import {generalInputFingerprint,sameGeneralAuditSources} from '../shared/generalAuditFingerprint';
import {generalAuditMutations} from './generalAuditMutation';
import {canAccessAuditRecord} from './auditRecordAccess';
import {assertGeneralProductEvidence} from '../src/utils/generalProductEvidence';
import {revalidateGeneralAuditEvidence} from './generalAuditRevalidation';
import {summarizeGeneralProducts,type GeneralProductEvidence} from './generalAuditor';
import type {ProductCatalog} from '../shared/productCatalog';
import {generalReviewField} from '../src/utils/generalAuditReviews';

export function applyGeneralReviewConfirmation(record:any,decision:ReviewConfirmation,catalog:ProductCatalog,actor:{id:string;name:string}){
 const details=record.generalAudit;
 if(decision.verified!==true)throw Error('Verify the source products and quantities before confirming.');
 const prior=details.reviewConfirmations?.find((c:any)=>c.reviewKey===decision.reviewKey);
 if(prior){if(prior.inputFingerprint!==generalInputFingerprint(record)||JSON.stringify(prior.products)!==JSON.stringify(decision.products))throw Error('This review was already confirmed with different values. Open the current audit.');return record;}
 const review=details.semanticReviews?.find((r:any)=>generalReviewKey(r)===decision.reviewKey);
 if(!review||!canConfirmProductReview(review))throw Error('This product or quantity review is no longer available.');
 if(!Array.isArray(decision.products)||!decision.products.length||decision.products.length>30)throw Error('Enter the products and quantities shown in this source text.');
 const linked=reviewProductEvidence(record.items,review);
 const picked=reviewProductDrafts(record.items,review,details.extraction);
 if(!linked.length&&(decision.products.length!==picked.length||new Set(decision.products.map(row=>row.name)).size!==picked.length||picked.some(p=>!decision.products.some(row=>row.line===null&&row.name===p.name))))throw Error('Confirm the product names picked from the source; use product suggestions for a different identity.');
 if(linked.length&&(decision.products.length!==linked.length||new Set(decision.products.map(p=>p.line)).size!==linked.length||linked.some(p=>!decision.products.some(row=>row.line===p.line))))throw Error('Confirm every product in this review without adding unrelated entries.');
 const evidence:GeneralProductEvidence[]=[...new Map<string,GeneralProductEvidence>(record.items.flatMap((i:any)=>i.provenance).map((p:GeneralProductEvidence)=>[JSON.stringify([p.source,p.line,p.originalText]),p])).values()];
 let nextLine=Math.max(0,...evidence.filter(p=>p.source===review.source).map(p=>p.line))+1;
 const replacements=decision.products.map(row=>{
  const old=linked.find(p=>p.line===row.line);
  const sourceProduct=!old?picked.find(p=>p.name===row.name):undefined;
  if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.length>160||/[\n\r]/.test(row.name)||!/[a-z]/i.test(row.name)||typeof row.unit!=='string'||row.unit.length>30||/[^a-z /-]/i.test(row.unit))throw Error('Enter a product name and a valid quantity unit.');
  if(old&&row.name!==old.name)throw Error('Use the product suggestion controls to change an identified product.');
  const quantity=typeof row.quantity==='string'&&row.quantity.trim()?Number(row.quantity):NaN;
  if(!Number.isFinite(quantity)||quantity<0||review.source==='customer_request'&&quantity===0)throw Error('Enter a valid quantity for every product.');
  if(old&&!old.quantityReview&&(quantity!==old.quantity||row.unit!==(old.unit||'')))throw Error('Confirmation cannot change a quantity already read from the source.');
  if(sourceProduct?.quantity&&(quantity!==Number(sourceProduct.quantity)||row.unit!==sourceProduct.unit))throw Error('Confirmation cannot change a quantity already read from the source.');
  const denominator=row.confirmationRequested?.trim()?Number(row.confirmationRequested):undefined;
  if(denominator!==undefined&&(!Number.isFinite(denominator)||denominator<=0||quantity>denominator)||review.source==='fulfillment_confirmation'&&old?.ratioRequestedQuantity!==undefined&&denominator!==old.ratioRequestedQuantity)throw Error('Keep the recorded FS quantity consistent with the source.');
  if(review.source==='customer_request'&&denominator!==undefined)throw Error('FS recorded requested quantity applies only to fulfilment entries.');
  if(sourceProduct?.confirmationRequested&&denominator!==Number(sourceProduct.confirmationRequested))throw Error('Keep the recorded FS quantity consistent with the source.');
  const sourceText=review.source==='customer_request'?record.whatsappMessage:record.fulfillmentConfirmation;
  const sourceLine=sourceText?.split('\n').find((line:string)=>line.toLowerCase().includes(row.name.toLowerCase()));
  return {...old,name:row.name.trim(),quantity,unit:row.unit,source:review.source,line:old?.line??nextLine++,originalText:old?.originalText||sourceLine||review.originalText,normalizedName:old?.normalizedName||row.name.toLowerCase(),quantityReview:undefined,...(denominator!==undefined?{ratioRequestedQuantity:denominator}:{}),...(review.source==='fulfillment_confirmation'&&quantity===0?{stockIndicator:'out of stock'}: {})} as GeneralProductEvidence;
 });
 const remaining=evidence.filter(p=>!linked.includes(p)&&!linked.some(old=>old.source===p.source&&old.line===p.line&&old.originalText===p.originalText));
 const all=[...remaining,...replacements];
 const reviews=details.semanticReviews.filter((r:any)=>generalReviewKey(r)!==decision.reviewKey);
 const readability=structuredClone(details.extractionReadability||{});
 const assessment=readability[review.source];
 const covered=new Set([review.originalText,...linked.map(p=>p.originalText)].flatMap(text=>[text.trim(),...text.split('\n').map(line=>line.trim())]));
 if(assessment){for(const key of ['unreadProductText','unreadQuantityText'])assessment[key]=(assessment[key]||[]).filter((text:string)=>!covered.has(text.trim()));assessment.status=assessment.unreadProductText.length?'unreadable':'complete';}
 const {items,parameters}=revalidateGeneralAuditEvidence(all,catalog,details,{osuItems:record.items.filter((i:any)=>i.fulfillment.registeredOutOfStock).map((i:any)=>i.name)},readability);
 assertGeneralProductEvidence(items);
 const extraction=details.extraction?structuredClone(details.extraction):undefined;
 if(extraction)for(const [side,source] of [['customer','customer_request'],['fulfillment','fulfillment_confirmation']] as const){
  const products=all.filter(p=>p.source===source),pending=reviews.filter((r:any)=>r.source===source);
  extraction[side].products=products.map(p=>({name:p.name,quantity:p.quantityReview?null:p.quantity,unit:p.unit||null}));
  extraction[side].unresolvedFields=extraction[side].unresolvedFields.filter((field:string)=>
   field==='products'? !products.length||readability[source]?.status==='unreadable'||pending.some((r:any)=>generalReviewField(r)==='products'):
   field==='quantity'?products.some(p=>p.quantityReview)||pending.some((r:any)=>generalReviewField(r)==='quantity'):true);
 }
 const summary=summarizeGeneralProducts(items,details.facility,details.orderer,details.phone,items.filter(i=>i.provenance.some(p=>p.source==='customer_request')).length,items.filter(i=>i.provenance.some(p=>p.source==='fulfillment_confirmation')).length,reviews,{...parameters,productVerifications:(details.productVerifications||[]).filter((p:any)=>!p.requestedProducts.some((e:any)=>linked.some(old=>old.source===e.source&&old.line===e.line)))});
 const generalAudit={...details,...summary.generalAudit,...(extraction?{extraction}:{}),semanticReviews:summary.generalAudit.semanticReviews||[],extractionReadability:readability,reviewConfirmations:[...(details.reviewConfirmations||[]),{reviewKey:decision.reviewKey,products:decision.products,verified:true as const,source:review.source,originalText:review.originalText,confirmedBy:{id:actor.id,name:actor.name},confirmedAt:new Date().toISOString(),inputFingerprint:generalInputFingerprint(record)}]};
 return {...record,...summary,generalAudit,auditDecision:generalAudit.decision,finalVerdict:generalAudit.finalStatus,generalCounts:generalAudit.counts,...('isValid' in record?{isValid:summary.allMatch,auditStatus:summary.allMatch?'passed':generalAudit.decision==='review'?'requires_review':'failed'}:{}),...('discrepancies' in record?{discrepancies:generalAudit.discrepancies}:{}),resolutionNotes:summary.allMatch?generalAudit.finalStatus:'',resolvedAt:summary.allMatch?new Date().toISOString():null};
}
export function generalReviewConfirmationHandler(deps:{read:(id:string)=>Promise<any>;catalog:()=>Promise<ProductCatalog>;save:(record:any)=>Promise<void>}):RequestHandler{
 return async(req,res)=>{
  const body=req.body||{},actor=res.locals.authUser;
  if(!actor?.id){res.status(401).json({error:'Sign in before confirming a review.'});return;}
  if(typeof body.reviewKey!=='string'||body.verified!==true||!Array.isArray(body.products)){res.status(400).json({error:'Enter and verify the products and quantities before confirming.'});return;}
  const id=String(req.params.id),previous=generalAuditMutations.get(id);let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});generalAuditMutations.set(id,pending);await previous;
  try{
   const record=await deps.read(id);
   if(!record?.generalAudit){res.status(404).json({error:'General audit not found.'});return;}
   if(!canAccessAuditRecord(record,actor)){res.status(403).json({error:'Only the audit owner or an administrator may confirm this review.'});return;}
   if(!sameGeneralAuditSources(record,body)||body.inputFingerprint!==generalInputFingerprint(record)){res.status(409).json({error:'The messages changed. Open the current audit before confirming.'});return;}
   let updated;try{updated=applyGeneralReviewConfirmation(record,body,await deps.catalog(),actor);}catch(error:any){res.status(400).json({error:error.message});return;}
   if(updated!==record)await deps.save(updated);
   res.json(updated);
  }catch{res.status(503).json({error:'Confirmation could not be saved. Your audit is retained; retry confirmation.'});}
  finally{release();if(generalAuditMutations.get(id)===pending)generalAuditMutations.delete(id);}
 };
}
