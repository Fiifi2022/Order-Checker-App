import type {RequestHandler} from 'express';
import {canAccessAuditRecord} from './auditRecordAccess';
import {generalAuditMutations} from './generalAuditMutation';

export function auditResolutionHandler(deps:{read:(id:string)=>Promise<any>;save:(record:any)=>Promise<void>}):RequestHandler {
  return async(req,res)=>{
    const id=String(req.params.id || ''),{status,resolutionNotes}=req.body || {};
    if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || status!==undefined && !['pending','resolved'].includes(status) || resolutionNotes!==undefined && typeof resolutionNotes!=='string') {
      res.status(400).json({error:'Use a valid audit ID, status and text resolution notes.'});return;
    }
    const previous=generalAuditMutations.get(id);let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});generalAuditMutations.set(id,pending);
    await previous;
    try {
      const record=await deps.read(id);
      if(!record){res.status(404).json({error:'Audit record not found.'});return;}
      if(!canAccessAuditRecord(record,res.locals?.authUser)){res.status(403).json({error:'Only the audit owner or an administrator may update this audit.'});return;}
      const nextStatus=status || record.status;
      const notes=resolutionNotes!==undefined ? resolutionNotes : record.resolutionNotes;
      if(nextStatus==='resolved' && !String(notes || '').trim()){res.status(400).json({error:'Describe the correction or resolution before resolving this audit.'});return;}
      const issueCount=record.generalAudit ? Number(record.issueCount)||0 : Number(record.issueCount)||(record.items || []).filter((item:any)=>!['match','out of stock'].includes(item.status)).length;
      const updated={...record,status:nextStatus,resolutionNotes:notes,
        resolvedAt:nextStatus==='resolved' ? record.status==='resolved' && record.resolvedAt ? record.resolvedAt : new Date().toISOString() : null,
        resolvedIssueCount:nextStatus==='resolved' ? issueCount : 0};
      await deps.save(updated);
      // A manual workflow resolution never changes the underlying audit verdict.
      // Pending/failed General saves remain visible and retryable in the result.
      if(!updated.generalAudit && updated.storage?.status!=='saved') {
        res.status(503).json({error:'Resolution retained locally; database saving is not confirmed. Retry before clearing the inputs.'});return;
      }
      res.json(updated);
    } catch {res.status(503).json({error:'Resolution could not be confirmed saved. Your inputs remain available; retry.'});}
    finally {release();if(generalAuditMutations.get(id)===pending)generalAuditMutations.delete(id);}
  };
}
