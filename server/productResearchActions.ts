import {generalVaccineIdentityChoices} from './generalAccessoryAudit';
import {createGeneralCatalogResolver} from '../src/utils/generalProductLog';
import {hasActiveIdentityDecision} from '../shared/generalIdentityResearch';
import {productResearchNextSteps} from '../shared/productResearch';
import type {RequestHandler} from 'express';
import type {ProductCatalog} from '../shared/productCatalog';
import {generalInputFingerprint,sameGeneralAuditSources} from '../shared/generalAuditFingerprint';
import {generalAuditMutations} from './generalAuditMutation';
import {canAccessAuditRecord} from './auditRecordAccess';
import {researchProduct,researchProducts} from './productResearch';
import {generalFourParameterRecord} from '../src/utils/generalAuditor';
import type {ProductResearchSuggestion} from '../shared/productResearch';
import {scopeGeneralFsSuggestion,generalFsSuggestionSources} from './generalFsSuggestions';
import {localSourceComparisonSuggestions} from './generalComparisonSuggestions';

export function productResearchActions(deps:{read:(id:string)=>Promise<any>;catalog:()=>Promise<ProductCatalog>;getClient:()=>any;researchContext?:(record:any,scope:string)=>{getClient:()=>any;cacheScope?:string};save:(record:any,alias:string|string[])=>Promise<void>;confirm:(record:any,alias:string,productId:string,actor:{id:string;name:string},saveAlias?:boolean)=>Promise<any>;researchIdentities?:(record:any)=>Promise<any>;saveIdentityResearch?:(record:any,original:any)=>Promise<any>}):RequestHandler{
 return async(req,res)=>{
  const body=req.body||{},actor=res.locals.authUser;
  if(!actor?.id){res.status(401).json({error:'Sign in before reviewing a product suggestion.'});return;}
  if(!['research','research_pending','reject','confirm','keep'].includes(body.action)||typeof body.alias!=='string'||body.alias.length>160||!body.alias.trim()||typeof body.whatsappMessage!=='string'||typeof body.fulfillmentConfirmation!=='string'||typeof body.inputFingerprint!=='string'||!Number.isInteger(body.researchRevision)||body.researchRevision<0){res.status(400).json({error:'Choose an action for the current product suggestion.'});return;}
  const id=String(req.params.id);
  // Interpretation runs outside the mutation lock. Independent CCA decisions can save meanwhile.
  let researched:ProductResearchSuggestion[]|undefined,initial:any,identityResearch:any;
  if(body.action==='research'||body.action==='research_pending'){
   try{
    initial=await deps.read(id);
    if(!initial?.generalAudit){res.status(404).json({error:'General audit not found.'});return;}
    if(!canAccessAuditRecord(initial,actor)){res.status(403).json({error:'Only the audit owner or an administrator may update this audit.'});return;}
    if(!sameGeneralAuditSources(initial,body)||generalInputFingerprint(initial)!==body.inputFingerprint){res.status(409).json({error:'The messages changed. Open the current audit.'});return;}
    if(body.retryIdentityField!==undefined){
     if(!['facility','orderer'].includes(body.retryIdentityField)){res.status(400).json({error:'Select a facility or orderer comparison.'});return;}
     const field=body.retryIdentityField,value=initial.generalAudit[field];
     if(value?.status==='match'||hasActiveIdentityDecision(value)){res.json(initial);return;}
     initial={...initial,identityResearchRequestedFields:[field],generalAudit:{...initial.generalAudit,identityResearch:{...initial.generalAudit.identityResearch,[field]:{status:'deferred'}}}};
    }
    const groups=initial.generalAudit.catalogueSuggestions||[];
    const selected=body.action==='research_pending'?groups.filter((g:any)=>g.researchStatus==='deferred'&&!g.retainedDiscrepancy):groups.filter((g:any)=>g.alias===body.alias&&(g.researchRevision||0)===body.researchRevision);
    const pendingIdentity=body.action==='research_pending'&&Object.entries(initial.generalAudit.identityResearch||{}).some(([field,v]:[string,any])=>v.status==='deferred'&&initial.generalAudit[field]?.status!=='match'&&!hasActiveIdentityDecision(initial.generalAudit[field]));
    if(!selected.length&&!pendingIdentity){if(body.action==='research'){res.status(409).json({error:'This suggestion changed. Open the current audit before researching.'});}else res.json(initial);return;}
    const context=deps.researchContext?.(initial,actor.id)||{getClient:deps.getClient,cacheScope:actor.id};
    const catalog=await deps.catalog(),sources=generalFsSuggestionSources(initial),options={force:body.action==='research',scope:context.cacheScope,counterpartNames:sources.supplied.map(p=>p.name)};
    const local=localSourceComparisonSuggestions([...new Set([...sources.requested.map(p=>p.name),...selected.map((g:any)=>g.alias)])],options.counterpartNames,catalog);
    if(initial.generalAudit.generalAccessoryContext)for(const [alias,group] of generalVaccineIdentityChoices(sources.requested,sources.supplied,initial.generalAudit.generalAccessoryContext,catalog,createGeneralCatalogResolver(catalog.products)))local.set(alias,group);
    const unresolved=selected.filter((group:any)=>!local.has(group.alias));
    [researched,identityResearch]=await Promise.all([
     !unresolved.length?Promise.resolve([]):body.action==='research_pending'?researchProducts(unresolved.map((g:any)=>g.alias),catalog,context.getClient,options):researchProduct(body.alias,catalog,context.getClient,options).then(group=>[group]),
     pendingIdentity&&deps.researchIdentities?deps.researchIdentities(initial):undefined
    ]);
    researched=[...selected.flatMap((group:any)=>local.get(group.alias)||[]),...(researched||[])];
    researched=researched?.map(group=>scopeGeneralFsSuggestion(group,sources.requested,sources.supplied,catalog,initial.generalAudit.generalAccessoryContext));
   }catch{res.status(503).json({error:'Research could not complete. Completed comparisons remain available; retry or keep the discrepancy.'});return;}
  }
  const previous=generalAuditMutations.get(id);let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});generalAuditMutations.set(id,pending);await previous;
  try{
   let record=await deps.read(id);
   if(!record?.generalAudit){res.status(404).json({error:'General audit not found.'});return;}
   if(!canAccessAuditRecord(record,actor)){res.status(403).json({error:'Only the audit owner or an administrator may update this audit.'});return;}
   if(!sameGeneralAuditSources(record,body)||generalInputFingerprint(record)!==body.inputFingerprint){res.status(409).json({error:'The messages changed. Open the current audit before reviewing a suggestion.'});return;}
   if(researched){
    const changedAliases:string[]=[];
    for(const suggestion of researched){
     const before=initial.generalAudit.catalogueSuggestions.find((g:any)=>g.alias===suggestion.alias),current=record.generalAudit.catalogueSuggestions?.find((g:any)=>g.alias===suggestion.alias);
     // A late answer must not undo a newer confirmation, rejection or explicit discrepancy.
     if(!current||current.retainedDiscrepancy&&body.action==='research_pending'||(current.researchRevision||0)!==(before?.researchRevision||0))continue;
     const rejected=current.rejectedProductIds||[],options=suggestion.options.filter(o=>!rejected.includes(o.productId));
     const group={...suggestion,options,fulfillmentValue:[...new Set(options.map(o=>o.name))].join('; '),status:options.length?'suggested':'unavailable',confidenceCategory:options[0]?.confidenceCategory||'LOW',retainedDiscrepancy:false,rejectedProductIds:rejected,researchRevision:(current.researchRevision||0)+1,history:[...(current.history||[]),{action:'research',actor:{id:actor.id,name:actor.name},at:new Date().toISOString()}]};
     const updated={...record,generalAudit:{...record.generalAudit,catalogueSuggestions:record.generalAudit.catalogueSuggestions.map((g:any)=>g.alias===group.alias?group:g)}};
     record=updated;changedAliases.push(group.alias);
    }
    if(changedAliases.length)await deps.save(record,changedAliases);
    if(identityResearch&&deps.saveIdentityResearch)record=await deps.saveIdentityResearch(identityResearch,initial);
    res.json(record);return;
   }
   const original:ProductResearchSuggestion=record.generalAudit.catalogueSuggestions?.find((s:any)=>s.alias===body.alias);
   if(!original){res.status(409).json({error:'This suggestion was already resolved or is no longer part of the audit.'});return;}
   if((original.researchRevision||0)!==body.researchRevision){res.status(409).json({error:'The suggestions changed. Refresh this audit before deciding.'});return;}
   if(body.action==='confirm'){
    if(body.identityConfirmed!==true||!original.options.some(o=>o.productId===body.productId)||original.rejectedProductIds?.includes(body.productId)){res.status(400).json({error:'Select a suggested product and explicitly verify its identity and attributes.'});return;}
    res.json(await deps.confirm(record,body.alias,body.productId,actor,record.generalAudit.ordererExtraction?body.saveAlias===true:undefined));return;
   }
   const at=new Date().toISOString(),history=[...(original.history||[]),{action:body.action,actor:{id:actor.id,name:actor.name},at,...(body.action==='reject'?{productId:body.productId}:{})}];
   let group:ProductResearchSuggestion;
   if(body.action==='keep'){
    group={...original,retainedDiscrepancy:true};
   }else if(body.action==='reject'){
    if(!original.options.some(o=>o.productId===body.productId)){res.status(400).json({error:'Select the catalogue suggestion to reject.'});return;}
    const options=original.options.filter(o=>o.productId!==body.productId);
    group={...original,options,researchStatus:original.researchStatus==='deferred'?'unavailable':original.researchStatus,status:options.length?'suggested':'unavailable',rejectedProductIds:[...new Set([...(original.rejectedProductIds||[]),body.productId])]};
   }else{res.status(400).json({error:'Choose a valid resolution action.'});return;}
   group.nextSteps=productResearchNextSteps(!!group.options.length);group.confidenceCategory=group.options[0]?.confidenceCategory||'LOW';
   group={...group,history,researchRevision:(original.researchRevision||0)+1};
   const updated=generalFourParameterRecord({...record,generalAudit:{...record.generalAudit,catalogueSuggestions:record.generalAudit.catalogueSuggestions.map((s:any)=>s.alias===body.alias?group:s)}});
   await deps.save(updated,body.alias);res.json(updated);
  }catch(error:any){res.status(error?.status===409?409:503).json({error:error?.status===409?error.message:'Product research decision could not be saved. Your original audit remains available; retry.'});}
  finally{release();if(generalAuditMutations.get(id)===pending)generalAuditMutations.delete(id);}
 };
}
