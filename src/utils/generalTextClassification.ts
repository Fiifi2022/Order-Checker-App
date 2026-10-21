/** General Auditor only. Unknown text remains unresolved; a date, number or
 * delivery keyword by itself never proves that a line is administrative. */
export type GeneralTextCategory = 'mandatory_order' | 'optional_order' | 'administrative' | 'unresolved_order';
export interface GeneralTextClassification { category: GeneralTextCategory; reason: string; orderChange?: boolean }

const change = /\b(?:change(?:d)?|amend(?:ed)?|correct(?:ed)?|increase(?:d)?|decrease(?:d)?|reduce(?:d)?|replace(?:d)?|switch(?:ed)?|substitute(?:d)?|cancel(?:led|ed)?|remove(?:d)?)\b[^.!?\n]*\b(?:orders?|quantit(?:y|ies)|\d+|from\s+\d|\d+\s+(?:to|instead)|products?|medicin(?:e|es)|tablets?|bottles?|vials?|doses?|facility|hospital|clinic|chps|orderer|recipient|destination|district|drop\s*(?:site|area)|drop[- ]?off|location)\b/i;
const revisedQuantity = /\b(?:send|deliver|use|supply)\b[^.!?\n]*\b(?:instead(?: of)?|rather than)\b/i;
const changedDestination = /\b(?:new|different|another|alternative|changed|updated)\s+(?:(?:health|delivery|drop)\s+)?(?:facility|centre|center|hospital|clinic|district|dropsite|drop site|drop area|location|destination|orderer|recipient)\b/i;
const revisedIdentity = /\b(?:facility|orderer|recipient|destination|district|drop area|location)\s+(?:(?:has been|is|was)\s+)?(?:changed|updated|corrected)\s+(?:to|from)\b/i;
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
const remainder = '(?:the (?:rest|remainder|remaining (?:items|products))(?: of (?:your|the) order)?|any remaining (?:items|products))';
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
  if (genericStockCommunication(text)) return true;
  if (clinical.test(text)) return false;
  if (temporalNotification(text)) return true;
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
  return text.split(/(?<=[.!?])\s+(?=[a-z])/i).filter(Boolean);
}
export function classifyGeneralText(raw: string): GeneralTextClassification {
  const text = raw.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
  // Specific operational directives take precedence over greetings, dates and
  // metadata prefixes, even when embedded in an otherwise routine footer.
  if (change.test(text) || revisedIdentity.test(text) || changedDestination.test(text) || revisedQuantity.test(text)) return { category: 'unresolved_order', reason: 'Explicit order or destination change requires verification.', orderChange: true };
  if (/^(?:delivery\s*\/\s*drop area|delivery drop area|drop area|delivery area|drop location|drop off area|district(?: name)?)\s*[:=]/i.test(text)) return { category: 'optional_order', reason: 'Explicit optional location information.' };
  if (/^(?:name of orderer|orderer(?: name)?|requested by|requester|recipient|customer name|name of health facility|health facility|facility(?: name| id)?|hospital|clinic|products(?: and quantities)?|out of stock|available(?: products| items)?|in stock)\s*[:=.!]?$/i.test(text) || /^(?:name of orderer|orderer(?: name)?|requested by|requester|recipient|customer name|name of health facility|health facility|facility(?: name| id)?|hospital|clinic)\s*[:=]/i.test(text)) return { category: 'mandatory_order', reason: 'Explicit identity or order section.' };
  if (/^(?:(?:we are )?(?:currently )?out of stock(?: for (?:the )?following (?:items|products))?|we can prepare the following items we have in stock for delivery|available(?: products| items)?|no fulfilled products)[:.!]?$/i.test(text)) return { category: 'mandatory_order', reason: 'Stock or product section; quantities still require validation.' };
  // Check every sentence; an accepted prefix cannot hide an unrecognized tail.
  const clauses = sentences(text);
  if (text && clauses.length && clauses.every(administrativeClause)) return { category: 'administrative', reason: 'Routine notification, service contact or courtesy text; no order instruction.' };
  return { category: 'unresolved_order', reason: 'Text is not confidently classified as administrative information.' };
}
/** Preserve line positions for quantity provenance; never rewrite source orders. */
export function generalOrderRelevantText(text: string) {
  return text.split(/\r?\n/).map(line => classifyGeneralText(line).category === 'administrative' ? '' : sentences(line).filter(part => classifyGeneralText(part).category !== 'administrative').join(' ')).join('\n');
}
