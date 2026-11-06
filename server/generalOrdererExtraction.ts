import {extractGeneralIdentity,parseGeneralProducts,type GeneralAuditSupport} from './generalAuditor';
import {classifyGeneralText,generalOrderRelevantText} from '../src/utils/generalTextClassification';
import {generalDocumentLabel,recognizeGeneralDocument} from '../src/utils/generalDocumentStructure';
import {hasGeneralFacilityType} from '../src/utils/generalFacility';
import {createGeneralCatalogResolver} from '../src/utils/generalProductLog';
import {getGeneralMedicalAmbiguity} from '../src/utils/generalMedicalTerminology';
import {normalizeGeneralOrdererName,matchGeneralOrdererNames} from '../src/utils/generalOrdererName';
import {stripOrderPersonTitle} from '../shared/orderText';
import type {ProductCatalog} from '../shared/productCatalog';
import type {GeneralOrdererExtraction} from '../src/utils/generalAuditTypes';

const key=(name:string)=>normalizeGeneralOrdererName(name).sort().join(' ');
const personLabel=/^(?:(?:patient|client)(?:['’]s)?(?:\s+(?:name|details|contact))?|name of (?:patient|client)|(?:name and contact of (?:the )?)?(?:referring )?(?:physician|doctor)|contact|phone|telephone|tel|signed|duty nurse)\s*[:=]/i;
const notPerson=/\b(?:please|kindly|send|need|request|order|product|medicine|injection|tablet|capsule|syrup|vaccine|infusion|syringe|needle|quantity|district|region|delivery|collect|ask|contact|patient|client|doctor|physician|regards|thanks|team|information|forwarded|unknown|missing)\b/i;

/** General Auditor only: FS corroborates literal source evidence, never supplies it. */
export function recoverGeneralOrderer(customer:string,fulfillment:string,catalog:ProductCatalog,support:GeneralAuditSupport):GeneralOrdererExtraction{
 try{return extractSourceOrderer(customer,fulfillment,catalog,support);}catch{
  return {status:'extraction error',value:null,candidates:[],method:'source search',reason:'The orderer extraction could not be completed. Check the original customer name; other comparisons remain independent.'};
 }
}
function extractSourceOrderer(customer:string,fulfillment:string,catalog:ProductCatalog,support:GeneralAuditSupport):GeneralOrdererExtraction{
 // Identity recovery does not need to parse the product list a second time.
 const fs=extractGeneralIdentity(fulfillment,'fulfillment_confirmation').ordererName;
 const ordinary=extractGeneralIdentity(customer,'customer_request',fs).ordererName;
 const result=(status:GeneralOrdererExtraction['status'],value:string|null,candidates:string[],method:GeneralOrdererExtraction['method'],reason:string):GeneralOrdererExtraction=>({status,value,candidates,method,reason});
 if(ordinary!=='N/A')return result('detected',ordinary,[ordinary],'normal parser','The orderer name was extracted from the customer message.');
 const resolve=createGeneralCatalogResolver(catalog.products),document=recognizeGeneralDocument(customer,classifyGeneralText);
 const geography=new Set((support.facilityContext?.records||[]).flatMap(record=>[record.name,record.district,record.region]).filter((name):name is string=>!!name).map(key));
 const candidates:string[]=[];let excludedSection=false;
 for(const line of document.lines){
  const raw=line.originalText.trim(),label=generalDocumentLabel(raw);
  if(personLabel.test(raw)){if(/[:=]\s*$/.test(raw))excludedSection=true;continue;}
  if(label||line.kind==='PRODUCT_ENTRY')excludedSection=false;
  if(excludedSection||!raw||label||line.kind==='PRODUCT_ENTRY'||classifyGeneralText(raw).category==='administrative'||parseGeneralProducts(raw,'customer_request').length)continue;
  const name=stripOrderPersonTitle(raw).trim();
  if(!/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,7}$/u.test(name)||notPerson.test(name)||hasGeneralFacilityType(name)||geography.has(key(name))||getGeneralMedicalAmbiguity(name)||resolve(name).product)continue;
  if(!candidates.some(other=>key(other)===key(name)))candidates.push(name);
 }
 if(!candidates.length)return result('not detected',null,[],'source search','No reliable orderer name was detected in the customer request. Fulfilment cannot supply an absent customer name.');
 const matches=fs==='N/A'?[]:candidates.filter(name=>matchGeneralOrdererNames(name,fs).status!=='mismatch');
 const selected=matches.length===1?matches[0]:candidates[0];
 const exact=fs!=='N/A'&&key(selected)===key(fs);
 if(candidates.length>1)return result('needs confirmation',selected,candidates,'FS-assisted source search',`Several possible people are stated: ${candidates.join('; ')}. Confirm whether ${selected} is the person placing this order.`);
 const onlyName=generalOrderRelevantText(customer).trim()===selected;
 if(onlyName&&!exact)return result('needs confirmation',selected,candidates,'local source header','A standalone person name is present, but its role and agreement with fulfilment require confirmation.');
 return result('detected',selected,candidates,exact?'FS-assisted source search':'local source header','The standalone name is present in the customer message; fulfilment was used only as a comparison reference.');
}
