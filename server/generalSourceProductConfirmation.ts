import {revalidateGeneralAuditEvidence} from './generalAuditRevalidation';
import {directProductNameKey} from '../shared/generalDirectProduct';
import {generalCatalogAttributeConflict,createGeneralCatalogResolver,relatedGeneralCatalogDescriptions} from '../src/utils/generalProductLog';
import {syringeDescriptionConflict} from '../shared/syringeIdentity';
import {summarizeGeneralProducts} from './generalAuditor';
import {generalInputFingerprint} from '../shared/generalAuditFingerprint';
import type {ProductCatalog} from '../shared/productCatalog';
import type {ProductResearchOption} from '../shared/productResearch';
export function sourceProductOptions(alias:string,catalog:ProductCatalog,names:string[],all=false):ProductResearchOption[]{
 const resolve=createGeneralCatalogResolver(catalog.products);
 const words=(name:string)=>(name.toLowerCase().match(/[a-z]{3,}/g)||[]).filter(word=>!['new','medicine','medicines','product','products','tablet','tablets','capsule','capsules','injection','infusion','syrup','suspension','solution','vial','vials','bottle','pack','for','and','dose'].includes(word));
 return [...new Set(names)].filter(name=>name!==alias&&name.length<=160&&!resolve(name).product&&!generalCatalogAttributeConflict(alias,name)&&!syringeDescriptionConflict(alias,name)&&(all||relatedGeneralCatalogDescriptions(alias,name)||words(alias).some(word=>words(name).includes(word)))).slice(0,12).map(name=>({productId:`source:${directProductNameKey(name)}`,kind:'source',sourceName:name,name,confidenceCategory:'MEDIUM',evidenceSource:'source',reason:'This description appears in the other source. Verify that both descriptions refer to the same product; wording alone is not clinical proof.'}));
}
export function applySourceProductConfirmation(record:any,alias:string,sourceName:string,catalog:ProductCatalog,actor:{id:string;name:string}){
 const details=record.generalAudit,fingerprint=generalInputFingerprint(record);
 const group=details.catalogueSuggestions?.find((g:any)=>g.alias===alias);
 if(!group?.options.some((o:any)=>o.kind==='source'&&o.sourceName===sourceName&&!group.rejectedProductIds?.includes(o.productId)))throw Error('This source suggestion is no longer available.');
 const evidence:any[]=[...new Map(record.items.flatMap((i:any)=>i.provenance).map((p:any)=>[`${p.source}:${p.line}`,p])).values()];
 if(!evidence.some(p=>p.source==='customer_request'&&p.name===alias)||!evidence.some(p=>p.source==='fulfillment_confirmation'&&p.name===sourceName)||generalCatalogAttributeConflict(alias,sourceName)||syringeDescriptionConflict(alias,sourceName))throw Error('The source products or their stated clinical attributes do not support this confirmation.');
 const confirmations=[...(details.sourceProductConfirmations||[]).filter((c:any)=>c.alias!==alias),{alias,sourceName,confirmedBy:{id:actor.id,name:actor.name},confirmedAt:new Date().toISOString(),inputFingerprint:fingerprint}];
 const {items,resolve,parameters}=revalidateGeneralAuditEvidence(evidence,catalog,details,{sourceProductConfirmations:confirmations,osuItems:record.items.filter((i:any)=>i.fulfillment.registeredOutOfStock).map((i:any)=>i.name)});
 const suggestions=(details.catalogueSuggestions||[]).filter((g:any)=>g.alias!==alias&&g.alias!==sourceName);
 const reviews=(details.semanticReviews||[]).filter((r:any)=>!evidence.some(p=>[alias,sourceName].includes(p.name)&&p.source===r.source&&p.originalText===r.originalText));
 const summary=summarizeGeneralProducts(items,details.facility,details.orderer,details.phone,details.productCount.requested,details.productCount.found,reviews,{...parameters,catalogueSuggestions:suggestions});
 const diagnostics=items.map(item=>({catalogRevision:catalog.revision,status:item.status,...Object.fromEntries([['customer','customer_request'],['fulfillment','fulfillment_confirmation']].map(([key,source])=>[key,item.provenance.filter(p=>p.source===source).map(p=>({originalName:p.name,normalizedName:resolve(p.name).normalizedName,catalogProductId:resolve(p.name).product?.id||null,matchSource:p.matchedProductKey?.startsWith('source-confirmed:')?'CCA source confirmation':resolve(p.name).source||'Direct source comparison',failureReason:item.fulfillment.identityError||null,geminiCalled:false}))]))}));
 return {...record,...summary,generalAudit:{...details,...summary.generalAudit,sourceProductConfirmations:confirmations},productMatchingDiagnostics:diagnostics,...('isValid' in record?{isValid:summary.allMatch,auditStatus:summary.allMatch?'passed':summary.generalAudit.decision==='review'?'requires_review':'failed'}:{}),...('discrepancies' in record?{discrepancies:summary.generalAudit.discrepancies}:{}),auditDecision:summary.generalAudit.decision,finalVerdict:summary.generalAudit.finalStatus,generalCounts:summary.generalAudit.counts,resolutionNotes:summary.allMatch?summary.generalAudit.finalStatus:'',resolvedAt:summary.allMatch?new Date().toISOString():null};
}
