import {generalInputFingerprint,sameGeneralAuditSources} from '../../shared/generalAuditFingerprint';
import {generalFourParameterRecord} from './generalAuditor';

/** Restore explicit decisions for this audit only, never transfer approval to a new order. */
export function restoreGeneralIdentityDecisions<T>(fresh:T,saved:any):T {
 const current=fresh as any;
 if(!saved?.generalAudit||!current?.generalAudit||!current.id||current.id!==saved.id||!sameGeneralAuditSources(current,saved))return fresh;
 const details={...current.generalAudit};let changed=false;
 for(const field of ['orderer','facility'] as const){
  const previous=saved.generalAudit[field],decision=previous?.identityDecision,target=details[field];
  if(!decision||!target||decision.inputFingerprint!==generalInputFingerprint(current)||decision.customer!==target.whatsappValue||decision.fulfillment!==target.fulfillmentValue||
    (target.identityDecision?.revision||0)>=decision.revision)continue;
  // New authoritative reference conflicts require a fresh decision.
  if(field==='facility'&&['customerFacilityId','fulfillmentFacilityId'].some(key=>target[key]&&previous[key]&&target[key]!==previous[key]))continue;
  details[field]={...target,identityDecision:decision,identityHistory:previous.identityHistory||[decision]};
  if(saved.generalAudit.identityReviewEvidence?.[field])details.identityReviewEvidence={...details.identityReviewEvidence,[field]:saved.generalAudit.identityReviewEvidence[field]};
  if(decision.action!=='reset')details.semanticReviews=(details.semanticReviews||[]).filter((r:any)=>r.field!==(field==='orderer'?'ordererName':'facilityName'));
  changed=true;
 }
 if(!changed)return fresh;
 const rebuilt:any=generalFourParameterRecord({...current,generalAudit:details});
 return {...rebuilt,resolutionNotes:rebuilt.allMatch?(saved.resolutionNotes||rebuilt.generalAudit.finalStatus):'',resolvedAt:rebuilt.allMatch?(saved.resolvedAt||current.timestamp||null):null,meta:{...rebuilt.meta,facility:rebuilt.generalAudit.facility,facilityName:rebuilt.generalAudit.facility,customerName:rebuilt.generalAudit.orderer,ordererName:rebuilt.generalAudit.orderer},
  ...('isValid' in current?{isValid:rebuilt.allMatch,auditStatus:rebuilt.allMatch?'passed':'failed'}:{}),...('discrepancies' in current?{discrepancies:rebuilt.generalAudit.discrepancies}:{})} as T;
}
