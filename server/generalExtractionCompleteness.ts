import {getGeneralProductLog,resolveGeneralCatalogIdentity} from '../src/utils/generalProductLog';
import {getGeneralMedicalAmbiguity} from '../src/utils/generalMedicalTerminology';
import type {DeterministicGeneralOrder} from './generalOrderExtraction';
import {parseGeneralProducts,extractGeneralInput,stripGeneralListPrefix,type GeneralProductSource} from './generalAuditor';
import {classifyGeneralText,classifyGeneralAuditLine} from '../src/utils/generalTextClassification';
import {recognizeGeneralDocument,generalDocumentLabel} from '../src/utils/generalDocumentStructure';

function knownUnquantifiedProduct(line:string,source:GeneralProductSource) {
 if(parseGeneralProducts(line,source).length)return false;
 const label=generalDocumentLabel(line);
 const name=stripGeneralListPrefix(label?.field==='products'?label.value:line).trim();
 return !getGeneralMedicalAmbiguity(name) && !!resolveGeneralCatalogIdentity(name,getGeneralProductLog() || []).product;
}

/** Reading a list and establishing catalogue identity are separate decisions.
 * Unknown but clearly quantified product names belong to catalogue matching. */
export function unreadGeneralProductLines(lines:readonly string[],source:GeneralProductSource) {
 return lines.filter(line=>{
  const role=classifyGeneralAuditLine(line);
  if(['administrative','optional_metadata','facility_identity','orderer_identity','product_quantity'].includes(role))return false;
  const identity=extractGeneralInput(line,source);
  if(identity.ordererName!=='N/A' || identity.facilityName!=='N/A')return false;
  const parsed=parseGeneralProducts(line,source);
  if(parsed.length)return parsed.some(product=>/\b(?:please|kindly|arrange|provide|prepare|require|need|request|send|supply|quantity\s+is|count\s+is)\b/i.test(product.name));
  if(knownUnquantifiedProduct(line,source))return false;
  const document=recognizeGeneralDocument(line,classifyGeneralText);
  return document.lines.some(entry=>entry.kind==='PRODUCT_ENTRY') || /^\s*[-*•]\s*\S/.test(line) ||
   /\b(?:please|kindly|arrange|provide|prepare|require|need|request|send|supply)\b/i.test(line);
 });
}
export function generalProductReadability(input:DeterministicGeneralOrder,source:GeneralProductSource) {
 const unread=unreadGeneralProductLines(input.unresolvedText,source);
 const unreadQuantityText=input.unresolvedText.filter(line=>knownUnquantifiedProduct(line,source));
 const hasProducts=parseGeneralProducts(input.text,source).length>0 || unreadQuantityText.length>0;
 const explicitEmptyList=source==='fulfillment_confirmation' && /^\s*No fulfilled products[.!]?\s*$/im.test(input.text);
 return {status:unread.length || !hasProducts && !explicitEmptyList ? 'unreadable' as const : 'complete' as const,unreadProductText:unread,unreadQuantityText};
}
