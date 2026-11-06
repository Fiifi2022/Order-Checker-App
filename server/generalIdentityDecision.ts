import type {RequestHandler} from 'express';
import {generalAuditMutations} from './generalAuditMutation';
import {canAccessAuditRecord} from './auditRecordAccess';
import {generalInputFingerprint,sameGeneralAuditSources} from '../shared/generalAuditFingerprint';
import {generalFourParameterRecord} from '../src/utils/generalAuditor';
import {decideIdentityField,canDecideIdentity,type IdentityField,type IdentityDecision} from '../src/utils/generalIdentityDecision';

export function applyIdentityDecision(record:any,field:IdentityField,action:IdentityDecision['action'],actor:IdentityDecision['actor'],at?:string){
 const value=record.generalAudit[field];
 const updated=decideIdentityField(field,value,action,actor,record,at);
 const reviewField=field==='orderer'?'ordererName':'facilityName';
 // Remove only reviews explicitly tied to this field and retain them for Change Decision.
 const retained=record.generalAudit.identityReviewEvidence||{};
 const evidence=retained[field]||record.generalAudit.semanticReviews?.filter((r:any)=>r.field===reviewField)||[];
 const other=(record.generalAudit.semanticReviews||[]).filter((r:any)=>r.field!==reviewField);
 const generalAudit={...record.generalAudit,[field]:updated,identityReviewEvidence:{...retained,[field]:evidence},semanticReviews:action==='reset'?[...other,...evidence]:other};
 const rebuilt:any=generalFourParameterRecord({...record,generalAudit});
 const identity=rebuilt.generalAudit;
 return {...rebuilt,...('isValid' in record?{isValid:rebuilt.allMatch,auditStatus:rebuilt.allMatch?'passed':'failed'}:{}),...('discrepancies' in record?{discrepancies:identity.discrepancies}:{}),meta:{...record.meta,customerName:identity.orderer,ordererName:identity.orderer,facility:identity.facility,facilityName:identity.facility},
  resolutionNotes:rebuilt.allMatch?'Identity decision recorded; all audit checks passed.':'',resolvedAt:rebuilt.allMatch?(at||new Date().toISOString()):null};
}
export function identityDecisionHandler(deps:{read:(id:string)=>Promise<any>;save:(record:any,field:IdentityField)=>Promise<void>;learn?:(record:any,field:IdentityField)=>Promise<void>}):RequestHandler{
 return async(req,res)=>{
  const body=req.body||{},field=body.field as IdentityField;
  if(!['orderer','facility'].includes(field)||!['confirm','reject','reset'].includes(body.action)||!Number.isInteger(body.previousRevision)||body.previousRevision<0||typeof body.whatsappMessage!=='string'||typeof body.fulfillmentConfirmation!=='string'||typeof body.inputFingerprint!=='string') {res.status(400).json({error:'Choose an identity decision for the current audit.'});return;}
  const actor=res.locals.authUser;
  if(!actor?.id||!actor?.name){res.status(401).json({error:'Sign in before confirming an identity.'});return;}
  const id=String(req.params.id),previous=generalAuditMutations.get(id);let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});generalAuditMutations.set(id,pending);await previous;
  try{
   const record=await deps.read(id);
   if(!record?.generalAudit){res.status(404).json({error:'General audit not found.'});return;}
   if(!canAccessAuditRecord(record,actor)){res.status(403).json({error:'Only the audit owner or an administrator may update this audit.'});return;}
   if(!sameGeneralAuditSources(record,body)||body.inputFingerprint!==generalInputFingerprint(record)){res.status(409).json({error:'The messages changed. Open the current audit before deciding.'});return;}
   const value=record.generalAudit[field],decision=value.identityDecision;
   if(!canDecideIdentity(value)){res.status(400).json({error:'Both identity values must be present.'});return;}
   // A retried completed request keeps the original actor and timestamp.
   if(decision?.revision===body.previousRevision+1&&decision.action===body.action&&decision.actor.id===actor.id){res.json(record);return;}
   if((decision?.revision||0)!==body.previousRevision){res.status(409).json({error:'This decision changed. Refresh the audit before changing it.'});return;}
   if(body.action==='reset'&&!decision){res.status(400).json({error:'There is no saved decision to change.'});return;}
   if(record.generalAudit.ordererExtraction&&body.action==='confirm'&&body.identityAcknowledged!==true){res.status(400).json({error:'Check both original names and acknowledge the match before confirming.'});return;}
   const updated=applyIdentityDecision(record,field,body.action,{id:actor.id,name:actor.name});
   await deps.save(updated,field);
   try{if(!record.generalAudit.ordererExtraction||field==='facility'&&body.saveAlias===true)await deps.learn?.(updated,field);}catch{updated.identityLearningWarning='Decision saved. The variation suggestion could not be saved; retry Change Decision if needed.';}
   res.json(updated);
  }catch{res.status(503).json({error:'Identity decision could not be saved. Your existing audit remains available; retry.'});}
  finally{release();if(generalAuditMutations.get(id)===pending)generalAuditMutations.delete(id);}
 };
}
