import {generalProductFindingText} from './generalProductFinding';
export type ResolutionState='completed'|'pending research'|'suggested resolution'|'awaiting CCA confirmation'|'confirmed'|'rejected'|'unresolved discrepancy';
export interface ResolutionIssue {id:string;field:'facility'|'orderer'|'product'|'quantity';label:string;state:ResolutionState;reason:string}
/** Derived from the saved comparison, not a second verdict engine. District/drop area are never checks. */
export function generalResolutionQueue(record:any){
 const details=record?.generalAudit;if(!details)return {sessionId:record?.id,checks:[] as ResolutionIssue[],completed:0,pending:0,unresolved:0,confirmed:0,total:0};
 const checks:ResolutionIssue[]=[];
 for(const field of ['facility','orderer'] as const){
  const value=details[field],decision=value?.identityDecision?.action;
  const state:ResolutionState=decision==='confirm'?'confirmed':decision==='reject'?'rejected':value?.status==='match'?'completed':details.identityResearch?.[field]?.status==='deferred'?'pending research':value?.status==='review required'?'awaiting CCA confirmation':'unresolved discrepancy';
  checks.push({id:field,field,label:field==='facility'?'Facility':'Customer name',state,reason:details.identityResearch?.[field]?.suggestion?.reason||value?.reason||''});
 }
 const suggestions=details.catalogueSuggestions||[],covered=new Set(suggestions.map((g:any)=>g.alias));
 for(const group of suggestions){
  const last=group.history?.at(-1),state:ResolutionState=group.retainedDiscrepancy?'unresolved discrepancy':group.researchStatus==='deferred'?'pending research':group.options.length?'suggested resolution':last?.action==='reject'?'rejected':'unresolved discrepancy';
  checks.push({id:'product:'+group.alias,field:'product',label:group.alias,state,reason:group.retainedDiscrepancy?'CCA retained this discrepancy.':group.options.length?'Select a candidate, verify its attributes, then Confirm & Resume.':group.nextSteps?.[0]||'Clarify the product identity.'});
 }
 for(const item of record.items||[]){
  const coveredProduct=item.provenance?.some((p:any)=>covered.has(p.name));
  const fulfillment=item.fulfillment||{},key=fulfillment.key||item.name;
  const approved=details.sourceProductConfirmations?.some((c:any)=>item.provenance?.some((p:any)=>p.name===c.alias))||details.catalogueConfirmations?.some((c:any)=>item.provenance?.some((p:any)=>p.name===c.alias));
  const uncertain=fulfillment.identityReviewRequired||item.status==='review required'||item.status==='customer confirmation required';
  if(!coveredProduct)checks.push({id:'product:'+key,field:'product',label:item.name,state:approved?'confirmed':uncertain?'awaiting CCA confirmation':['missing item','extra item','product identity discrepancy','vaccine pairing mismatch'].includes(item.status)?'unresolved discrepancy':'completed',reason:fulfillment.identityError||''});
  const quantityState:ResolutionState=coveredProduct||uncertain?'awaiting CCA confirmation':fulfillment.fulfillmentStatus==='pending order limit'||fulfillment.fulfillmentStatus==='quantity review'?'awaiting CCA confirmation':item.status==='quantity mismatch'||fulfillment.quantityReviewRequired?'unresolved discrepancy':'completed';
  checks.push({id:'quantity:'+key,field:'quantity',label:item.name+' — quantity',state:quantityState,reason:fulfillment.quantityError||''});
 }
 for(const check of checks)check.reason=generalProductFindingText(check.reason);
 const completed=checks.filter(c=>c.state==='completed'||c.state==='confirmed').length,confirmed=checks.filter(c=>c.state==='confirmed').length;
 const pending=checks.filter(c=>['pending research','suggested resolution','awaiting CCA confirmation'].includes(c.state)).length;
 return {sessionId:record.id,checks,completed,confirmed,pending,unresolved:checks.length-completed-pending,total:checks.length};
}
