import {stripOrderPersonTitle} from '../../shared/orderText';
import {generalInputFingerprint} from '../../shared/generalAuditFingerprint';
import {verifyGeneralFacilityResult} from './generalFacility';
import type {GeneralFieldResult} from './generalAuditTypes';

export type IdentityField = 'orderer' | 'facility';
export interface IdentityDecision {
  revision: number;
  action: 'confirm' | 'reject' | 'reset';
  actor: {id:string;name:string};
  at: string;
  customer: string;
  fulfillment: string;
  inputFingerprint: string;
  previousStatus: GeneralFieldResult['status'];
  previousReason: string;
}
const words=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/['’]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
export const identityPairKey=(field:IdentityField,customer:string,fulfillment:string)=>JSON.stringify([field,...[words(customer),words(fulfillment)].sort()]);
export function canDecideIdentity(value:GeneralFieldResult) {
  return [value.whatsappValue,value.fulfillmentValue].every(v=>Boolean(v?.trim())&&!/^(?:n\/?a|unknown|not available)$/i.test(v.trim())) && !['informational','optional not provided','missing from customer request','not available in system entry'].includes(value.status);
}
/** Similarity proposes a decision. Only exact evidence or the CCA can verify it. */
export function smartIdentityField<T extends GeneralFieldResult>(field:IdentityField,value:T):T {
  const decision=value.identityDecision;
  if(decision && decision.customer===value.whatsappValue && decision.fulfillment===value.fulfillmentValue && decision.action!=='reset') {
    return {...value,status:decision.action==='confirm'?'match':'mismatch',reason:decision.action==='confirm'?'Manually Verified':'Discrepancy Confirmed'};
  }
  if(field==='facility')return verifyGeneralFacilityResult(value);
  if(!canDecideIdentity(value))return value;
  const key=(name:string)=>words(stripOrderPersonTitle(name).replace(/\b(?:jnr|jr)\.?\b/gi,'junior').replace(/\b(?:snr|sr)\.?\b/gi,'senior'));
  const sameWords=key(value.whatsappValue)===key(value.fulfillmentValue);
  if(!sameWords&&value.nameMatchMethod==='gemini')return {...value,status:'review required',reason:value.reason||'A possible identity match needs CCA confirmation.'};
  if(value.status==='match'&&!sameWords)return {...value,status:'review required',reason:'Similar spelling, abbreviated or additional name components need CCA confirmation.'};
  return value;
}
/** Immutable, audit-local decision. Does not parse inputs or modify product evidence. */
export function decideIdentityField<T extends GeneralFieldResult>(field:IdentityField,value:T,action:IdentityDecision['action'],actor:IdentityDecision['actor'],sources:{whatsappMessage:string;fulfillmentConfirmation:string},at=new Date().toISOString()):T {
  if(!canDecideIdentity(value))throw Error('Both original identity values must be present before confirming a match.');
  const previous=value.identityDecision;
  const decision:IdentityDecision={revision:(previous?.revision||0)+1,action,actor,at,customer:value.whatsappValue,fulfillment:value.fulfillmentValue,inputFingerprint:generalInputFingerprint(sources),previousStatus:previous?.previousStatus||value.status,previousReason:previous?.previousReason??value.reason??''};
  const changed={...value,status:decision.previousStatus,reason:decision.previousReason,identityDecision:decision,identityHistory:[...(value.identityHistory||[]),decision]};
  return smartIdentityField(field,changed);
}
