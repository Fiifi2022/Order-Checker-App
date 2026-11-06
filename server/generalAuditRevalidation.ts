import {catalogAliasKey,type ProductCatalog} from '../shared/productCatalog';
import type {GeneralAuditSupport,GeneralProductEvidence} from './generalAuditor';
import type {GeneralAuditDetails} from '../src/utils/generalAuditTypes';
import {buildGeneralAccessoryCatalog,createGeneralAccessoryResolver,prepareGeneralAccessoryItems} from './generalAccessoryAudit';
import {reconcileCatalogueEvidence} from './generalProductNameAudit';

/** All post-extraction CCA product decisions return through the same matching
 * and business-rule stages. Never reparse raw messages or call AI here. The
 * optional context keeps legacy/companion modes on their existing policy. */
export function revalidateGeneralAuditEvidence(evidence:GeneralProductEvidence[],catalog:ProductCatalog,details:GeneralAuditDetails,
 support:GeneralAuditSupport={},readability=details.extractionReadability){
 const context=details.generalAccessoryContext?buildGeneralAccessoryCatalog(catalog):undefined;
 const base=createGeneralAccessoryResolver(catalog,context);
 const preferred=evidence.flatMap(p=>base(p.name).product?.id||[]);
 const resolve=(name:string)=>{
  const result=base(name,preferred);
  if(result.product&&catalog.aliasRecords?.some(row=>row.productId===result.product!.id&&row.normalizedText===catalogAliasKey(name)&&
   (row.status==='rejected'||row.status==='approved'&&!row.active)))return {normalizedName:result.normalizedName,recognized:true,reason:'This alias was rejected or deactivated.'};
  return result;
 };
 const assessments:NonNullable<Parameters<typeof reconcileCatalogueEvidence>[5]>={};
 for(const source of ['customer_request','fulfillment_confirmation'] as const){
  const value=readability?.[source];if(value)assessments[source]={...value,unreadQuantityText:value.unreadQuantityText||[]};
 }
 const raw=reconcileCatalogueEvidence(evidence.filter(p=>p.source==='customer_request'),evidence.filter(p=>p.source==='fulfillment_confirmation'),catalog,resolve,
  {sourceProductConfirmations:details.sourceProductConfirmations,generalOrderLimitDecisions:details.orderLimitDecisions||{},...support,generalOnlySmartMatching:!!context},assessments);
 return {items:context?prepareGeneralAccessoryItems(raw,context):raw,resolve,parameters:{...details,...(context?{generalAccessoryContext:context}:{})}};
}
