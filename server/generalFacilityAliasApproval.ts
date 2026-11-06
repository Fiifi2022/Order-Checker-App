import type {GeneralFacilityDirectoryState} from '../shared/generalFacilityDirectory';
import {normalizeGeneralFacilityName} from '../src/utils/generalFacility';
import {activeGeneralFacilities} from './generalFacilityDirectory';
/** Permanent facility aliases require explicit CCA approval and exactly one verified reference. */
export function approveConfirmedFacilityAlias(state:GeneralFacilityDirectoryState,audit:any){
 const value=audit.generalAudit.facility,decision=value.identityDecision;
 if(!decision)return state;
 const records=activeGeneralFacilities(state),names=[value.whatsappValue,value.fulfillmentValue];
 const key=(s:string)=>normalizeGeneralFacilityName(s);
 const targets=records.filter(record=>names.some(name=>[record.name,...(record.verifiedAliases||[])].some(alias=>key(alias)===key(name))));
 if(targets.length!==1)return state;
 const target=targets[0],aliases=names.filter(name=>name&&name!=='N/A'&&name.length<=160&&key(name)!==key(target.name)&&!/[\r\n\x00-\x1f]/.test(name));
 if(!aliases.length||value.customerFacilityId&&value.fulfillmentFacilityId&&value.customerFacilityId!==value.fulfillmentFacilityId)return state;
 let approvals=[...(state.aliasApprovals||[])],changed=false;
 for(const alias of aliases){
  if(records.some(record=>record.key!==target.key&&[record.name,...(record.verifiedAliases||[])].some(name=>key(name)===key(alias))))continue;
  const previous=approvals.find(row=>row.key===target.key&&key(row.alias)===key(alias));
  const active=decision.action==='confirm';
  if(!active&&(!previous||previous.auditId!==audit.id))continue;
  if(previous&&(previous.at>decision.at||previous.active===active&&previous.auditId===audit.id))continue;
  const next={key:target.key,alias,active,auditId:audit.id,by:decision.actor.id,at:decision.at,history:[...(previous?.history||[]),{by:decision.actor.id,at:decision.at,active,auditId:audit.id}]};
  approvals=approvals.filter(row=>row!==previous);approvals.push(next);changed=true;
 }
 if(!changed||approvals.length>2000)return state;
 const next={...state,revision:state.revision+1,aliasApprovals:approvals,updatedBy:decision.actor.id,updatedAt:decision.at};
 return Buffer.byteLength(JSON.stringify(next),'utf8')<=750000?next:state;
}
