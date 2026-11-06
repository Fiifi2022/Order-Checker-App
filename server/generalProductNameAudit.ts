import {createGeneralAccessoryResolver,buildGeneralAccessoryCatalog,generalAccessoryIdentity,generalAccessoryProduct,prepareGeneralAccessoryItems,generalVaccineIdentityChoices,prepareGeneralVaccineList} from './generalAccessoryAudit';
import {directProductKeys,catalogueProductVariantKeys} from '../shared/generalDirectProduct';
import {recoverGeneralOrderer} from './generalOrdererExtraction';
import {localSourceComparisonSuggestions} from './generalComparisonSuggestions';
import {projectFourFieldFulfillment} from './generalFourFieldInput';
import {scopeGeneralFsSuggestion} from './generalFsSuggestions';
import {researchConfig,groundResearchGroup,researchExplanation,researchProduct,actionableResearchGroup} from './productResearch';
import type {ProductResearchSuggestion} from '../shared/productResearch';
import {smartIdentityField} from '../src/utils/generalIdentityDecision';
import {isSyringeDescription,syringeDescriptionConflict,unsafeSyringeAlias} from '../shared/syringeIdentity';
import {generalProductReadability,unreadGeneralProductLines} from './generalExtractionCompleteness';
import {projectGeneralFulfillmentSections} from '../src/utils/generalFulfillmentText';
import {generalBloodDescription,projectGeneralBloodFields} from '../src/utils/generalBloodProducts';
import {geminiProviderTimeout} from './geminiTransport';
import {resolveGeneralOrdererName} from './generalOrdererFallback';
import { GENERAL_CATALOGUE_AI_INSTRUCTIONS, generalCatalogueAiCandidates } from './generalCatalogueAi';
import {generalUnlabelledOrdererCandidates} from '../src/utils/generalAuditor';
import {suggestGeneralFacility} from './generalFacilitySuggestion';
import {generalVaccineCounterpart} from '../shared/generalVaccineCatalog';
import { Type } from '@google/genai';
import { catalogKey, catalogAliasKey, catalogProductNames, type ProductCatalog } from '../shared/productCatalog';
import { expandGeneralProductAcronyms } from '../src/utils/medicalProductAcronyms';
import { generalOrderRelevantText } from '../src/utils/generalTextClassification';
import { recognizeGeneralDocument,generalDocumentLabel } from '../src/utils/generalDocumentStructure';
import { cleanGeneralProductDescription } from '../src/utils/generalProductMatching';
import { parseGeneralProducts, generalProductDisplayName, extractGeneralInput, compareAssignedGeneralProducts, runGeneralAuditor, stripGeneralListPrefix, summarizeGeneralProducts, type GeneralAuditSupport, type GeneralComparisonItem, type GeneralProductEvidence } from './generalAuditor';
import { resolveGeneralCatalogIdentity, createGeneralCatalogResolver, generalCatalogAttributeConflict, relatedGeneralCatalogDescriptions } from '../src/utils/generalProductLog';
import { optionalAuditAi, sharedOptionalAuditBudget, waitForOptionalAuditWrite } from './auditBudget';
import { AUDIT_BACKGROUND_WAIT_MS } from '../shared/auditPerformance';
import { compareGeneralFacilities, prepareGeneralFacilityContext } from '../src/utils/generalFacility';
import { normalizeGeneralOrdererName, matchGeneralOrdererNames } from '../src/utils/generalOrdererName';
import { waitForAudit } from '../shared/auditPerformance';
import { geminiUsage } from './geminiUsage';
import { classifyGeneralText, classifyGeneralAuditLine } from '../src/utils/generalTextClassification';
import { extractGeneralOrderDeterministically } from './generalOrderExtraction';
import { assertGeneralProductEvidence } from '../src/utils/generalProductEvidence';
import {projectGeneralOrderSentences} from '../src/utils/generalSentenceExtraction';
import { resolveGeneralOrderExtraction } from './generalHybridExtraction';
import type { GeneralSemanticReview, GeneralOrderExtractionSnapshot } from '../src/utils/generalAuditTypes';

const pendingCatalogueAi = new Map<string, Promise<any>>();
const recentCatalogueAi = new Map<string,{expires:number;response?:any;error?:Error}>();
async function sharedCatalogueAi(key: string, task:()=>Promise<any>, signal?:AbortSignal) {
  const cached=recentCatalogueAi.get(key);
  if(cached && cached.expires>Date.now()) {if(cached.error)throw cached.error;return cached.response;}
  let pending=pendingCatalogueAi.get(key);
  if(!pending) {
    pending=task().then(response=>{
      if(recentCatalogueAi.size>=128)recentCatalogueAi.clear();
      recentCatalogueAi.set(key,{expires:Date.now()+120_000,response});return response;
    },error=>{
      if(recentCatalogueAi.size>=128)recentCatalogueAi.clear();
      recentCatalogueAi.set(key,{expires:Date.now()+30_000,error});throw error;
    });pendingCatalogueAi.set(key,pending);
    const active=pending;
    void pending.finally(()=>{if(pendingCatalogueAi.get(key)===active) pendingCatalogueAi.delete(key);}).catch(()=>{});
  }
  return waitForAudit(pending,signal);
}
/** Candidate-selection labels for the optional AI prompt; never catalogue identity keys. */
export function generalProductNameLabel(value: string) {
  return cleanGeneralProductDescription(value)
    .replace(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|mls?|litres?|liters?|l|iu|miu|%)\b/gi, ' ')
    .replace(/\/\s*(?:mcg|mg|g|mls?|litres?|liters?|l|iu)\b/gi, ' ')
    .replace(/\b(?:tablets?|tabs?|capsules?|caps?|injections?|inj|infusions?|syrups?|syr|suspensions?|susp|solutions?|soln|creams?|ointments?|powders?|gels?|drops?|vials?|bottles?|packs?|boxes|box|cards?|blisters?|strips?|doses?|units?|pieces?|sachets?|oral|intravenous|intramuscular|iv|im)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/\s*[/+]\s*(?=$|[/+])/g, ' ')
    .replace(/^[\s./+,;:()[\]-]+|[\s./+,;:()[\]-]+$/g, '').replace(/\s+/g, ' ').trim();
}
export const generalProductNameKey = (value: string) => catalogKey(generalProductNameLabel(expandGeneralProductAcronyms(value))).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export interface LearnedNameAlias { alias: string; productId: string }

function extractNames(text: string, source: GeneralProductEvidence['source'], resolve?: (name: string) => ReturnType<typeof resolveGeneralCatalogIdentity>): GeneralProductEvidence[] {
  const originalLines = text.split(/\r?\n/);
  const numbered = originalLines.map(line => line.match(/^\s*(\d+)\s+([a-z].*?\s+\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*)$/i));
  const indices = numbered.filter(Boolean).map(match => Number(match![1]));
  const numberedList = indices.length > 0 && indices.every((value, index) => value === index + 1);
  const parseText = numberedList ? originalLines.map((line, index) => numbered[index] ? `${numbered[index]![1]}. ${numbered[index]![2]}` : line).join('\n') : text;
  const quantityText=parseText.replace(/([^\n]+?)\s+(?:qty|quantity)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(units?)?\s*$/gim, '$1 - $2 $3');
  const parsed = parseGeneralProducts(quantityText, source).map(product => ({ ...product, originalText: originalLines[product.line - 1] || product.originalText }));
  const document = recognizeGeneralDocument(generalOrderRelevantText(text), classifyGeneralText);
  const represented = new Set(parsed.map(p => p.line));
  for (const line of document.lines) {
    if (represented.has(line.line) || !['PRODUCT_ENTRY', 'AMBIGUOUS_CONTENT'].includes(line.kind)) continue;
    const name = cleanGeneralProductDescription(stripGeneralListPrefix(line.auditText));
    if (line.kind !== 'PRODUCT_ENTRY' && !resolve?.(name).product) continue;
    if (!name || name.length > 160 || /[:!?]|\b(?:please|hello|thank|patient|age|diagnosis|contact|district|facility|orderer|delivery|received|tomorrow)\b/i.test(name) || !/[a-z]/i.test(name)) continue;
    parsed.push({ name, quantity: 0, quantityReview: 'Quantity not provided.', unit: '', originalText: line.originalText, source, line: line.line, normalizedName: generalProductNameKey(name) });
  }
  return parsed;
}

export async function runGeneralProductNameAudit(customer: string, fulfillment: string, catalog: ProductCatalog, support: GeneralAuditSupport & { requestLanguage?: boolean },
  getClient: () => any, _legacySaveAliases?: (aliases: LearnedNameAlias[]) => Promise<ProductCatalog>) {
  const facilitySourceCustomer = customer, facilitySourceSystem = fulfillment;
  const accessoryContext=support.generalOnlySmartMatching===true?buildGeneralAccessoryCatalog(catalog):undefined;
  if(accessoryContext)customer=prepareGeneralVaccineList(customer,catalog,accessoryContext);
  let ordererExtraction=support.generalOnlySmartMatching===true?recoverGeneralOrderer(customer,fulfillment,catalog,support):undefined;
  if(ordererExtraction?.value&&ordererExtraction.method!=='normal parser')customer+=`\nOrderer: ${ordererExtraction.value}`;
  if(support.requestLanguage)fulfillment=projectFourFieldFulfillment(fulfillment);
  fulfillment=projectGeneralFulfillmentSections(fulfillment);
  const bloodSources={customer_request:projectGeneralBloodFields(customer),fulfillment_confirmation:projectGeneralBloodFields(fulfillment)};
  customer=bloodSources.customer_request.text;fulfillment=bloodSources.fulfillment_confirmation.text;
  const remainingAiMs = sharedOptionalAuditBudget(support.semanticTimeoutMs ?? 3000);
  const remainingWriteMs = sharedOptionalAuditBudget(AUDIT_BACKGROUND_WAIT_MS);
  let geminiRequests = 0;
  const observeGemini = support.onGeminiRequest;
  support = {...support, facilityContext: prepareGeneralFacilityContext(support.facilityContext),
    onGeminiRequest: () => {geminiRequests++; observeGemini?.();}};
  let rows = catalog.products;
  let resolveCatalog=createGeneralAccessoryResolver(catalog,accessoryContext);
  // Both interfaces enter here. Extract each source independently before
  // catalogue identity/quantity checks; never fill one message from the other.
  const narrative = /\b(?:i am|i['’]m|this is|my name is|calling from|ordering from|orderer is|(?:can|could|would) you\s+(?:please\s+)?(?:send|supply|help)|(?:please|kindly)\s+(?:send|supply)|(?:we|i)\s+(?:also\s+)?(?:urgently\s+)?(?:need|want|require|request|are requesting|would like)|urgently needs|needs\s+\d|full course of)\b|^(?:Mr|Mrs|Ms|Dr|Nurse|Officer)\.?\s+[^\n]+\s+(?:from|at|of)\b/im;
  let extraction: GeneralOrderExtractionSnapshot | undefined;
  let extractionReviews: GeneralSemanticReview[] = [];
  let extractionStatus: 'used' | 'fallback' | 'skipped' = 'skipped';
  let extractionRequested=false;
  const readability: Partial<Record<GeneralProductEvidence['source'],ReturnType<typeof generalProductReadability>>> = {};
  // Missing critical fields deserve source-grounded extraction help even when
  // the message does not contain one of the recognised narrative phrases.
  const extractionLanguage=/\b(?:arrange|provide|prepare|require|quantity|qty|please|kindly|send|supply|need|request)\b/i;
  const sourceHasGaps=([customer,fulfillment] as const).some((text,index)=>{
    const parsed=extractGeneralInput(text,index===0?'customer_request':'fulfillment_confirmation');
    const products=extractNames(text,index===0?'customer_request':'fulfillment_confirmation',resolveCatalog);
    return new Set([...recognizeGeneralDocument(text).lines.filter(line=>line.field==='orderer'&&line.kind==='FIELD_VALUE').map(line=>generalDocumentLabel(line.auditText)?.value||line.originalText),...Array.from(text.matchAll(/^\s*name\s*[:=]\s*(.+)$/gim),match=>match[1])].map(name=>normalizeGeneralOrdererName(name).sort().join(' '))).size>1 || parsed.ordererName==='N/A' || parsed.facilityName==='N/A' || !products.length ||
      products.some(product=>product.quantityReview || extractionLanguage.test(product.name)) ||
      unreadGeneralProductLines(text.split(/\r?\n/),index===0?'customer_request':'fulfillment_confirmation').length>0;
  });
  if (sourceHasGaps || narrative.test(customer) || narrative.test(fulfillment) || [customer, fulfillment].some(text =>
    projectGeneralOrderSentences(text,support.facilityContext)!==text || generalUnlabelledOrdererCandidates(text,support.facilityContext?.records).length>0 || /\border\s+placed\s+by\b/i.test(text) || text.split('\n').some(line => classifyGeneralAuditLine(line) === 'product_quantity'))) {
    const names = rows.flatMap(catalogProductNames);
    let b = extractGeneralOrderDeterministically(fulfillment, 'fulfillment_confirmation', support.facilityContext, undefined, names);
    let a = extractGeneralOrderDeterministically(customer, 'customer_request', support.facilityContext, b.order, names, {requestLanguage:support.requestLanguage});
    b = extractGeneralOrderDeterministically(fulfillment, 'fulfillment_confirmation', support.facilityContext, a.order, names);
    const usefulFallback = ([a,b] as const).some((input,index) => input.order.unresolvedFields.length && input.unresolvedText.some(line=>{
      if(input.conflictingFields?.includes('ordererName') && (generalDocumentLabel(line)?.field==='orderer' || /^name\s*:/i.test(line)))return false;
      const products=extractNames(line,index===0?'customer_request':'fulfillment_confirmation',resolveCatalog);
      // A correctly parsed unknown brand belongs to catalogue identity fallback,
      // not another extraction request. Reserve extraction AI for actual gaps.
      if(classifyGeneralText(line).category==='administrative')return false;
      return /\b(?:signed|duty nurse|orderer|my name|calling|ordering|placed by|need|request|send|supply|would like|arrange|provide|prepare)\b/i.test(line) ||
        products.some(product=>product.quantityReview || extractionLanguage.test(product.name)) || !products.length && !!line.trim();
    }));
    if (usefulFallback) {
      extractionRequested=true;
      const hybrid = await resolveGeneralOrderExtraction(a, b, getClient, {...support, semanticTimeoutMs: remainingAiMs()});
      extractionReviews.push(...hybrid.reviews.filter(review => review.field === 'facilityName' && review.possibleMatches.length));
      a = hybrid.customer; b = hybrid.fulfillment; extractionStatus = hybrid.semanticAnalysis.status;
    }
    const snapshot = (input: typeof a) => ({ facilityName: input.order.facilityName, ordererName: input.order.ordererName,
      products: input.order.products, unresolvedFields: input.order.unresolvedFields });
    extraction = { customer: snapshot(a), fulfillment: snapshot(b) };
    for (const [input,source] of [[a,'customer_request'],[b,'fulfillment_confirmation']] as const) {
      for (const review of input.quantityReviews || []) extractionReviews.push({kind:'unparsed_text', field:'quantity', source, requiresConfirmation:true,
        originalText:review.originalText, possibleMatches:[], reason:review.reason});
      for (const review of input.identityReviews || []) extractionReviews.push({kind:'product', field:'products', source, requiresConfirmation:true,
        originalText:review.originalText, possibleMatches:[], reason:review.reason});
      for (const field of input.conflictingFields || []) extractionReviews.push({kind:'unparsed_text',field:field as 'ordererName'|'facilityName',source,
        originalText: input.unresolvedText.filter(line=>/^(?:orderer|facility|name of|ordered by|requested by)/i.test(line)).join('\n'),
        possibleMatches:[],reason:`More than one ${field==='ordererName'?'orderer':'ordering facility'} is stated. Confirm which one this order belongs to.`});
      // Catalogue failures already receive one product identity finding below.
      // Preserve other unresolved request clauses instead of silently passing them.
      for (const line of input.unresolvedText) if (classifyGeneralText(line).category!=='administrative' && /\b(?:need|request|send|supply|would like)\b/i.test(line) &&
        !extractNames(line,source).length && !input.conflictingFields?.length &&
        extractGeneralInput(line,source).facilityName==='N/A') extractionReviews.push({kind:'unparsed_text',field:'products',source,
          originalText:line,possibleMatches:[],reason:'Confirm the products and their quantities in this sentence.'});
    }
    readability.customer_request=generalProductReadability(a,'customer_request');
    readability.fulfillment_confirmation=generalProductReadability(b,'fulfillment_confirmation');
    for(const source of ['customer_request','fulfillment_confirmation'] as const) {
      const assessment=readability[source]!;
      if(assessment.unreadQuantityText.length && !extractionReviews.some(review=>review.source===source && review.field==='quantity')) extractionReviews.push({kind:'unparsed_text',field:'quantity',source,requiresConfirmation:true,originalText:assessment.unreadQuantityText.join('\n'),possibleMatches:[],reason:'The product is identified, but its quantity could not be read from this message.'});
      if(assessment.status==='unreadable' && !extractionReviews.some(review=>review.source===source && review.field==='products')) {
        extractionReviews.push({kind:'unparsed_text',field:'products',source,requiresConfirmation:true,
          originalText:assessment.unreadProductText.join('\n'),possibleMatches:[],
          reason:`Could not read all products in the ${source==='customer_request'?'customer request':'fulfilment confirmation'}. Confirm the original product wording before comparing missing or extra items.`});
      }
    }
    customer = a.text; fulfillment = b.text;
  }
  let catalogueLearning={status:'not_needed',added:0,saved:0};
  // Matching source descriptions do not authorize catalogue registration.
  const resolutions = new Map<string, ReturnType<typeof resolveGeneralCatalogIdentity>>();
  const applyAliasDecisions=(name:string,resolution:ReturnType<typeof resolveGeneralCatalogIdentity>)=>{
    if(resolution.product && catalog.aliasRecords?.some(record=>record.productId===resolution.product!.id && record.normalizedText===catalogAliasKey(name) &&
      (record.status==='rejected' || record.status==='approved' && !record.active))) {
      return {normalizedName:resolution.normalizedName,recognized:true,reason:'This alias mapping was rejected or deactivated. Verified correction is required.'};
    }
    return resolution;
  };
  const lookup = (name: string) => {
    if (!resolutions.has(name)) resolutions.set(name, applyAliasDecisions(name,resolveCatalog(name)));
    return resolutions.get(name)!;
  };
  const resolve = (name: string) => lookup(name).product;
  const requested = extractNames(customer, 'customer_request', resolveCatalog), supplied = extractNames(fulfillment, 'fulfillment_confirmation', resolveCatalog);
  // Use uniquely resolved counterparts as catalogue context for omitted details,
  // before deciding that any product needs AI. Never invent a new product ID.
  const initial = new Map([...requested,...supplied].map(p=>[p.name,lookup(p.name)]));
  for (const [side,other] of [[requested,supplied],[supplied,requested]] as const) for(const p of side) {
    const preferred = other.map(q=>initial.get(q.name)?.product?.id).filter((id):id is string=>!!id);
    resolutions.set(p.name,applyAliasDecisions(p.name,resolveCatalog(p.name,preferred)));
  }
  const variants=catalogueProductVariantKeys(requested,supplied,resolve);
  const direct=directProductKeys(requested,supplied,resolve,support.sourceProductConfirmations,variants);
  // A recognized but ambiguous label is still unresolved. Website comparison
  // suggestions must not disappear merely because the catalogue knows the words.
  const unknown = [...new Set([...requested, ...supplied].filter(p => !direct.has(p.name)&&
    (support.requestLanguage ? !lookup(p.name).product : !lookup(p.name).recognized)).map(p => p.name))];
  const unreadNames=new Set([...requested,...supplied].filter(product=>readability[product.source]?.unreadProductText.some(line=>stripGeneralListPrefix(line)===stripGeneralListPrefix(product.originalText))).map(product=>product.name));
  const localSourceSuggestions=(support.requestLanguage||support.generalOnlySmartMatching===true)
    ? new Map([...localSourceComparisonSuggestions([...new Set([...requested.map(p=>p.name),...unknown])].filter(name=>!unreadNames.has(name)),supplied.map(p=>p.name),catalog)].filter(([name])=>!direct.has(name)))
    : new Map<string,ProductResearchSuggestion>();
  if(accessoryContext)for(const [alias,group] of generalVaccineIdentityChoices(requested,supplied,accessoryContext,catalog,lookup))localSourceSuggestions.set(alias,group);
  const locallySuggestedNames=new Set([...localSourceSuggestions.values()].flatMap(group=>[group.alias,...group.options.flatMap(option=>option.sourceName||[])]));
  const aiNames=unknown.filter(name=>!unreadNames.has(name) && !locallySuggestedNames.has(name) && !catalog.aliasRecords?.some(record=>record.normalizedText===catalogAliasKey(name) && (record.status==='pending' || record.status==='rejected' || record.status==='approved' && !record.active)));
  const suggestionChoices=new Map<string,Map<string,{productId:string;name:string;confidence?:number;reason:string;clinicalUncertainty:boolean}>>();
  const addChoice=(alias:string,product:typeof rows[number],confidence?:number,reason='Saved suggestion awaiting verification',clinicalUncertainty=true)=>{
    const options=suggestionChoices.get(alias)||new Map();
    options.set(product.id,{productId:product.id,name:product.name,confidence,reason:researchExplanation(reason),clinicalUncertainty});suggestionChoices.set(alias,options);
  };
  const suggestions = new Map<string, typeof rows[number]>();
  for(const alias of unknown.filter(name=>!unreadNames.has(name))) {
    const pending=catalog.aliasRecords?.filter(record=>record.normalizedText===catalogAliasKey(alias) && record.status==='pending') || [];
    for(const record of pending){
      const product=rows.find(row=>row.id===record.productId&&(row.scope==='general'||isSyringeDescription(row.name))&&!generalCatalogAttributeConflict(alias,row.name));
      if(product)addChoice(alias,product,record.confidence,record.reason||'Saved Gemini suggestion; confirm the product before using it.');
    }
    const ids=new Set(pending.map(record=>record.productId));
    if(ids.size===1) {
      const product=rows.find(row=>row.id===[...ids][0] && (row.scope==='general'||isSyringeDescription(row.name)) && !generalCatalogAttributeConflict(alias,row.name));
      if(product) suggestions.set(alias,product);
    }
  }
  const researchedGroups=new Map<string,ProductResearchSuggestion>(localSourceSuggestions);
  let researchFailure:ProductResearchSuggestion['researchStatus']='unavailable';
  let geminiCalled = false;
  let aiStatus = 'skipped', learningStatus = unknown.length ? 'unresolved' : 'not_needed', savedAliases = 0;
  let aiRequestStarted=false;
  const verifiedAliases=[...new Map([...requested,...supplied].flatMap(p=>{
    const match=lookup(p.name);
    const key=catalogAliasKey(p.name);
    return !unreadNames.has(p.name) && (match.product?.scope==='general'||!!match.product&&isSyringeDescription(match.product.name)) && match.source==='Normalized' &&
      !catalogProductNames(match.product).some(name=>catalogAliasKey(name)===key) &&
      !catalog.aliasRecords?.some(record=>record.normalizedText===key)
      ? [[p.name,{alias:p.name,productId:match.product.id}] as const] : [];
  })).values()];
  if(verifiedAliases.length && support.learnCatalogueAliases) {
    try {
      const saved=await waitForOptionalAuditWrite(support.learnCatalogueAliases(verifiedAliases),remainingWriteMs());
      if(saved.completed) {savedAliases=saved.value;learningStatus=savedAliases ? 'saved' : 'review_required';}
      else learningStatus='save_pending';
    }
    catch {learningStatus='save_failed';}
  }
  if (aiNames.length && remainingAiMs() > 0 && !support.deferProductResearch) {
    try {
      const counterparts = [...requested,...supplied].flatMap(p=>resolve(p.name)?.id || []);
      const candidates = generalCatalogueAiCandidates(rows,aiNames,counterparts,generalProductNameKey);
      if(!candidates.length){
        for(const alias of aiNames.slice(0,4)){
          const group=await researchProduct(alias,catalog,getClient,{timeoutMs:remainingAiMs(),signal:support.signal,onRequest:()=>{aiRequestStarted=true;support.onGeminiRequest?.();},counterpartNames:supplied.map(p=>p.name),counterpartIds:counterparts,scope:support.semanticCacheScope});
          researchedGroups.set(alias,group);
          for(const option of group.options){const product=rows.find(p=>p.id===option.productId);if(product)addChoice(alias,product,option.confidence,option.reason,true);}
          if(group.options.length===1){const product=rows.find(p=>p.id===group.options[0].productId);if(product)suggestions.set(alias,product);}
        }
        aiStatus='used';
      }else{

      const aiKey=JSON.stringify([researchConfig().model,support.semanticCacheScope || '',catalog.revision,aiNames,requested.map(p=>p.name),supplied.map(p=>p.name),candidates.map(p=>[p.id,...catalogProductNames(p)])]);
      const aiTimeoutMs = Math.min(remainingAiMs(),researchConfig().timeoutMs);
      const response: any = await optionalAuditAi(() => sharedCatalogueAi(aiKey,()=>{
        const client=getClient();
        return geminiUsage.run(() => optionalAuditAi(signal => { aiRequestStarted=true; support.onGeminiRequest?.(); return client.models.generateContent({
        model: researchConfig().model,
        contents: JSON.stringify({ unknownNames: aiNames.slice(0, 24), customerNames: requested.map(p => p.name), fulfillmentNames: supplied.map(p => p.name), catalog: candidates.map(p => ({ id: p.id, name: p.name, displayName:p.displayName, fulfillmentSystemName:p.fulfillmentSystemName, deviceSpecifications:p.deviceSpecifications, aliases: p.aliases, contextualAliases:p.contextualAliases })) }),
        config: { systemInstruction: GENERAL_CATALOGUE_AI_INSTRUCTIONS,maxOutputTokens:4096,
          responseMimeType: 'application/json', temperature: 0, abortSignal: signal,
          responseSchema: { type: Type.OBJECT, properties: { matches: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { alias: { type: Type.STRING }, productId: { type: Type.STRING }, confidence: { type: Type.NUMBER }, clinicalUncertainty:{type:Type.BOOLEAN},reason:{type:Type.STRING} }, required: ['alias', 'productId', 'confidence', 'clinicalUncertainty', 'reason'] } }, research:{type:Type.ARRAY,items:{type:Type.OBJECT,properties:{alias:{type:Type.STRING},genericNames:{type:Type.ARRAY,items:{type:Type.STRING}},reason:{type:Type.STRING}},required:['alias','genericNames','reason']}} }, required: ['matches'] },
          httpOptions: { timeout: geminiProviderTimeout(aiTimeoutMs), retryOptions: { attempts: 1 } } },
      }); }, aiTimeoutMs),client);
      },support.signal), aiTimeoutMs, support.signal);
      geminiCalled=true;
      const output = JSON.parse(response.text || '{}');
      const proposals = new Map<string, Set<string>>();
      for (const match of Array.isArray(output.matches) ? output.matches.slice(0, 24) : []) {
        if (!aiNames.includes(match.alias) || typeof match.confidence !== 'number' || match.confidence < 0.5 || match.confidence > 1 || !candidates.some(p => p.id === match.productId && (p.scope === 'general'||isSyringeDescription(p.name)) && !generalCatalogAttributeConflict(match.alias, p.name) && !unsafeSyringeAlias(match.alias,p))) continue;
        addChoice(match.alias,candidates.find(p=>p.id===match.productId)!,match.confidence,typeof match.reason==='string'?match.reason.slice(0,500):'Gemini suggestion; confirm the product before using it.',match.clinicalUncertainty!==false);
        const ids = proposals.get(match.alias) || new Set<string>(); ids.add(match.productId); proposals.set(match.alias, ids);
      }
      // Research leads remain suggestions even when a generic name resolves exactly.
      for(const lead of Array.isArray(output.research)?output.research.slice(0,24):[]){
        if(!aiNames.includes(lead.alias)||!Array.isArray(lead.genericNames))continue;
        const terms=lead.genericNames.filter((term:any)=>typeof term==='string'&&term.length<=160&&!/[\n@]|https?:|\d{7}/i.test(term)).slice(0,4);
        for(const term of terms){
          const product=lookup(term).product;
          if(!product||!(product.scope==='general'||isSyringeDescription(product.name))||generalCatalogAttributeConflict(lead.alias,product.name)||unsafeSyringeAlias(lead.alias,product))continue;
          addChoice(lead.alias,product,.7,`Possible generic terminology: ${term}. ${researchExplanation(String(lead.reason||'Verify against the original packaging.'))}`,true);
          const ids=proposals.get(lead.alias)||new Set<string>();ids.add(product.id);proposals.set(lead.alias,ids);
        }
        if(terms.length){const group=actionableResearchGroup(lead.alias,catalog,[...(suggestionChoices.get(lead.alias)?.values()||[])].slice(0,3),'analysed');group.terminology=terms.map((name:string)=>({name,reason:researchExplanation(String(lead.reason||'Unverified generic terminology; check the packaging.'))}));researchedGroups.set(lead.alias,group);}
      }
      for (const [alias, ids] of proposals) if (ids.size === 1) suggestions.set(alias, rows.find(p => p.id === [...ids][0])!);
      aiStatus = 'used';
      }
    } catch(error:any) { aiStatus = 'fallback';researchFailure=Number(error?.status||error?.code)===429?'rate_limited':/timeout|timed out|aborted/i.test(error?.message||'')?'timed_out':'unavailable'; }
  } else if (aiNames.length) aiStatus = 'fallback';
  if(researchConfig().search&&aiStatus==='used'){
    for(const alias of aiNames.slice(0,4)){
      if(researchedGroups.has(alias)&&researchedGroups.get(alias)!.searchStatus!=='disabled'||remainingAiMs()<=100)continue;
      const group=researchedGroups.get(alias)||actionableResearchGroup(alias,catalog,[...(suggestionChoices.get(alias)?.values()||[])].slice(0,3),'analysed');
      if(group.options.some(o=>o.confidenceCategory==='HIGH'))continue;
      researchedGroups.set(alias,await groundResearchGroup(group,getClient,{timeoutMs:remainingAiMs(),signal:support.signal,onRequest:()=>{aiRequestStarted=true;support.onGeminiRequest?.();}}));
    }
  }
  // AI confidence alone is not clinical validation. Suggestions are diagnostic
  // evidence only; approved aliases continue through the existing catalogue editor.
  if (suggestionChoices.size) {
    learningStatus = 'review_required';
    if(support.suggestCatalogueAliases && [...suggestionChoices.keys()].some(alias=>aiNames.includes(alias))) {
      try {
        const queued=await waitForOptionalAuditWrite(support.suggestCatalogueAliases([...suggestionChoices].filter(([alias])=>aiNames.includes(alias)).flatMap(([alias,options])=>[...options.values()].slice(0,3).map(option=>({alias,productId:option.productId,confidence:option.confidence||0.5,clinicalUncertainty:option.clinicalUncertainty,reason:option.reason})))),remainingWriteMs());
        if(!queued.completed)learningStatus='queue_pending';
      }
      catch {learningStatus='queue_unavailable';} // Identity remains unresolved; no fabricated approval.
    }
  }
  const rawItems = reconcileCatalogueEvidence(requested,supplied,catalog,lookup,support,readability,suggestions);
  const items=accessoryContext?prepareGeneralAccessoryItems(rawItems,accessoryContext):rawItems;
  const resolvedProduct = (p: GeneralProductEvidence) => resolve(p.name);
  const identity = (p: GeneralProductEvidence) => direct.get(p.name) || variants.get(p.name) || (resolvedProduct(p) ? resolvedProduct(p)!.id + (generalBloodDescription(p.name)?.group ? `:blood:${generalBloodDescription(p.name)!.group}` : '') : undefined) || `unresolved:${p.source}:${lookup(p.name).normalizedName}`;
  const conflictKeys = new Set<string>();
  for (const a of requested) for (const b of supplied) if(resolvedProduct(a) && identity(a)===identity(b) && generalCatalogAttributeConflict(a.name,b.name) && lookup(a.name).source!=='Alias' && lookup(b.name).source!=='Alias') conflictKeys.add(identity(a));
  const originalSourceLines = {
    customer_request: facilitySourceCustomer.split(/\r?\n/).map(generalOrderRelevantText).filter(Boolean),
    fulfillment_confirmation: facilitySourceSystem.split(/\r?\n/).map(generalOrderRelevantText).filter(Boolean),
  };
  for (const item of items) item.provenance = item.provenance.map(p => {
    const namePattern = new RegExp(`(?<![\\p{L}\\p{N}])${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
    const original = originalSourceLines[p.source].filter(line => namePattern.test(line));
    return {...p, canonicalId: resolvedProduct(p)?.id, catalogMatchMethod: lookup(p.name).source,
      ...(bloodSources[p.source].evidence.get(p.line) ? {sourceOriginalText:bloodSources[p.source].evidence.get(p.line)} : original.length === 1 ? {sourceOriginalText: original[0]} : {})};
  });
  assertGeneralProductEvidence(items);
  const groups = new Map<string, {requested:GeneralProductEvidence[];supplied:GeneralProductEvidence[]}>();
  for (const item of items) groups.set(item.fulfillment.key, {requested:item.provenance.filter(p=>p.source==='customer_request'),supplied:item.provenance.filter(p=>p.source==='fulfillment_confirmation')});
  const productMatchingDiagnostics = items.map(item => {
    const describe = (source: GeneralProductEvidence['source']) => item.provenance.filter(p=>p.source===source).map(p=>({
      originalName:p.name, normalizedName:lookup(p.name).normalizedName,
      catalogProductId:resolvedProduct(p)?.id || null, catalogCategory:resolvedProduct(p)?.category || null, alias:lookup(p.name).alias || null,
      proposedCatalogProductId:suggestions.get(p.name)?.id || null,
      matchSource:lookup(p.name).source || (direct.has(p.name)?'Direct source comparison':null),
      failureReason:!resolvedProduct(p) ? direct.has(p.name)?null:lookup(p.name).reason : item.fulfillment.identityError || (conflictKeys.has(identity(p)) ? item.action : ['missing item','extra item'].includes(item.status) ? 'No counterpart resolved to the same catalogue product ID.' : null),
      geminiCalled:aiNames.includes(p.name) && (geminiCalled || aiRequestStarted),
    }));
    return {catalogRevision:catalog.revision,customer:describe('customer_request'),fulfillment:describe('fulfillment_confirmation'),status:item.status};
  });
  const base = runGeneralAuditor(customer, fulfillment, {}, { ...support, allowEmptyProductsForReview: true, unreadProductLines:{customer_request:[...(readability.customer_request?.unreadProductText || []),...(readability.customer_request?.unreadQuantityText || [])],fulfillment_confirmation:[...(readability.fulfillment_confirmation?.unreadProductText || []),...(readability.fulfillment_confirmation?.unreadQuantityText || [])]} });
  for(const review of base.generalAudit.semanticReviews || []) if(classifyGeneralText(review.originalText).orderChange &&
    !extractionReviews.some(other=>other.source===review.source && other.originalText===review.originalText)) extractionReviews.push(review);
  const details = base.generalAudit;
  details.facility=compareGeneralFacilities(details.facility.whatsappValue,details.facility.fulfillmentValue,
    facilitySourceCustomer,facilitySourceSystem,support.facilityContext);
  for(const field of ['orderer','facility'] as const){
    details[field]=smartIdentityField(field,details[field]) as typeof details[typeof field];
    if(details[field].status!=='match' && support.readIdentityVariation){
      try{details[field].previousIdentitySuggestion=await support.readIdentityVariation(field,details[field],details.facility);}catch{/* Reference failure never approves an identity. */}
    }
  }
  let facilitySuggestionRequested=false;
  if(!support.deferProductResearch&&!details.facility.previousIdentitySuggestion && !/bounded spelling correction/.test(details.facility.reason||'')) details.facility=await suggestGeneralFacility(details.facility,{...support,semanticTimeoutMs:remainingAiMs(),onGeminiRequest:()=>{facilitySuggestionRequested=true;support.onGeminiRequest?.();}},getClient);
  for (const [field,key] of [['orderer','ordererName'],['facility','facilityName']] as const) {
    if(extractionReviews.some(review=>review.field===key)) details[field]={...details[field],status:'review required',reason:`Confirm the ${field} stated in this message.`};
  }

  // A single exact given name can identify the sole named orderer in this
  // order, when the facility agrees. Never extend this to initials, typos,
  // conflicting suffixes or multiple named orderers.
  // The same given name explicitly stated on both sides also qualifies.
  const nameParts=[details.orderer.whatsappValue,details.orderer.fulfillmentValue].map(normalizeGeneralOrdererName);
  const [short,long]=[...nameParts].sort((a,b)=>a.length-b.length);
  const ordererValues=(text:string)=>[...recognizeGeneralDocument(text).lines.filter(line=>line.field==='orderer' && line.kind==='FIELD_VALUE')
    .map(line=>line.auditText.replace(/^[^:]+:\s*/,'')),...text.matchAll(/^\s*name\s*[:=]\s*(.+)$/gim),...text.matchAll(/\bthank you\s+(.+?)\s+from\b/gi)].map(value=>normalizeGeneralOrdererName(typeof value==='string' ? value : value[1]).join(' '));
  if((support.generalOnlySmartMatching!==true||short.length===long.length) && details.orderer.status==='review required' && details.facility.status==='match' && short.length===1 && short[0].length>=3 &&
    long.length>=1 && long[0]===short[0] && new Set(long).size===long.length && !long.some(word=>/^(?:junior|senior|ii|iii|iv)$|\d/.test(word)) &&
    [customer,fulfillment].every(text=>new Set(ordererValues(text)).size<=1)) {
    details.orderer={...details.orderer,status:'match',nameMatchMethod:'deterministic',reason:'The exact given name matches the sole orderer named for the same facility.'};
  }

  if(details.dropArea) details.dropArea={...details.dropArea,status:'informational'};
  if(details.district) details.district={...details.district,status:'informational'};
  if(!support.deferProductResearch&&!details.orderer.previousIdentitySuggestion && details.orderer.status==='review required' && matchGeneralOrdererNames(details.orderer.whatsappValue,details.orderer.fulfillmentValue).aiMatchAllowed && remainingAiMs()>0 && !extractionReviews.some(review=>review.field==='ordererName')) {
    const checked=await resolveGeneralOrdererName(base,{...support,semanticTimeoutMs:remainingAiMs()},getClient);
    details.orderer=checked.generalAudit.orderer;
  }
  if(ordererExtraction?.status==='needs confirmation')details.orderer={...details.orderer,status:'review required',reason:ordererExtraction.reason};
  if(ordererExtraction?.status==='not detected'&&details.orderer.whatsappValue==='N/A')details.orderer={...details.orderer,reason:ordererExtraction.reason};
  if(ordererExtraction?.status==='not detected'&&details.orderer.whatsappValue!=='N/A')ordererExtraction={...ordererExtraction,
    status:details.orderer.status==='review required'?'needs confirmation':'detected',value:details.orderer.whatsappValue,candidates:[details.orderer.whatsappValue],
    reason:'A later source-validated extraction identified this name in the customer message.'};
  if(ordererExtraction?.status==='extraction error')details.orderer={...details.orderer,status:'review required',reason:ordererExtraction.reason};
  const summary = summarizeGeneralProducts(items, details.facility, details.orderer, details.phone,
    [...groups.values()].filter(g => g.requested.length).length, [...groups.values()].filter(g => g.supplied.length).length, extractionReviews,
    { dropArea: details.dropArea, district: details.district, productVerifications: [],...(accessoryContext?{generalAccessoryContext:accessoryContext}:{}) });
  const result = { ...base, ...summary,meta:{...base.meta,customerName:summary.generalAudit.orderer,ordererName:summary.generalAudit.orderer,facility:summary.generalAudit.facility,facilityName:summary.generalAudit.facility,
    dropArea:details.dropArea || base.meta.dropArea,district:details.district || base.meta.district} };
  result.generalAudit.discrepancies = result.generalAudit.discrepancies.map(message => {
    const item = items.find(item => item.fulfillment.quantityError && message.startsWith(item.name + ' quantity mismatch:'));
    return item ? `${item.name}: ${item.fulfillment.quantityError}` : message;
  });
  for (const item of items) if (item.action.startsWith('Explicit product attributes conflict')) {
    const index = result.generalAudit.discrepancies.findIndex(message=>message.startsWith(item.name));
    if(index>=0) result.generalAudit.discrepancies[index] = `${item.name}: ${item.action}`;
  }
  result.insights = result.generalAudit.discrepancies;
  result.generalAudit.warnings = [];
  result.generalAudit.productVerifications = [];
  // Return only retained findings, keeping their original source wording for
  // CCA decisions and history. Do not restore discarded extraction warnings.
  result.generalAudit.semanticReviews = (summary.generalAudit.semanticReviews || []).map(review=>{
    const original=extractionReviews.find(raw=>raw.source===review.source&&generalOrderRelevantText(raw.originalText).trim()===generalOrderRelevantText(review.originalText).trim());
    return original?{...review,originalText:original.originalText}:review;
  });
  if (extraction) result.generalAudit.extraction = extraction;
  result.generalAudit.extractionReadability=readability;
  result.canDispatchAutomatically = false;
  result.generalAudit.dispatchReadiness = { requiresFacilityConfirmation: result.requiresFacilityConfirmation, canDispatchAutomatically: false };
  result.generalAudit.message = result.generalAudit.productTotals?.quantityReview ? `${result.generalAudit.productTotals.quantityReview} out-of-stock products require verification of the requested quantity recorded in confirmation.` : result.allMatch ? 'Product names and quantities match the fulfilment log.' :
    !result.issueCount && result.generalAudit.pendingOrderLimitCount ? 'Confirm whether an order limit applies to the highlighted quantity shortfalls.' : 'Product names, quantities or identity details do not match.';
  if (result.allMatch) {
    result.generalAudit.finalStatus='NO DISCREPANCY';
    result.generalAudit.message=result.generalAudit.finalStatus;
  }
  const auditDecision = result.generalAudit.decision!;
  result.generalAudit.decision = auditDecision;
  if (auditDecision === 'review') {
    result.generalAudit.finalStatus = 'REVIEW REQUIRED';
    result.generalAudit.message = 'Confirm the unresolved order details before proceeding.';
  }
  return { ...result, extractionAssistance:{requested:extractionRequested,status:extractionStatus}, catalogueLearning, productMatchingDiagnostics, auditEngine: 'general-catalog-v3', comparisonMode: 'product_names_quantities',
    auditDecision,
    generalAudit: { ...result.generalAudit, productComparisonMode: 'names_and_quantities' as const,
      ...(ordererExtraction?{ordererExtraction}:{}),
      ...(support.deferProductResearch?{identityResearch:Object.fromEntries((['facility','orderer'] as const).filter(field=>result.generalAudit[field].status==='review required'&&!result.generalAudit[field].previousIdentitySuggestion).map(field=>[field,{status:'deferred' as const}]))}:{}),
      catalogueSuggestions:[...new Set([...unknown.filter(alias=>!unreadNames.has(alias)&&(!unknown.some(name=>requested.some(p=>p.name===name))||requested.some(p=>p.name===alias))),...localSourceSuggestions.keys()])].slice(0,24).map(alias=>researchedGroups.get(alias)||actionableResearchGroup(alias,catalog,
        [...(suggestionChoices.get(alias)?.values()||[])].sort((a,b)=>(b.confidence||0)-(a.confidence||0)).slice(0,3),support.deferProductResearch&&aiNames.includes(alias)?'deferred':aiStatus==='used'?'analysed':researchFailure,supplied.map(p=>p.name))).map(group=>scopeGeneralFsSuggestion(group,requested,supplied,catalog,accessoryContext)) },
    semanticAnalysis: { status: aiStatus === 'skipped' ? details.facility.aiSuggestion || details.orderer.nameMatchMethod==='gemini' ? 'used' : extractionStatus : aiStatus, reason: extractionStatus === 'used' ? 'Source-validated sentence extraction followed by catalogue identity and quantity checks.' : aiStatus === 'skipped' ? unknown.length ? 'Saved alias decisions require repository review.' : 'Product catalogue names and aliases resolved the comparison.' : 'Catalogue-first product-name matching with AI fallback.' },
    geminiMetrics:{calls:geminiRequests,necessary:aiNames.length>0 || extractionRequested || extractionStatus==='used' || facilitySuggestionRequested || details.orderer.nameMatchMethod==='gemini',requestedNames:aiNames.length,requestStarted:aiRequestStarted,coalesced:geminiCalled && !aiRequestStarted},
    aliasLearning: { status: learningStatus, resolved: 0, proposed: suggestionChoices.size, saved: savedAliases } };
}

/** Reconcile retained source evidence after approval; no extraction or AI calls. */
export function reconcileCatalogueEvidence(requested:GeneralProductEvidence[], supplied:GeneralProductEvidence[], catalog:ProductCatalog,
 lookup:(name:string)=>ReturnType<typeof resolveGeneralCatalogIdentity>, support:GeneralAuditSupport={},
 readability:Partial<Record<GeneralProductEvidence['source'],ReturnType<typeof generalProductReadability>>>={},
 suggestions=new Map<string,ProductCatalog['products'][number]>()) {
 const rows=catalog.products;
 const accessoryContext=support.generalOnlySmartMatching===true?buildGeneralAccessoryCatalog(catalog):undefined;
 const resolve=(name:string)=>lookup(name).product;
  const variants=catalogueProductVariantKeys(requested,supplied,resolve);
  const direct=directProductKeys(requested,supplied,resolve,support.sourceProductConfirmations,variants);
  const resolvedProduct = (p: GeneralProductEvidence) => resolve(p.name);
  const identity = (p: GeneralProductEvidence) => direct.get(p.name) || variants.get(p.name) || (resolvedProduct(p) ? resolvedProduct(p)!.id + (generalBloodDescription(p.name)?.group ? `:blood:${generalBloodDescription(p.name)!.group}` : '') : undefined) || `unresolved:${p.source}:${lookup(p.name).normalizedName}`;
  // Approved whole-source aliases can explicitly map a presentation. Otherwise
  // a common ID cannot erase a stated concentration, form or bottle-size conflict.
  const conflictKeys = new Set<string>();
  for (const a of requested) for (const b of supplied) {
    if (resolvedProduct(a) && identity(a) === identity(b) && generalCatalogAttributeConflict(a.name, b.name) &&
      lookup(a.name).source !== 'Alias' && lookup(b.name).source !== 'Alias') conflictKeys.add(identity(a));
  }
  const originals = new Map([...requested,...supplied].map(p=>[`${p.source}:${p.line}`,p]));
  const evidence = (p: GeneralProductEvidence) => ({ ...p, stockQuantityValidation:direct.has(p.name)||resolvedProduct(p)?.scope==='general'||!!resolvedProduct(p)&&isSyringeDescription(resolvedProduct(p)!.name), name:resolvedProduct(p)?.name || p.name,
    matchedProductKey: identity(p) + (conflictKeys.has(identity(p)) ? `:${p.source}` : ''),
    matchingStage: direct.has(p.name)?'exact' as const:'synonym' as const });
  const assigned = compareAssignedGeneralProducts(requested.map(evidence), supplied.map(evidence), support.generalOrderLimitDecisions || {}, support);
  for (const item of assigned) item.provenance = item.provenance.map(p=>{
    const original = originals.get(`${p.source}:${p.line}`) || p;
    const confirmation=original.source==='customer_request'&&support.sourceProductConfirmations?.find(pair=>pair.alias===original.name&&direct.has(pair.alias)&&direct.get(pair.alias)===direct.get(pair.sourceName));
    const confirmedProduct=confirmation&&resolve(confirmation.sourceName);
    return {...p,...original,matchedProductKey:p.matchedProductKey,stockQuantityValidation:p.stockQuantityValidation,matchingStage:p.matchingStage,
      canonicalId:confirmedProduct?.id||resolvedProduct(original)?.id,catalogMatchMethod:confirmation?'CCA source confirmation':lookup(original.name).source};
  });
  let items: GeneralComparisonItem[] = assigned.map(item => {
    const customerLines = item.provenance.filter(p => p.source === 'customer_request');
    const supplyLines = item.provenance.filter(p => p.source === 'fulfillment_confirmation');
    const paired = !!customerLines.length && !!supplyLines.length;
    const representative = supplyLines[0] || customerLines[0];
    const product = resolvedProduct(representative);
    const name = generalProductDisplayName(representative.name);
    const requestMissing = customerLines.some(p => !!p.quantityReview || !Number.isFinite(p.quantity));
    const supplyMissing = supplyLines.some(p => !!p.quantityReview || !Number.isFinite(p.quantity));
    const quantityError = item.fulfillment.quantityError || (paired && requestMissing ? 'Requested quantity not provided or requires a single clear value.' :
      paired && supplyMissing ? 'Fulfilled quantity not provided or requires a single clear value.' :
      paired && !((direct.has(representative.name)||product?.scope==='general'||!!product&&isSyringeDescription(product.name)) && item.fulfillment.stockStatus==='out of stock' && item.fulfillment.supplied===0) && !item.fulfillment.conversion && new Set([...customerLines,...supplyLines].map(p=>p.unit).filter(Boolean)).size > 1
        ? 'The quantity units differ and no confirmed conversion is available.' : undefined);
    const identityError = conflictKeys.has(identity(representative)) ? 'Explicit product attributes conflict between the request and fulfilment; check the stated strength, form or container size.' : undefined;
    const unreadQuantity=(requestMissing||supplyMissing)&&!identityError&&!item.provenance.some(p=>/negative/i.test(p.quantityReview||''));
    const pendingLimit = !!product && !quantityError && !identityError && item.fulfillment.orderLimitEligible && item.fulfillment.orderLimitDecision === undefined;
    const quantity = { ...item.fulfillment, name, registeredOutOfStock:(support.osuItems||[]).some(value=>lookup(value).product?.id===product?.id && !!product), requestedQuantityMissing: requestMissing, suppliedQuantityMissing: supplyMissing,
      ...(pendingLimit ? { fulfillmentStatus:'pending order limit' as const } : {}),
      ...(quantityError ? { quantityError, orderLimitEligible:false, fulfillmentStatus:item.fulfillment.quantityReviewRequired || unreadQuantity ? 'quantity review' as const : 'discrepancy' as const } : {}) };
    return { ...item, name, fulfillment:quantity,
      ...(product ? {catalogProductId: product.id, catalogCategory: product.category} : {}),
      ...(pendingLimit ? { status:'pending order limit' as const, action:'Confirm whether an order limit applies to this quantity shortfall.' } : {}),
      requested:requestMissing ? 'Not provided' : item.requested, found:supplyMissing ? 'Not provided' : item.found,
      ...(quantityError ? { status:item.fulfillment.quantityReviewRequired || unreadQuantity ? 'quantity review' as const : 'quantity mismatch' as const, action:quantityError } : {}),
      ...(identityError ? { action:identityError } : {}) };
  });
  // Reconcile only failed identity assignments. Related rows form review
  // components, never a presumed match, so genuine unrelated omissions survive.
  const vaccineDescriptions=rows.filter(row=>row.scope==='vaccine').map(row=>{
    const counterpart=generalVaccineCounterpart(row,rows);
    return new Set([...catalogProductNames(row),...(counterpart?catalogProductNames(counterpart):[])].map(catalogKey));
  });
  const vaccineAliasConflict=(a:GeneralProductEvidence,b:GeneralProductEvidence)=>vaccineDescriptions.some(labels=>labels.has(catalogKey(a.name)) && labels.has(catalogKey(b.name)));
  const missing=items.filter(item=>item.status==='missing item');
  const unmatchedStock=items.filter(item=>item.status==='out of stock' && !item.provenance.some(p=>p.source==='customer_request'));
  const stockReviews=unmatchedStock.filter(stock=>{
    const candidates=missing.filter(item=>vaccineAliasConflict(item.provenance[0],stock.provenance[0]));
    return candidates.length===1 && unmatchedStock.filter(other=>vaccineAliasConflict(candidates[0].provenance[0],other.provenance[0])).length===1;
  });
  const unresolved = items.filter(item=>['missing item','extra item'].includes(item.status) || stockReviews.includes(item));
  const visited = new Set<GeneralComparisonItem>();
  const reviews: GeneralComparisonItem[] = [];
  for (const seed of unresolved) {
    if (visited.has(seed)) continue;
    const component = [seed]; visited.add(seed);
    for (let index=0; index<component.length; index++) for (const candidate of unresolved) {
      if (visited.has(candidate)) continue;
      const a=component[index].provenance[0], b=candidate.provenance[0];
      if (a.source===b.source) continue;
      if(support.generalOnlySmartMatching===true){
        const context=accessoryContext!;
        const role=(p:GeneralProductEvidence)=>generalAccessoryIdentity(context,p.name,resolvedProduct(p)?.id)?.role||(/\b(?:diluent|dropper)\b/i.test(p.name)?'accessory':'vaccine');
        if(role(a)!==role(b))continue;
      }
      const sameId=resolvedProduct(a) && identity(a)===identity(b);
      const suggested = suggestions.get(a.name)?.id===resolvedProduct(b)?.id && !!resolvedProduct(b) || suggestions.get(b.name)?.id===resolvedProduct(a)?.id && !!resolvedProduct(a);
      const related=relatedGeneralCatalogDescriptions(a.name,b.name)||!!syringeDescriptionConflict(a.name,b.name);
      const companion=[resolvedProduct(a),resolvedProduct(b)].some(product=>product && (product.category==='companion' || /\b(?:diluent|dropper)\b/i.test(product.name)));
      // Being the last unmatched rows is never evidence of product identity.
      // Only a repository relationship or an explicitly retained AI suggestion
      // can group a review; neither authorizes a match or an alias approval.
      if (!sameId && !(suggested&&!companion) && !vaccineAliasConflict(a,b) && !related) continue;
      visited.add(candidate);component.push(candidate);
    }
    const sources=component.flatMap(item=>item.provenance);
    const lacksIdentity=sources.some(p=>!direct.has(p.name)&&!resolvedProduct(p));
    if (component.length===1 && (!lacksIdentity || (sources[0].source==='customer_request'?supplied:requested).every(p=>assigned.some(item=>item.provenance.some(e=>e.source===p.source&&e.line===p.line)&&item.provenance.some(e=>e.source!==p.source))))) continue;
    const key=`identity-review:${component.map(item=>item.fulfillment.key).sort().join('|')}`;
    const before=sources.filter(p=>p.source==='customer_request');
    const after=sources.filter(p=>p.source==='fulfillment_confirmation');
    const grouped=compareAssignedGeneralProducts(before.map(p=>({...p,matchedProductKey:key})),after.map(p=>({...p,matchedProductKey:key})),{},support)[0];
    const representative=after[0] || before[0];
    const name=generalProductDisplayName(representative.name);
    const conflict=sources.some(a=>sources.some(b=>a.source!==b.source && generalCatalogAttributeConflict(a.name,b.name)));
    const confirmedConflict=conflict && (sources.some(p=>!!resolvedProduct(p))||before.some(a=>after.some(b=>generalProductNameKey(a.name)===generalProductNameKey(b.name))));
    const vaccineConflict=before.some(a=>after.some(b=>vaccineAliasConflict(a,b) && resolvedProduct(a)?.id!==resolvedProduct(b)?.id));
    const deviceConflict=before.flatMap(a=>after.map(b=>syringeDescriptionConflict(a.name,b.name))).find(Boolean);
    const identityError=deviceConflict || (vaccineConflict ? 'Conflicting vaccine catalogue mappings — confirm the intended product.' : conflict ? 'Product identity conflict — no approved repository mapping for these specifications.' : 'Product could not be matched. Check the product name.');
    const {conversion:_unverifiedConversion,...quantity}=grouped.fulfillment;
    reviews.push({...grouped,name,status:'product identity discrepancy',action:identityError,provenance:sources,
      fulfillment:{...quantity,key,name,fulfillmentStatus:'discrepancy',discrepancyKind:'identity',identityError,identityConflictConfirmed:confirmedConflict || vaccineConflict&&support.generalOnlySmartMatching!==true,
        orderLimitEligible:false,orderLimitDecision:undefined,
        requestedQuantityMissing:before.some(p=>!!p.quantityReview || !Number.isFinite(p.quantity)),
        suppliedQuantityMissing:after.some(p=>!!p.quantityReview || !Number.isFinite(p.quantity)),quantityError:'Quantity comparison paused until the product is matched.',registeredOutOfStock:false}});
  }
  const reviewedKeys=new Set(reviews.flatMap(item=>item.provenance.map(p=>`${p.source}:${p.line}`)));
  items=items.filter(item=>!item.provenance.some(p=>reviewedKeys.has(`${p.source}:${p.line}`)));
  items.push(...reviews);
  const unknownCustomer=requested.some(product=>!direct.has(product.name)&&!resolvedProduct(product));
  const unknownFulfillment=supplied.some(product=>!direct.has(product.name)&&!resolvedProduct(product));
  // An unread identity on the opposite side cannot prove a missing/extra item.
  // Keep these rows separate: do not assign one product's quantities or ID to
  // another. Known vaccine companions still go through their pairing checks.
  items=items.map(item=>{
    const unproven=item.status==='extra item'&&unknownCustomer || item.status==='missing item'&&unknownFulfillment;
    const product=resolvedProduct(item.provenance[0]);
    if(!unproven || product&&(product.category==='companion'||/\b(?:diluent|dropper)\b/i.test(product.name)))return item;
    const reason='A product name in the other message could not be matched. Compare the original product descriptions.';
    return {...item,status:'product identity discrepancy' as const,action:reason,
      fulfillment:{...item.fulfillment,identityReviewRequired:true,identityConflictConfirmed:false,
        identityError:reason,quantityError:'Quantity comparison paused until the product is matched.',discrepancyKind:'identity' as const,
        fulfillmentStatus:'discrepancy' as const,orderLimitEligible:false,orderLimitDecision:undefined}};
  });
  // An absent customer product list cannot establish that a real FS item is
  // extra. Retain the FS evidence, and request identity confirmation instead.
  if (!requested.length) items = items.map(item => ({...item, status: 'product identity discrepancy' as const,
    action: 'Confirm the product requested by the customer; no customer product identity was provided.',
    fulfillment: {...item.fulfillment, identityReviewRequired: true, requestedQuantityMissing: true,
      identityError: 'Customer product identity not provided. Confirm the original request.',
      fulfillmentStatus: 'discrepancy' as const, orderLimitEligible: false}}));
  // An unread counterpart list cannot prove an omission or an extra product.
  // Preserve paired quantity/clinical conflicts and all independent name checks.
  items=items.map(item=>{
    const missing=item.status==='missing item',extra=item.status==='extra item';
    const uncertainIdentity=item.status==='product identity discrepancy' && !item.fulfillment.identityConflictConfirmed;
    const unknownSide=missing?'fulfillment_confirmation':extra?'customer_request':uncertainIdentity?(['customer_request','fulfillment_confirmation'] as const).find(source=>readability[source]?.status==='unreadable'):undefined;
    if(!unknownSide || readability[unknownSide]?.status!=='unreadable')return item;
    const reason=`Could not read all products in the ${unknownSide==='customer_request'?'customer request':'fulfilment confirmation'}; ${item.name} cannot yet be compared.`;
    return {...item,status:'product identity discrepancy' as const,action:reason,
      fulfillment:{...item.fulfillment,identityReviewRequired:true,identityConflictConfirmed:false,
        identityError:reason,quantityError:reason,discrepancyKind:'identity' as const,
        fulfillmentStatus:'discrepancy' as const,orderLimitEligible:false,orderLimitDecision:undefined,
        ...(missing?{suppliedQuantityMissing:true}:extra?{requestedQuantityMissing:true}:{})}};
  });
  assertGeneralProductEvidence(items);
  return items;
}
