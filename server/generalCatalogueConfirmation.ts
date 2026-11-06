import {revalidateGeneralAuditEvidence} from './generalAuditRevalidation';
import type {RequestHandler} from 'express';
import {catalogAliasKey,type ProductCatalog} from '../shared/productCatalog';
import {generalInputFingerprint,sameGeneralAuditSources} from '../shared/generalAuditFingerprint';
import {generalAuditMutations} from './generalAuditMutation';
import {canAccessAuditRecord} from './auditRecordAccess';
import {summarizeGeneralProducts,type GeneralProductEvidence} from './generalAuditor';

/** Apply an explicitly approved identity to the original audit, never run a new audit. */
export function applyCatalogueConfirmation(record:any,alias:string,productId:string,catalog:ProductCatalog,actor:{id:string;name:string}) {
 const details=record.generalAudit;
 const approved=catalog.aliasRecords?.some(row=>row.normalizedText===catalogAliasKey(alias)&&row.productId===productId&&row.status==='approved'&&row.active);
 if(!approved)throw Error('The selected alias must be approved in the catalogue before marking this audit.');
 if(details.catalogueConfirmations?.some((row:any)=>row.alias===alias&&row.productId===productId))return record;
 if(!details.catalogueSuggestions?.some((group:any)=>group.alias===alias&&group.options.some((option:any)=>option.productId===productId)))throw Error('This selection is not part of the saved audit.');
 const evidence:GeneralProductEvidence[]=[...new Map<string,GeneralProductEvidence>(record.items.flatMap((item:any)=>item.provenance).map((p:GeneralProductEvidence)=>[`${p.source}:${p.line}`,p] as const)).values()];
 const {items,resolve:lookup,parameters}=revalidateGeneralAuditEvidence(evidence,catalog,details,{osuItems:record.items.filter((item:any)=>item.fulfillment.registeredOutOfStock).map((item:any)=>item.name)});
 if(lookup(alias).product?.id!==productId)throw Error('The saved catalogue no longer resolves this selection.');
 const productMatchingDiagnostics=items.map(item=>({catalogRevision:catalog.revision,status:item.status,
  ...Object.fromEntries([['customer','customer_request'],['fulfillment','fulfillment_confirmation']].map(([key,source])=>[key,item.provenance.filter(p=>p.source===source).map(p=>{const identity=lookup(p.name);return {originalName:p.name,normalizedName:identity.normalizedName,catalogProductId:identity.product?.id||null,matchSource:identity.source||null,failureReason:identity.product?item.fulfillment.identityError||null:identity.reason,geminiCalled:false};})]))}));
 const summary=summarizeGeneralProducts(items,details.facility,details.orderer,details.phone,
  items.filter(item=>item.provenance.some(p=>p.source==='customer_request')).length,
  items.filter(item=>item.provenance.some(p=>p.source==='fulfillment_confirmation')).length,
  details.semanticReviews||[],{...parameters,catalogueSuggestions:details.catalogueSuggestions.filter((group:any)=>group.alias!==alias)});
 const generalAudit={...details,...summary.generalAudit,semanticReviews:summary.generalAudit.semanticReviews||[],orderLimitDecisions:details.orderLimitDecisions||{},
  catalogueConfirmations:[...(details.catalogueConfirmations||[]),{alias,productId,confirmedBy:{id:actor.id,name:actor.name},confirmedAt:new Date().toISOString(),inputFingerprint:generalInputFingerprint(record)}]};
 return {...record,...summary,generalAudit,productMatchingDiagnostics,...('isValid' in record?{isValid:summary.allMatch,auditStatus:summary.allMatch?'passed':generalAudit.decision==='review'?'requires_review':'failed'}:{}),...('discrepancies' in record?{discrepancies:generalAudit.discrepancies}:{}),auditDecision:generalAudit.decision,finalVerdict:generalAudit.finalStatus,generalCounts:generalAudit.counts,
  resolutionNotes:summary.allMatch?generalAudit.finalStatus:'',resolvedAt:summary.allMatch?new Date().toISOString():null};
}

export function generalCatalogueConfirmationHandler(deps:{read:(id:string)=>Promise<any>;catalog:()=>Promise<ProductCatalog>;save:(record:any)=>Promise<void>}):RequestHandler {
 return async(req,res)=>{
  const body=req.body||{};
  if(body.identityConfirmed!==true||typeof body.alias!=='string'||typeof body.productId!=='string'||typeof body.whatsappMessage!=='string'||typeof body.fulfillmentConfirmation!=='string') {res.status(400).json({error:'Select and verify the product before confirming.'});return;}
  const id=req.params.id,previous=generalAuditMutations.get(id);let release!:()=>void;
  const current=new Promise<void>(resolve=>{release=resolve;});generalAuditMutations.set(id,current);await previous;
  try {
   const record=await deps.read(id);
   if(!record?.generalAudit){res.status(404).json({error:'General audit not found.'});return;}
   if(!canAccessAuditRecord(record,res.locals.authUser)){res.status(403).json({error:'Only the audit owner or an administrator may update this audit.'});return;}
   if(!sameGeneralAuditSources(record,body)||body.inputFingerprint!==generalInputFingerprint(record)){res.status(409).json({error:'The messages changed. Audit the current messages before confirming.'});return;}
   const catalog=await deps.catalog();let updated;
   try{updated=applyCatalogueConfirmation(record,body.alias,body.productId,catalog,res.locals.authUser);}catch(error:any){res.status(409).json({error:error.message});return;}
   if(updated!==record)await deps.save(updated);
   res.json(updated);
  }catch{res.status(503).json({error:'Alias approval may be saved, but the audit update could not be confirmed. Retry confirmation; no new audit is needed.'});}
  finally{release();if(generalAuditMutations.get(id)===current)generalAuditMutations.delete(id);}
 };
}
