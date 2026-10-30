import { generalDocumentLabel, generalNonProductPhrase, recognizeGeneralDocument, generalStandaloneQuantity } from './generalDocumentStructure';
import { GENERAL_SENTENCE_BREAK, GENERAL_SENTENCE_BREAK_SOURCE } from './generalSentenceBoundaries';
const nonOrderClauseBoundary = new RegExp(`(;|${GENERAL_SENTENCE_BREAK_SOURCE}|,\\s*(?=(?:please|pls|kindly|we need|i need|patient|client|age|sex|gender|status|symptoms?|bsct|wbct|contact|phone)\\b))`, 'i');
/** General Auditor only. Unknown text remains unresolved; a date, number or
 * delivery keyword by itself never proves that a line is administrative. */
export type GeneralTextCategory = 'mandatory_order' | 'optional_order' | 'administrative' | 'unresolved_order';
export interface GeneralTextClassification { category: GeneralTextCategory; reason: string; orderChange?: boolean }
export type GeneralAuditLineKind = 'facility_identity' | 'orderer_identity' | 'product_request' | 'product_quantity' | 'product_amendment' | 'optional_metadata' | 'administrative' | 'unknown';

const change = /\b(?:change(?:d)?|amend(?:ed)?|correct(?:ed)?|increase(?:d)?|decrease(?:d)?|reduce(?:d)?|replace(?:d)?|switch(?:ed)?|substitute(?:d)?|cancel(?:led|ed)?|remove(?:d)?)\b[^.!?\n]*\b(?:orders?|quantit(?:y|ies)|\d+|from\s+\d|\d+\s+(?:to|instead)|products?|medicin(?:e|es)|tablets?|bottles?|vials?|doses?|facility|hospital|clinic|chps|orderer|recipient|destination|district|drop\s*(?:site|area)|drop[- ]?off|location)\b/i;
const revisedQuantity = /\b(?:send|deliver|use|supply)\b[^.!?\n]*\b(?:instead(?: of)?|rather than)\b/i;
const changedDestination = /\b(?:new|different|another|alternative|changed|updated)\s+(?:(?:health|delivery|drop)\s+)?(?:facility|centre|center|hospital|clinic|district|dropsite|drop site|drop area|location|destination|orderer|recipient)\b/i;
const revisedIdentity = /\b(?:facility|orderer|recipient|destination|district|drop area|location)\s+(?:(?:has been|is|was)\s+)?(?:changed|updated|corrected)\s+(?:to|from)\b/i;
// These describe the patient or communication, rather than an order. Keep an
// explicit order instruction even when it shares a clause with clinical context.
const essentialInstruction = /\b(?:(?:we|i)\s+(?:need|want|request)|(?:please|pls|kindly)\s+(?:send|supply|give|include)|send|supply|(?:orderer|ordered by|requested by|facility)(?=\s*[:;=])|(?:change|amend|correct|replace|cancel|increase|reduce)\b[^.!?;]*\b(?:order|quantity|qty|product|facility|orderer|destination|district)|quantity|qty|order limit|out of stock)\b/i;
const nonOrderLabel = /^(?:(?:patient|client)(?:\s*\/\s*(?:patient|client))?(?:['’]s)?(?:\s+(?:full\s+)?name|\s+age|\s+sex|\s+gender|\s+details?)?|name of (?:patient|client)|age(?: of (?:patient|client))?|sex|gender|clinical(?:\s+(?:condition|history|details|observations?))?|condition|symptoms?|observations?|medical observations?|test results?|status(?: description)?|contact(?: details?| numbers?)?|phone(?: numbers?)?|telephone|tel|mobile(?: numbers?)?)\s*[:;=–—|-]\s*/i;
const nonOrderHeading = /^(?:(?:patient|client)(?:\s*\/\s*(?:patient|client))?(?:\s+(?:full\s+)?name|\s+age|\s+sex|\s+gender|\s+details?)?|name of (?:patient|client)|age|sex|gender|clinical(?:\s+(?:condition|history|details|observations?))?|condition|symptoms?|observations?|medical observations?|test results?|status(?: description)?|contact(?: details?| numbers?)?|phone(?: numbers?)?|telephone|tel|mobile(?: numbers?)?)\s*[:;=–—|-]?$/i;
// Four compulsory parameters only. Optional metadata is retained in the raw
// source, but cannot become product evidence or a compulsory review.
const excludedMetadata = /^(?:(?:district|region|sub[- ]?district|dropsite|drop site|delivery\s*\/\s*drop area|delivery drop area|delivery area|drop area|drop location|delivery location|delivery instructions?|delivery date|delivery time|gps(?: coordinates)?|coordinates?|latitude|longitude|tracking(?: link| number)?|order\s*(?:id|number|reference)|reference(?: number)?|date|contact(?: details?| numbers?)?|phone(?: numbers?)?|telephone|tel|mobile(?: numbers?)?|priority(?: reason)?|delivery priority|budget holder|notes?)\s*[:;=–—-]|(?:(?:please|kindly)\s+)?(?:deliver|dispatch)(?:\s+(?:it|them|the order|these items))?\s+(?:to|at|behind|before|after|between|on|tomorrow|today|urgently)\b)/i;
const patientContactOrInsurance = /^(?:(?:patient|client)(?:['’]s)?\s+(?:contact|phone|telephone|tel|mobile)(?:\s+(?:details?|numbers?))?\s*[:;=–—-]|nhis(?:\s|[-:;=–—]|$)|(?:non[- ]?)?insured\s*$|insurance\s+(?:status|details?)\s*[:;=–—-])/i;
export function generalCompulsoryText(value: string): string {
  const optionalChange = /^(?:(?:please|kindly)\s+)?(?:use|change|update|correct)\s+(?:the\s+)?(?:(?:new|different|updated)\s+)?(?:district|region|dropsite|drop site|drop area|delivery location|delivery instructions?|date|phone|contact|gps|coordinates?)\b/i;
  if (!excludedMetadata.test(value.trim()) && !optionalChange.test(value.trim()) && !patientContactOrInsurance.test(value.trim())) return value;
  // Keep the actual order clause in mixed text, without interpreting the
  // surrounding location, date or contact number as part of the product.
  const directives = /\b(?:(?:please|pls|kindly)\s+)?(?:(?:we|i)\s+(?:need|want|require|request)|send|supply|include|add|replace|substitute|increase|decrease|reduce|remove|cancel|change|amend|correct)\b/gi;
  for (const match of value.matchAll(directives)) {
    const tail = value.slice(match.index!);
    const object = tail.replace(/^(?:(?:please|pls|kindly)\s+)?(?:(?:we|i)\s+)?\w+\s+/i, '').replace(/^(?:the\s+)?/i, '');
    if (/^(?:district|region|drop\s*(?:area|site|off)|delivery|location|gps|coordinates?|date|phone|contact|tracking|order\s*(?:id|number))\b/i.test(object)) continue;
    return tail;
  }
  const included = value.match(/\b(?:with|plus|and)\s+(.+?\s+\d+(?:\.\d+)?(?:\s*\/\s*\d+)?\s*(?:vials?|boxes?|packs?|units?|tablets?|bottles?)?[.!]?\s*)$/i)?.[1];
  if (included && !/^(?:gps|coordinates?|date|phone|contact|tracking|district|region|gate|road|street|house|entrance|junction|ward|address)\b/i.test(included)) return included;
  return '';
}
export function isGeneralNonOrderInformation(value: string): boolean {
  const text = value.trim().replace(/^[•*]\s*/, '').replace(/[.!]+$/, '').trim();
  if (!text || essentialInstruction.test(text)) return false;
  if (patientContactOrInsurance.test(text)) return true;
  if (nonOrderLabel.test(text) || nonOrderHeading.test(text)) return true;
  if (/^(?:(?:patient|client)(?:['’]s)?\s+(?:name|age|sex|gender)|name of (?:patient|client)|status(?: description)?|clinical(?:\s+(?:condition|history|observations?))?|symptoms?|observations?|test results?)\s+.+$/i.test(text)) return true;
  if (/^\d{1,3}\s*(?:years?|yrs?)(?:\s*old)?$/i.test(text)) return true;
  if (/^(?:age\s*\/\s*sex\s*[:=]\s*)?(?:\d{1,3}\s*[/,-]\s*(?:m|f|male|female)|(?:m|f|male|female)\s*[/,-]\s*\d{1,3})$/i.test(text)) return true;
  if (/^(?:(?:patient|client)\s+(?:is|has|presents|presented|reports|reported|complains|complained)\b|(?:a\s+)?\d{1,3}\s*[- ]?(?:years?\s*[- ]?old|y\/?o)\b|(?:male|female)(?:\s*[,;/ -]\s*\d{1,3}(?:\s*years?)?)?$|(?:age|sex|gender)\s+(?:\d{1,3}|male|female)\b)/i.test(text)) return true;
  if (/^(?:bsct|wbct|hb|haemoglobin|hemoglobin|bp|blood pressure|pulse|temperature|spo2|blood glucose|rbs|fbs)\s*(?::|;|=|>|<|is\b|of\b|greater\b|less\b|\d)/i.test(text)) return true;
  if (/^(?:(?:heavy|severe|mild|moderate|profuse|persistent|generalised|generalized|localised|localized|no|with|without)\s+)*(?:swelling|bleeding|clotting|pain|fever|vomiting|diarrhoea|diarrhea|dizziness|sweating|snake\s*bite|snakebite|bite wound)\b/i.test(text) && !/\b(?:vials?|boxes?|packs?|doses?|tablets?|syrup|medicine|drug|vaccine|serum|antiserum|antivenom|antivenin|injection|infusion|suspension)\b/i.test(text)) return true;
  if (/^(?:patient|client)\s+(?:needs?|requires?)\s+(?:close\s+|further\s+|urgent\s+)?(?:monitoring|observation|admission|review|referral|assessment)[.!]?$/i.test(text)) return true;
  if (/^(?:stable|unstable|critical|conscious|unconscious|alert|recovering|improving|deteriorating)(?:\s+(?:patient|client))?$/i.test(text)) return true;
  return /^(?:(?:contact|phone|telephone|tel|mobile)(?:\s+number)?\s*)?(?:\+?\d[\d ().-]{6,}\d)$/.test(text);
}
/** Preserve offsets, including values following a patient/clinical heading. */
export function stripGeneralNonOrderInformation(text: string): string {
  let valueFollows = false;
  // WhatsApp emphasis is presentation, never part of an identity or product.
  text = text.replace(/(?<!\d)(\*{1,2}|_{1,2}|`)(?=\S)([^\n]+?\S|\S)\1/g, '$2');
  return text.split(/\r?\n/).map(line => {
    const filtered = line.split(nonOrderClauseBoundary).map(part => {
      if (part === ';' || !part.trim()) return part;
      const compulsory = generalCompulsoryText(part);
      // Keep empty labels long enough to pair multiline values. Remove inline
      // metadata now so a following semicolon-separated product survives.
      if (!compulsory.trim() && !/^[\p{L}\s/()-]+\s*[:=]\s*$/u.test(part)) return '';
      if (compulsory.trim()) part = compulsory;
      const plain = part.trim();
      if (valueFollows) {
        valueFollows = false;
        if (!essentialInstruction.test(plain) && !/^(?:name of orderer|orderer|ordered by|requested by|name of health facility|health facility|facility|hospital|product|item|medicine|drug|quantity|qty|amount)\b/i.test(plain) && !/\d\s*(?:vials?|boxes?|packs?|doses?|tablets?|bottles?)\b/i.test(plain)) return '';
      }
      if (nonOrderHeading.test(plain)) { valueFollows = true; return ''; }
      return isGeneralNonOrderInformation(part) ? '' : part;
    }).join('');
    return filtered === line ? line : filtered.replace(/^[,;\s]+|[,;\s]+$/g, '');
  }).join('\n');
}

const clinical = /\b(?:\d+(?:\.\d+)?\s*(?:mg|mcg|ml|iu)|tablets?|capsules?|syrup|suspension|injection|vaccine|vials?|bottles?|doses?|out of stock|order limit)\b/i;
const temporalWords = new Set(('between and at from to on by within in of the next business working expected estimated delivery arrival time window date is scheduled for am pm utc gmt today tomorrow tonight morning afternoon evening noon midnight hours hour hrs hr minutes minute mins min days day weeks week monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec a p m est edt pst pdt st nd rd th').split(' '));
function temporalNotification(clause: string) {
  const match = clause.match(/^(?:(?:expected|estimated|scheduled|planned)\s+(?:delivery|arrival)(?:\s+(?:date|time|window))?|delivery\s+(?:date|time(?: window)?|window)|eta)\s*(?::|=|\bis\b)\s*(.+)$/i);
  const arrival = clause.match(/^(?:(?:your|the) (?:order|delivery|shipment) (?:is |has been )?(?:expected|estimated|scheduled) to arrive|(?:your|the) (?:order|delivery|shipment) will arrive)\s+(.+)$/i);
  const time = match?.[1] ?? arrival?.[1];
  if (!time || !/\b(?:today|tomorrow|tonight|noon|midnight|am|pm|hours?|hrs?|minutes?|mins?|days?|weeks?|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|\d[:/.-]\d|\d\s*[ap]\.m/i.test(time)) return false;
  return (time.toLowerCase().match(/[a-z]+/g) || []).every(word => temporalWords.has(word));
}
// Closed grammatical patterns refer only to the unspecified remainder, never
// a named product, quantity, facility or replacement destination. Compile once;
// unknown additions do not inherit an exception from the word "stock".
const remainder = '(?:these items|them|the (?:rest|remainder|remaining (?:items|products))(?: of (?:your|the) order)?|any remaining (?:items|products))';
const stockLocation = '(?:(?:the|your) (?:nearest|local)|another|an alternative) stock(?: location| point| centre| center)?';
const genericStockContact = new RegExp(`^(?:please )?(?:reach out to|contact|check with) ${stockLocation} for ${remainder}$`, 'i');
const restocked = '(?:re[- ]?stocked|back in stock|stock (?:is|becomes) available)';
const restockAction = `(?:notify (?:you|us)|(?:be able to )?(?:deliver|supply|send) ${remainder})`;
const genericRestockFollowup = new RegExp(`^(?:once|when) (?:we are |we have been |(?:the )?(?:items|products) are )?${restocked},? we (?:will|can) ${restockAction}(?: and ${restockAction})?(?:,? if (?:still )?(?:needed|required))?$`, 'i');
function genericStockCommunication(text: string): boolean {
  if (genericStockContact.test(text) || genericRestockFollowup.test(text)) return true;
  if (/^(?:the|your) (?:remaining (?:items|products)|rest of (?:the|your) order) (?:are|is) (?:currently )?(?:out of stock|unavailable|awaiting re[- ]?stocking)$/i.test(text)) return true;
  if (/^we (?:will|shall) notify you (?:once|when) (?:(?:we are|the (?:items|products) are) )?(?:re[- ]?stocked|back in stock|stock (?:is|becomes) available)$/i.test(text)) return true;
  return /^(?:(?:some|certain) (?:items|products) (?:are (?:currently )?unavailable|are awaiting re[- ]?stocking)|(?:we are )?(?:currently )?awaiting re[- ]?stocking|re[- ]?stocking is (?:in progress|pending)|stock availability (?:is subject to change|will be confirmed))$/i.test(text);
}
function administrativeClause(value: string): boolean {
  const text = value.trim().replace(/^[•*]\s*/, '').replace(/[.!]+$/, '').trim();
  if (!text) return true;
  if (isGeneralNonOrderInformation(text)) return true;
  if (/^to accurately process your request,? kindly complete the (?:below|following) form\s*:?$/i.test(text)) return true;
  if (/^(?:we have|we've) received your order\s*\(\s*id\s*:\s*[a-z0-9_-]{1,80}\s*\)$/i.test(text)) return true;
  if (genericStockCommunication(text)) return true;
  if (clinical.test(text)) return false;
  if (/^(?:(?:i|we) )?hope (?:you (?:are|have been) (?:doing )?well|all is well|you are having a (?:good|great|nice) day)[.!]?$/i.test(text)) return true;
  if (/^(?:how are you(?: doing)?|have a (?:good|great|nice) (?:day|weekend)|sorry for (?:the )?(?:delay|late reply)|thank you (?:very much|so much)|thanks (?:again|in advance))[.!?]?$/i.test(text)) return true;
  if (/^(?:our|the) (?:nurse|doctor|staff|team|officer)(?: member)? (?:is|are) (?:on leave|off duty|on duty|away|unavailable|in a meeting)(?: (?:today|tomorrow|this (?:morning|afternoon|evening)))?$/i.test(text)) return true;
  if (temporalNotification(text)) return true;
  if (/^(?:(?:please|kindly)[, ]+)+(?:make (?:it|the order) available|deliver (?:it|the order)) (?:on time|as soon as possible)$/i.test(text)) return true;
  if (/^use this link to track your (?:order|delivery|shipment)\s*:\s*https?:\/\/\S+$/i.test(text)) return true;
  // Whole-sentence templates, never a keyword match: an unrecognized tail or
  // actual order instruction must remain available to the auditor.
  if (/^(?:you (?:will|may) receive (?:your )?(?:(?:flight|delivery|order|tracking|status) )?(?:notifications?|updates?) (?:via|by|through) (?:sms|text messages?)|(?:your )?(?:(?:flight|delivery|order|tracking|status) )?(?:notifications?|updates?) will be sent (?:to you )?(?:via|by|through) (?:sms|text messages?)|you will be notified (?:via|by) (?:sms|text message) when your (?:order|delivery) (?:is dispatched|is on its way|arrives))$/i.test(text)) return true;
  if (/^you (?:will|may) receive (?:your )?(?:(?:flight|delivery|order|tracking|status) )?sms (?:notifications?|updates?)$/i.test(text)) return true;
  if (/^(?:(?:please )?track your (?:order|delivery|shipment) using the (?:tracking )?link (?:in your (?:sms|text message)|provided)|(?:your )?(?:order|delivery|shipment) tracking (?:is available|has been updated)|(?:your )?tracking link will be sent (?:via|by) (?:sms|text message))$/i.test(text)) return true;
  if (/^(?:zipline|hello|hi|good (?:morning|afternoon|evening)|thank you|thanks|thank you for (?:your order|choosing zipline|your patience)|you are welcome|kind regards|best regards|regards|sincerely)[,! ]*$/i.test(text)) return true;
  if (/^(?:(?:we have|we've) received your order|your order (?:has been received|is being processed)|order received|your delivery is on (?:its|the) way|your order (?:has been dispatched|is ready for delivery))$/i.test(text)) return true;
  if (/^(?:please )?let us know if (?:any changes are required|you have any questions)(?: or (?:contact|call)\s+[+\d ()-]+\s+(?:if you have|if any|for any)?\s*questions)?$/i.test(text)) return true;
  if (/^(?:customer (?:service|support)|support (?:phone|number|contact)|helpline|help ?desk)(?:\s+(?:phone|number|contact))?\s*[:=]\s*[+\d ()-]+$/i.test(text)) return true;
  if (/^(?:(?:please )?(?:contact|call)\s+[+\d ()-]+\s+(?:for|if you have|if any)\s+(?:any\s+)?(?:questions|queries|assistance|support)|for (?:any )?(?:questions|queries|assistance|support)[,: ]+(?:please )?(?:contact|call)(?: customer (?:service|support))?\s*(?:at|on|:)?\s*[+\d ()-]+)$/i.test(text)) return true;
  if (/^(?:(?:please )?contact customer (?:service|support) for (?:assistance|help|questions)|if you have any questions[ ,]+please contact (?:us|customer (?:service|support))|this (?:message|email) is intended for the (?:named|intended) recipient only|(?:the )?zipline team)$/i.test(text)) return true;
  if (/^(?:this is an (?:automated|automatic) (?:message|notification)|(?:please )?do not reply(?: to this (?:automated )?(?:message|notification|email))?|sent (?:automatically|from my (?:iphone|ipad|android))|(?:zipline )?customer (?:service|support)(?: team)?|(?:zipline )?operations team)$/i.test(text)) return true;
  return false;
}
// WhatsApp sentences do not reliably start with capitals. Split only after
// sentence punctuation followed by whitespace, keeping decimal quantities intact.
function sentences(text: string) {
  return text.split(GENERAL_SENTENCE_BREAK).filter(Boolean);
}
/** Only a complete calendar date is metadata; ratios and product quantities
 * with extra words remain available for extraction and validation. */
function standaloneOrderDate(text: string): boolean {
  const match = text.match(/^(?:(\d{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})|([0-9]{1,2})([/-])([0-9]{1,2})\5([0-9]{2}|[0-9]{4}))$/);
  if (!match) return false;
  const year = Number(match[1] || (match[7].length === 2 ? `20${match[7]}` : match[7]));
  const month = Number(match[2] || match[6]), day = Number(match[3] || match[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function classifyGeneralText(raw: string): GeneralTextClassification {
  const text = raw.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
  const compulsory = generalCompulsoryText(text);
  if (!compulsory.trim()) return {category: 'administrative', reason: 'Excluded metadata; not one of the four compulsory audit parameters.'};
  if (compulsory !== text) return classifyGeneralText(compulsory);
  if (isGeneralNonOrderInformation(text)) return { category: 'administrative', reason: 'Patient, clinical, status or contact information; excluded from order checks.' };
  const structure = generalDocumentLabel(text);
  if (structure && !structure.value) return { category: structure.field === 'date' ? 'administrative' : 'mandatory_order', reason: 'Recognized document field or section heading.' };
  // Specific operational directives take precedence over greetings, dates and
  // metadata prefixes, even when embedded in an otherwise routine footer.
  if (change.test(text) || revisedIdentity.test(text) || changedDestination.test(text) || revisedQuantity.test(text)) return { category: 'unresolved_order', reason: 'Explicit order or destination change requires verification.', orderChange: true };
  const phrase = generalNonProductPhrase(text);
  if (phrase && !phrase.value) return { category: phrase.boundary ? 'mandatory_order' : 'administrative', reason: 'Recognized introductory, administrative or notification text.' };
  if (structure?.field === 'date' && /^(?:\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+\s+\d{4}|[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4})$/i.test(structure.value)) return { category: 'administrative', reason: 'Explicit order date.' };
  const labelledDate = text.match(/^date\s*[:;=–—-]?\s*(\d{1,4}[-/]\d{1,2}[-/]\d{2,4})$/i)?.[1];
  if (standaloneOrderDate(text) || labelledDate && standaloneOrderDate(labelledDate)) return { category: 'administrative', reason: 'Standalone order date; excluded from essential order checks.' };
  if (/^(?:delivery\s*\/\s*drop area|delivery drop area|drop area|delivery area|drop location|drop off area|district(?: name)?)\s*[:=]/i.test(text)) return { category: 'optional_order', reason: 'Explicit optional location information.' };
  if (/^vaccines? requisition(?:\s*\(\s*all in vials\s*\))?\s*[:.!]?$/i.test(text) || /^we will now prepare the following items for delivery\s*[:.!]?$/i.test(text)) return { category: 'mandatory_order', reason: 'Product section heading; individual product quantities remain authoritative.' };
  if (/^(?:name of orderer|orderer(?: name)?|requested by|requester|recipient|customer name|name of health facility|health facility|facility(?: name| id)?|hospital|clinic|products?(?: and quantities)?|out of stock|available(?: products| items)?|in stock)\s*[:=.!]?$/i.test(text) || /^(?:name of orderer|orderer(?: name)?|requested by|requester|recipient|customer name|name of health facility|health facility|facility(?: name| id)?|hospital|clinic)\s*[:=]/i.test(text)) return { category: 'mandatory_order', reason: 'Explicit identity or order section.' };
  if (/^(?:(?:we are )?(?:currently )?out of stock(?: for (?:the )?following (?:items|products))?|we can prepare the following items we have in stock for delivery|available(?: products| items)?|no fulfilled products)[:.!]?$/i.test(text)) return { category: 'mandatory_order', reason: 'Stock or product section; quantities still require validation.' };
  // Check every sentence; an accepted prefix cannot hide an unrecognized tail.
  const clauses = sentences(text);
  if (text && clauses.length && clauses.every(administrativeClause)) return { category: 'administrative', reason: 'Routine notification, service contact or courtesy text; no order instruction.' };
  return { category: 'unresolved_order', reason: 'Text is not confidently classified as administrative information.' };
}

/** Shared pre-audit roles; quantity declarations never establish a product identity. */
export function classifyGeneralAuditLine(raw: string): GeneralAuditLineKind {
  const text = raw.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
  const classified = classifyGeneralText(text);
  if (classified.orderChange) return 'product_amendment';
  if (isGeneralNonOrderInformation(text) || !generalCompulsoryText(text).trim()) return 'optional_metadata';
  if (classified.category === 'administrative') return 'administrative';
  const label = generalDocumentLabel(text);
  if (label?.field === 'facility') return 'facility_identity';
  if (label?.field === 'orderer') return 'orderer_identity';
  if (label?.field === 'quantity' || generalStandaloneQuantity.test(text)) return 'product_quantity';
  if (label && ['district', 'delivery', 'date'].includes(label.field)) return 'optional_metadata';
  const line = recognizeGeneralDocument(text, classifyGeneralText).lines[0];
  return line?.kind === 'PRODUCT_ENTRY' ? 'product_request' : 'unknown';
}
/** Preserve line positions for quantity provenance; never rewrite source orders. */
export function generalOrderRelevantText(text: string) {
  return recognizeGeneralDocument(stripGeneralNonOrderInformation(text), classifyGeneralText).auditText.split(/\r?\n/).map(line => classifyGeneralText(line).category === 'administrative' ? '' : sentences(line).filter(part => classifyGeneralText(part).category !== 'administrative').join(' ')).join('\n');
}
