import { expandGeneralMedicalTerms, getGeneralMedicalAmbiguity, stripGeneralRepeatedAlias, resolveGeneralApprovedIdentity } from './generalMedicalTerminology';
import { generalQuantityBasis } from './generalPackaging';
import { expandGeneralProductAcronyms, isGeneralBloodProduct } from './medicalProductAcronyms';
import { traceGeneralAudit } from './generalAuditDebug';
import type { GeneralFieldResult, GeneralAuditDetails, GeneralProductResult, GeneralAuditCheckSummary, GeneralSemanticReview } from './generalAuditTypes';
import type { AuditItem } from '../../server/deterministicAudit';
import { calculateGeneralAuditSummary, getGeneralAuditorAction, normalizeAuditText } from '../../server/generalAuditRules';

export type GeneralProductSource = 'customer_request' | 'fulfillment_confirmation';
export interface GeneralProductEvidence {
  name: string; // Clean display identity; originalText retains the untouched source line.
  canonicalId?: string;
  normalizedName: string;
  quantity: number;
  ratioRequestedQuantity?: number;
  orderLimitApplied?: boolean;
  stockIndicator?: string;
  stockSection?: string;
  unit: string;
  originalText: string;
  source: GeneralProductSource;
  line: number;
}
export interface GeneralComparisonItem extends Omit<AuditItem, 'status'> {
  status: AuditItem['status'] | 'pending order limit' | 'order limit applied';
  provenance: GeneralProductEvidence[];
  difference: number;
  fulfillment: GeneralProductResult;
}

// Anchored to the start: decimal strengths and compound dosage numbers are
// medical identity, not list markers (e.g. 31.25mg and 20/120mg).
const GENERAL_LIST_PREFIX = /^(?:(?:[-*•]\s*|\d+(?:\.(?!\d)|\))\s*|\d+\s+[-–—]\s*))+/;
export function stripGeneralListPrefix(value: string): string {
  return value.trim().replace(GENERAL_LIST_PREFIX, '').trim();
}

/** General-only display boundary, including older titles containing raw quantities. */
export function generalProductDisplayName(value: string): string {
  const name = stripGeneralListPrefix(value);
  const explicitQuantitySuffix = new RegExp(`(?:\\s[-–—:=]\\s*${NUMBER}(?:\\s*${UNIT})?|[\\[(]\\s*${NUMBER}\\s*/\\s*${NUMBER}\\s*(?:${UNIT})?\\s*[\\])])\\s*[.!]?$`, 'i');
  return explicitQuantitySuffix.test(name)
    ? parseGeneralProducts(name, 'customer_request')[0]?.name ?? name
    : name;
}

// These substitutions compare names already present in the inputs. They never
// enumerate a catalogue or supply an implicit strength, form, or pack size.
export function normalizeGeneralProductName(name: string): string {
  const base = stripGeneralRepeatedAlias(stripGeneralListPrefix(name)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\bcoartem\s*\(\s*(?:al|act)\s*\)/g, 'coartem')
    .replace(/\b(artemether\s*\+?\s*lumefantrine)\s*\(\s*(?:al|act)\s*\)/g, '$1')
    .replace(/\bartemether\s*(?:\/|\+|&)\s*lumefantrine\b/g, 'artemether lumefantrine')
    .replace(/\b(?:act\s*\/\s*al|al\s*\/\s*act)\b/g, 'artemether lumefantrine')
    .replace(/\boral rehydration salts?\s*\(\s*(?:ors|ort)\s*\)/g, 'oral rehydration salts');
  const normalized = expandGeneralProductAcronyms(expandGeneralMedicalTerms(base))
    .replace(/\bamox\b/g, 'amoxicillin')
    .replace(/\b(?:pcm)\b/g, 'paracetamol')
    .replace(/\b(?:ors|ort)\b/g, 'oral rehydration salts')
    .replace(/\boral rehydration salt\b/g, 'oral rehydration salts')
    .replace(/^(?:rdts?|rapid diagnostic tests?)$/g, 'malaria rdt')
    .replace(/\bmalaria (?:rdts?|rapid diagnostic tests?)\b/g, 'malaria rdt')
    .replace(/\b(?:al|act|coartem)\b/g, 'artemether lumefantrine')
    .replace(/\b(?:tabs?|tablets)\b/g, 'tablet')
    .replace(/\b(?:caps?|capsules)\b/g, 'capsule')
    .replace(/\b(?:inj|injections)\b/g, 'injection')
    .replace(/\b(?:syr|syrups)\b/g, 'syrup')
    .replace(/\b(?:susp|suspensions)\b/g, 'suspension')
    .replace(/\bgloves\b/g, 'glove')
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '')
    .replace(/(\d)\s+(mg|mcg|g|ml|l|iu)\b/g, '$1$2')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .replace(/[^a-z0-9./]+/g, ' ')
    .trim();
  // Preserve measurement order as well as values: compound strengths must not
  // match if the amounts assigned to the constituent medicines were swapped.
  const measurements = normalized.match(/\b\d+(?:\.\d+)?(?:mg|mcg|g|ml|l|iu)(?:\/\d+(?:\.\d+)?(?:mg|mcg|g|ml|l|iu))?\b/g) || [];
  const canonicalId = resolveGeneralApprovedIdentity(base)?.canonicalId;
  return `${canonicalId ? `${canonicalId}|` : ''}${normalized.split(/\s+/).filter(Boolean).sort().join(' ')}|${measurements.join(' ')}`;
}

const NUMBER = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const UNIT = '(?:units?|vials?|packs?|box(?:es)?|cards?|doses?|sachets?|tablets?|capsules?|bottles?|pieces?|pcs?|tests?)';
const quantityValue = (value: string) => Number(value.replace(/,/g, ''));
const normalizeUnit = (value = '') => value.toLowerCase().replace(/^boxes$/, 'box').replace(/^pcs?$/, 'piece').replace(/s$/, '');
// Ordered from specific labels to generic fallbacks, independent of line order.
const ORDERER_LABELS = ['name of orderer', 'orderer name', 'orderer', 'requested by', 'requester',
  'customer name', 'sender', 'recipient', 'fulfilment recipient', 'fulfillment recipient', 'customer', 'authorized contact', 'name'];
const FACILITY_LABELS = ['name of health facility', 'health facility', 'facility name', 'name of facility', 'facility', 'hospital', 'clinic'];
const SYSTEM_FACILITY_LABELS = ['destination', 'delivery facility', 'delivery site', 'deliver to', 'order for'];
const metadataLabels = [
  ...ORDERER_LABELS, ...FACILITY_LABELS, ...SYSTEM_FACILITY_LABELS,
  'date', 'name', 'name of orderer', 'orderer name', 'customer name', 'name of health facility', 'health facility', 'orderer',
  'requester', 'sender', 'recipient', 'fulfilment recipient', 'fulfillment recipient', 'customer', 'authorized contact',
  'contact', 'contact information', 'contact number', 'telephone', 'tel', 'phone', 'phone number', 'reference phone', 'ref phone', 'mobile', 'mobile number', 'notes',
  'facility', 'facility name', 'facility id', 'hospital', 'clinic', 'district',
  'delivery drop area', 'drop area', 'delivery area', 'delivery time',
  'preferred time for delivery', 'order id', 'order number', 'reference', 'ref',
  'quantity', 'total', 'products', 'products and quantities'
];
const isMetadataLabel = (value: string) => metadataLabels.includes(normalizeAuditText(value));
const GENERAL_STOCK_TEXT = '(?:currently\\s+out\\s+of\\s+stock|out\\s+of\\s+stock|not\\s+currently\\s+in\\s+stock|currently\\s+unavailable|unavailable|oos)';
const GENERAL_STOCK_SECTION = new RegExp(`^(?:we\\s+are\\s+)?${GENERAL_STOCK_TEXT}(?:\\s+for\\s+(?:the\\s+)?following\\s+(?:items|products))?\\s*[:.!]?$`, 'i');
const GENERAL_AVAILABLE_SECTION = /^(?:in\s+stock|available(?:\s+(?:items|products))?|(?:items|products)\s+(?:in\s+stock|available))\s*[:.!]?$/i;
const GENERAL_STOCK_SUFFIX = new RegExp(`^(.+?)\\s*(?:[-–—:=]\\s*|\\s+)(${GENERAL_STOCK_TEXT})\\s*[.!]?$`, 'i');

function trimGeneralProductName(value: string): string {
  const name = value.trim();
  const bloodRhMinus = isGeneralBloodProduct(expandGeneralProductAcronyms(name)) && /\b(?:ab|a|b|o)\s*[-−]$/i.test(name);
  return bloodRhMinus ? name : name.replace(/\s*[:=–—-]\s*$/, '').trim();
}

// Only an affirmative annotation on this product's quantity line can provide
// an automatic exemption. Generic notes and mentions of a possible limit cannot.
function extractGeneralOrderLimit(line: string) {
  const annotation = line.match(/\s*(?:\(|\[|[-–—;,]|\b(?:because|due to)\b)\s*(?:(?:the|an)\s+)?(?:applicable\s+)?order[ -]limit\s*:?\s*(?:(?:was|has been|is|being)\s+)?(?:applied|reached|enforced)\s*[\])]*[.!]?$/i);
  if (!annotation) return { line, applied: false };
  return { line: line.slice(0, annotation.index).trim()
    .replace(/\b(?:(?:can be|was|were)\s+)?(?:supplied|fulfilled)\s*$/i, '').replace(/\bonly\s+(?=\d)/i, '').trim(), applied: true };
}

/** A fresh evidence list per call, extracted solely from explicit quantity lines. */
export function parseGeneralProducts(text: string, source: GeneralProductSource): GeneralProductEvidence[] {
  const result: GeneralProductEvidence[] = [];
  let stockSection: string | undefined;
  text.split(/\r?\n/).forEach((originalText, index) => {
    const strippedLine = stripGeneralListPrefix(originalText);
    if (source === 'fulfillment_confirmation') {
      if (GENERAL_STOCK_SECTION.test(strippedLine)) {
        stockSection = originalText.trim();
        return;
      }
      // An explicit new section ends the stock list. Positive quantities are
      // always parsed as supplied, even if they occur inside a stock section.
      if (strippedLine.endsWith(':') || GENERAL_AVAILABLE_SECTION.test(strippedLine)) stockSection = undefined;
    }
    const orderLimit = source === 'fulfillment_confirmation' ? extractGeneralOrderLimit(strippedLine) : { line: strippedLine, applied: false };
    let line = orderLimit.line;
    if (!line || isMetadataLabel(line.split(':')[0])) return;
    if (source === 'fulfillment_confirmation' && (extractSentenceOrderer(line) !== 'N/A' || extractSentenceFacility(line) !== 'N/A')) return;
    let name = '', quantity = '', unit = '';
    let ratioRequestedQuantity: number | undefined;
    const stockMarker = source === 'fulfillment_confirmation' && line.match(GENERAL_STOCK_SUFFIX);
    const stockIndicator = stockMarker ? stockMarker[2] : undefined;
    if (stockMarker) {
      line = trimGeneralProductName(stockMarker[1]);
    }
    let match = line.match(new RegExp(`^(.+?)\\s*(\\[|\\()\\s*(${NUMBER})\\s*/\\s*(${NUMBER})\\s*(${UNIT})?\\s*(\\]|\\))\\s*(${UNIT})?\\s*[.!]?$`, 'i'));
    if (match && ((match[2] === '[' && match[6] === ']') || (match[2] === '(' && match[6] === ')'))) { name = match[1]; quantity = match[3]; ratioRequestedQuantity = quantityValue(match[4]); unit = match[5] || match[7] || ''; }
    else {
      match = line.match(new RegExp(`^(${NUMBER})\\s*(${UNIT})?\\s+(?:of\\s+)?(.+?)\\s*[.!]?$`, 'i'));
      if (match) { quantity = match[1]; unit = match[2] || ''; name = match[3]; }
      else {
        match = line.match(new RegExp(`^(.+?)\\s*(?:[-–—:=]\\s*|\\s+)(?:\\[)?(${NUMBER})(?:\\s*/\\s*(${NUMBER}))?\\s*(${UNIT})?\\s*(?:\\])?\\s*[.!]?$`, 'i'));
        if (match) { name = match[1]; quantity = match[2]; ratioRequestedQuantity = match[3] === undefined ? undefined : quantityValue(match[3]); unit = match[4] || ''; }
      }
    }
    // A product explicitly named unavailable is present even without a quantity.
    // Section context is used only for listed names that have no parsed quantity.
    if (quantity === '' && (stockIndicator || stockSection && GENERAL_LIST_PREFIX.test(originalText.trim()))) {
      name = line;
      quantity = '0';
    }
    name = trimGeneralProductName(name);
    // A heading or metadata value is never an order line.
    if (!name || !/[a-z]/i.test(name) || isMetadataLabel(name)) return;
    const parsedQuantity = quantityValue(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) return;
    const canonicalId = resolveGeneralApprovedIdentity(stripGeneralRepeatedAlias(name))?.canonicalId;
    result.push({ name, ...(canonicalId ? { canonicalId } : {}), normalizedName: normalizeGeneralProductName(name), quantity: parsedQuantity, ...(ratioRequestedQuantity === undefined ? {} : { ratioRequestedQuantity }), ...(orderLimit.applied ? { orderLimitApplied: true } : {}), ...(stockIndicator ? { stockIndicator } : {}), ...(stockSection ? { stockSection } : {}), unit: normalizeUnit(unit), originalText, source, line: index + 1 });
  });
  return result;
}

function groupProducts(products: GeneralProductEvidence[]) {
  const grouped = new Map<string, GeneralProductEvidence[]>();
  for (const product of products) {
    const current = grouped.get(product.normalizedName) || [];
    current.push(product);
    grouped.set(product.normalizedName, current);
  }
  return grouped;
}

function isZeroStockRatio(product: GeneralProductEvidence): boolean {
  return product.quantity === 0 && Number.isInteger(product.ratioRequestedQuantity) && product.ratioRequestedQuantity! > 0;
}

// Semantic rewriting retains source line positions and only appends metadata.
// Explicitly parsed stock rows are authoritative: preserve their complete names,
// strengths, adult/paediatric qualifiers and zero/expected evidence verbatim.
export function preserveGeneralOutOfStockEvidence(original: string, interpreted: string): string {
  const lines = interpreted.split(/\r?\n/);
  for (const product of parseGeneralProducts(original, 'fulfillment_confirmation')) {
    if (product.quantity === 0 && (product.ratioRequestedQuantity === undefined || isZeroStockRatio(product))) {
      lines[product.line - 1] = product.originalText;
    }
  }
  return lines.join('\n');
}

export function preserveGeneralRequestedStockProducts(customer: string, fulfillment: string, interpretedCustomer: string): string {
  const stockKeys = new Set(parseGeneralProducts(fulfillment, 'fulfillment_confirmation')
    .filter(product => product.quantity === 0 && (product.ratioRequestedQuantity === undefined || isZeroStockRatio(product)))
    .map(product => product.normalizedName));
  const lines = interpretedCustomer.split(/\r?\n/);
  for (const product of parseGeneralProducts(customer, 'customer_request')) {
    if (stockKeys.has(product.normalizedName)) lines[product.line - 1] = product.originalText;
  }
  return lines.join('\n');
}

export function compareGeneralProducts(customerRequest: string, fulfillmentConfirmation: string, orderLimitDecisions: Record<string, boolean> = {}, support: GeneralAuditSupport = {}): GeneralComparisonItem[] {
  return compareExtractedGeneralProducts(parseGeneralProducts(customerRequest, 'customer_request'), parseGeneralProducts(fulfillmentConfirmation, 'fulfillment_confirmation'), orderLimitDecisions, support);
}

function compareExtractedGeneralProducts(customerProducts: GeneralProductEvidence[], systemProducts: GeneralProductEvidence[], orderLimitDecisions: Record<string, boolean> = {}, support: GeneralAuditSupport = {}): GeneralComparisonItem[] {
  const customer = groupProducts(customerProducts);
  const fulfillmentProducts = groupProducts(systemProducts);
  // Pair canonical groups before assigning statuses. Presence is independent of
  // quantity, so zero-supply fulfillment groups are consumed just like positive ones.
  const consumedFulfillment = new Set<string>();
  const pairs: { key: string; requested: GeneralProductEvidence[]; found: GeneralProductEvidence[] }[] = [];
  for (const [key, requested] of customer) {
    const found = fulfillmentProducts.get(key) ?? [];
    if (fulfillmentProducts.has(key)) consumedFulfillment.add(key);
    pairs.push({ key, requested, found });
  }
  for (const [key, found] of fulfillmentProducts) {
    if (!consumedFulfillment.has(key) && found.some(product => product.quantity > 0 || isZeroStockRatio(product))) {
      pairs.push({ key, requested: [], found });
    }
  }
  return pairs.map(({ key, requested, found }) => {
    const requestedQuantity = requested.reduce((total, item) => total + item.quantity, 0);
    const foundQuantity = found.reduce((total, item) => total + item.quantity, 0);
    const sourceName = (requested[0] || found[0]).name;
    const identity = resolveGeneralApprovedIdentity(stripGeneralRepeatedAlias(sourceName));
    const name = identity && found.length && !/^(?:ASV|ARV)$/i.test(found[0].name)
      ? found[0].name : identity?.resolvedName ?? sourceName;
    const requestedUnits = new Set(requested.map(item => item.unit).filter(Boolean));
    const foundUnits = new Set(found.map(item => item.unit).filter(Boolean));
    const unitsAgree = requestedUnits.size <= 1 && foundUnits.size <= 1 &&
      (!requestedUnits.size || !foundUnits.size || [...requestedUnits][0] === [...foundUnits][0]);
    const conversion = requestedUnits.size === 1 && foundUnits.size === 1 ? generalQuantityBasis(name, requestedQuantity, foundQuantity, [...requestedUnits][0], [...foundUnits][0], normalizeGeneralProductName) : null;
    const comparableRequested = conversion?.requested ?? requestedQuantity;
    const comparableSupplied = conversion?.supplied ?? foundQuantity;
    const unitsComparable = unitsAgree || !!conversion;
    const orderLimitEligible = requested.length > 0 && found.length > 0 && unitsComparable && comparableSupplied > 0 && comparableSupplied < comparableRequested;
    const explicitOrderLimit = found.filter(product => product.quantity > 0).every(product => product.orderLimitApplied === true);
    const decision = orderLimitEligible ? Object.hasOwn(orderLimitDecisions || {}, key) && typeof orderLimitDecisions[key] === 'boolean'
      ? orderLimitDecisions[key] : explicitOrderLimit ? true : undefined : undefined;
    // Classify the canonical aggregate once. A positive duplicate line means
    // partial/full supply, even if another line for that product says 0/n.
    const outOfStock = found.length > 0 && foundQuantity === 0 &&
      found.every(product => product.ratioRequestedQuantity === undefined || isZeroStockRatio(product)) &&
      (requestedQuantity > 0 || found.some(isZeroStockRatio));
    const baseStatus: AuditItem['status'] = outOfStock ? 'out of stock' :
      !found.length ? 'missing item' : !requested.length ? 'extra item' :
      decision === true || comparableRequested === comparableSupplied && unitsComparable ? 'match' : 'quantity mismatch';
    const fulfillmentStatus: GeneralProductResult['fulfillmentStatus'] = baseStatus === 'out of stock' ? 'out of stock' :
      decision === true ? 'order limit applied' :
      baseStatus === 'match' ? 'fully supplied' : 'discrepancy';
    const fulfillment: GeneralProductResult = { key, name, requested: requested.length ? requestedQuantity : found.reduce((total, item) => total + (item.ratioRequestedQuantity ?? 0), 0), supplied: foundQuantity,
      difference: Math.abs(comparableRequested - comparableSupplied), fulfillmentStatus, orderLimitEligible,
      requestedUnit: [...requestedUnits][0] || '', suppliedUnit: [...foundUnits][0] || '',
      discrepancyKind: baseStatus === 'missing item' ? 'missing' : baseStatus === 'extra item' ? 'extra' : 'quantity',
      registeredOutOfStock: (support.osuItems || []).some(item => normalizeGeneralProductName(item) === key),
      ...(conversion ? { conversion } : {}),
      ...(decision === undefined ? {} : { orderLimitDecision: decision }) };
    const display = (items: GeneralProductEvidence[], quantity: number, units: Set<string>) =>
      items.length ? `${quantity}${units.size === 1 ? ` ${[...units][0]}` : ''}` : 'None';
    const requestedText = display(requested, requestedQuantity, requestedUnits);
    const status: GeneralComparisonItem['status'] = fulfillmentStatus === 'order limit applied' ? fulfillmentStatus : baseStatus;
    return { name, category: 'Medical Product', requested: requestedText, found: display(found, foundQuantity, foundUnits), status,
      fulfillment, difference: fulfillment.difference, action: decision === true ? `${name} could not be fully fulfilled because the applicable order limit was reached.` : getGeneralAuditorAction(status, name, requestedText), provenance: [...requested, ...found] };
  });
}

function parseGeneralMetadata(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const originalLine of text.split(/\r?\n/)) {
    const line = stripGeneralListPrefix(originalLine);
    // Split at the first colon so colons in the value are retained.
    const colon = line.indexOf(':');
    const alternate = colon < 0 ? line.match(/^(.+?)\s*(?:=|\s[-–—]\s)\s*(.*)$/) : null;
    if (colon < 0 && !alternate) continue;
    const label = normalizeAuditText(colon >= 0 ? line.slice(0, colon) : alternate![1]);
    const value = (colon >= 0 ? line.slice(colon + 1) : alternate![2]).trim();
    fields.set(label, [...(fields.get(label) || []), value]);
  }
  return fields;
}

function extractMetadata(fields: Map<string, string[]>, labels: string[]) {
  for (const label of labels) {
    const value = fields.get(label)?.find(value => !/^(?:n\/?a|none|unknown|not provided|-)?$/i.test(value));
    if (value) return value;
  }
  return 'N/A';
}

function extractGeneralIdentity(text: string, source: GeneralProductSource, customerOrdererName = 'N/A', customerFacilityName = 'N/A') {
  const fields = parseGeneralMetadata(text);
  return {
    ordererName: source === 'fulfillment_confirmation' ? locateGeneralSystemOrderer(text, customerOrdererName, fields) : extractMetadata(fields, ORDERER_LABELS),
    facilityName: source === 'fulfillment_confirmation' ? locateGeneralSystemFacility(text, customerFacilityName, fields) : extractMetadata(fields, FACILITY_LABELS),
    phone: extractGeneralPhone(text, fields)
  };
}

export function extractGeneralInput(text: string, source: GeneralProductSource, customerOrdererName = 'N/A', customerFacilityName = 'N/A') {
  return { ...extractGeneralIdentity(text, source, customerOrdererName, customerFacilityName), products: parseGeneralProducts(text, source) };
}

// Accept spelling and abbreviation differences without discarding facility type.
function formatGeneralFacility(value: string) {
  return normalizeAuditText(value)
    .replace(/\bc h p s\b/g, 'chps')
    .replace(/\bh c\b/g, 'hc')
    .replace(/\bhc\b/g, 'health center')
    .replace(/\bhosp\b/g, 'hospital')
    .replace(/\bcentre\b/g, 'center')
    .replace(/\bchps compound\b/g, 'chps');
}

function normalizeGeneralFacility(value: string) {
  const formatted = formatGeneralFacility(value);
  return formatted.replace(/(?:\s+(?:chps|health center|clinic|hospital))+$/, '').trim() || formatted;
}
function normalizeOrderer(value: string) {
  const words = normalizeAuditText(value).replace(/^(?:(?:dr|doctor|nurse|mr|mrs|ms|prof|sir|madam)\s+)+/, '').split(' ');
  return words.filter((word, index) => index === 0 || index === words.length - 1 || word.length !== 1).join(' ');
}

function generalOrdererNamesMatch(left: string, right: string) {
  const a = normalizeOrderer(left), b = normalizeOrderer(right);
  if (a === b) return true;
  const aWords = a.split(' '), bWords = b.split(' ');
  return aWords.length >= 2 && bWords.length >= 2 && (aWords.length === 2 || bWords.length === 2) &&
    aWords[0] === bWords[0] && aWords.at(-1) === bWords.at(-1);
}

function compareGeneralField(whatsappValue: string, fulfillmentValue: string, equivalent: (left: string, right: string) => boolean): GeneralFieldResult {
  const status: GeneralFieldResult['status'] = whatsappValue === 'N/A'
    ? 'missing from customer request' : fulfillmentValue === 'N/A'
    ? 'not available in system entry' : equivalent(whatsappValue, fulfillmentValue) ? 'match' : 'mismatch';
  return { whatsappValue, fulfillmentValue, status };
}
const PHONE_LABELS = ['phone number', 'contact number', 'mobile number', 'reference phone', 'ref phone', 'phone', 'mobile', 'telephone', 'tel', 'contact', 'contact information'];
function extractGeneralPhone(text: string, fields = parseGeneralMetadata(text)) {
  const labelled = extractMetadata(fields, PHONE_LABELS);
  if (labelled !== 'N/A' && labelled.replace(/\D/g, '').length >= 7) return labelled;
  return text.match(/(?:\+?233|00233|0)(?:[\s().-]*\d){9}\b/)?.[0].trim() || 'N/A';
}
function normalizeGeneralPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00233')) digits = digits.slice(2);
  if (digits.startsWith('233') && digits.length === 12) digits = '0' + digits.slice(3);
  if (digits.length === 9) digits = '0' + digits;
  return digits;
}
export interface GeneralAuditSupport { osuItems?: string[]; allowEmptyProductsForReview?: boolean; }


/** Exact normalized words, retaining the original system-side spelling as evidence. */
function findCurrentOrdererMention(text: string, customerName: string) {
  if (customerName === 'N/A') return 'N/A';
  const expected = normalizeOrderer(customerName);
  if (!expected) return 'N/A';
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const maxWords = expected.split(' ').length + 3;
  for (let i = 0; i < words.length; i++) {
    for (let size = 1; size <= maxWords && i + size <= words.length; size++) {
      const end = words[i + size - 1];
      const candidate = text.slice(words[i].index!, end.index! + end[0].length);
      if (generalOrdererNamesMatch(candidate, customerName)) return candidate;
    }
  }
  return 'N/A';
}

// Only explicit orderer phrases provide a different person's name. Unknown prose
// is never guessed to be a person; an exact customer-name mention can still match.
function extractSentenceOrderer(text: string) {
  for (const originalLine of text.split(/\r?\n/)) {
    const line = stripGeneralListPrefix(originalLine);
    const prefix = line.match(/\b(?:thank\s+you|thanks\s+to|dear|requested\s+by|order\s+received\s+(?:from|for)|(?:we\s+have\s+)?received\s+your\s+order\s+for)\s+(.+)$/i);
    const suffix = line.match(/^(.+?)\s+placed\s+(?:this|the)\s+order\b/i);
    const rawName = prefix?.[1] ?? suffix?.[1];
    if (!rawName) continue;
    const name = rawName.split(/\.{2,}|[,;!?]|(?<!\bdr)(?<!\bmr)(?<!\bmrs)(?<!\bms)(?<!\bprof)(?<!\b[a-z])\.(?=\s|$)|\s+(?:at|with|on|for|from)\s+/i)[0].trim();
    const words = name.split(/\s+/);
    // Two or more explicit name words avoids treating “you” or “delivery” as a person.
    if (words.length < 2 || words.length > 8 || !words.every(word => /^[\p{L}][\p{L}'’.-]*$/u.test(word))) continue;
    if (/\b(?:your|our|the|this|order|delivery|tomorrow|today|facility|hospital|clinic|chps|customer|health|center|centre|pickup|collection|dispatch|stock|supplies|items|products)\b/i.test(name)) continue;
    return name;
  }
  return 'N/A';
}

export function locateGeneralSystemOrderer(text: string, customerOrdererName: string, fields = parseGeneralMetadata(text)) {
  // A named orderer field or phrase takes precedence over incidental mentions
  // (for example, a different contact in the footer).
  const labelled = extractMetadata(fields, ORDERER_LABELS);
  if (labelled !== 'N/A') return labelled;
  const sentenceName = extractSentenceOrderer(text);
  if (sentenceName !== 'N/A') return sentenceName;
  return findCurrentOrdererMention(text, customerOrdererName);
}

function hasFacilityType(value: string) {
  return /\b(?:chps|health center|hospital|clinic|polyclinic|medical center|health post)(?: compound)?$/.test(formatGeneralFacility(value));
}

/** Formatting aliases and approved suffix differences are checked on complete words. */
function findCurrentFacilityMention(text: string, customerFacilityName: string) {
  if (customerFacilityName === 'N/A') return 'N/A';
  const expected = normalizeGeneralFacility(customerFacilityName);
  if (!expected) return 'N/A';
  for (const line of text.split(/\r?\n/)) {
    if (/^(?:district|delivery\s*\/\s*drop area|delivery drop area|drop area|delivery area)\s*:/i.test(line.trim())) continue;
    const words = [...line.matchAll(/[\p{L}\p{N}]+/gu)];
    const maxWords = normalizeAuditText(customerFacilityName).split(' ').length + 5;
    for (let start = 0; start < words.length; start++) {
      let matched = '';
      for (let size = 1; size <= maxWords && start + size <= words.length; size++) {
        const endWord = words[start + size - 1];
        const candidate = line.slice(words[start].index!, endWord.index! + endWord[0].length);
        if (normalizeGeneralFacility(candidate) === expected && (hasFacilityType(candidate) || !hasFacilityType(customerFacilityName))) matched = candidate;
      }
      if (matched) return matched;
    }
  }
  return 'N/A';
}

function extractSentenceFacility(text: string, customerFacilityName = 'N/A') {
  for (const originalLine of text.split(/\r?\n/)) {
    const line = stripGeneralListPrefix(originalLine);
    const prefix = line.match(/\b(?:delivery\s+to|deliver\s+to|order\s+received\s+for|(?:we\s+have\s+)?received\s+your\s+order\s+for|order\s+for|destination\s*:)\s+(.+)$/i);
    const suffix = line.match(/^(.+?)\s+order\s+received\b/i);
    const greeting = line.match(/\b(?:thank\s+you|thanks\s+to|dear)\s+.+?\s+(?:from|at)\s+(.+)$/i);
    let candidate = greeting?.[1] ?? prefix?.[1] ?? suffix?.[1];
    if (!candidate) continue;
    candidate = candidate.replace(/^(?:delivery\s+to|deliver\s+to)\s+/i, '');
    // In “order for Isaac Awuyem at Gbimsi CHPS”, only the destination is a facility.
    candidate = candidate.split(/\s+at\s+/i).at(-1)!;
    const name = candidate.split(/\.{2,}|[,;!?]|\.(?=\s|$)|\s+(?:from|with|via|on|by|for)\s+/i)[0].trim();
    const knownBareFacility = customerFacilityName !== 'N/A' && normalizeGeneralFacility(name) === normalizeGeneralFacility(customerFacilityName);
    if ((hasFacilityType(name) || knownBareFacility || greeting && /^[\p{L}][\p{L}\s'’.-]*$/u.test(name)) && /[a-z]/i.test(name) && !/\b(?:your|our|this|order|delivery|tomorrow|today)\b/i.test(name)) return name;
  }
  return 'N/A';
}

export function locateGeneralSystemFacility(text: string, customerFacilityName: string, fields = parseGeneralMetadata(text)) {
  const labelled = extractMetadata(fields, [...FACILITY_LABELS, 'delivery facility', 'delivery site']);
  if (labelled !== 'N/A') return labelled;
  for (const label of SYSTEM_FACILITY_LABELS) {
    const destination = extractMetadata(fields, [label]);
    if (destination !== 'N/A' && (hasFacilityType(destination) ||
      (customerFacilityName !== 'N/A' && normalizeGeneralFacility(destination) === normalizeGeneralFacility(customerFacilityName)))) return destination;
  }
  const sentenceFacility = extractSentenceFacility(text, customerFacilityName);
  if (sentenceFacility !== 'N/A') return sentenceFacility;
  return findCurrentFacilityMention(text, customerFacilityName);
}

export function runGeneralAuditor(customerRequest: string, fulfillmentConfirmation: string, orderLimitDecisions: Record<string, boolean> = {}, support: GeneralAuditSupport = {}) {
  traceGeneralAudit('rawInputs', { customerRequestRaw: customerRequest, fulfillmentRaw: fulfillmentConfirmation });
  const customerIdentity = extractGeneralIdentity(customerRequest, 'customer_request');
  const systemIdentity = extractGeneralIdentity(fulfillmentConfirmation, 'fulfillment_confirmation', customerIdentity.ordererName, customerIdentity.facilityName);
  const ordererName = compareGeneralField(customerIdentity.ordererName, systemIdentity.ordererName, generalOrdererNamesMatch);
  const facilityName = compareGeneralField(customerIdentity.facilityName, systemIdentity.facilityName,
    (left, right) => normalizeGeneralFacility(left) === normalizeGeneralFacility(right));
  const phone = compareGeneralField(customerIdentity.phone, systemIdentity.phone,
    (left, right) => normalizeGeneralPhone(left) === normalizeGeneralPhone(right));
  const customerExtraction = { ...customerIdentity, products: parseGeneralProducts(customerRequest, 'customer_request') };
  const systemExtraction = { ...systemIdentity, products: parseGeneralProducts(fulfillmentConfirmation, 'fulfillment_confirmation') };
  traceGeneralAudit('parsedInputs', { parsedCustomerRequest: customerExtraction, parsedSystemEntry: systemExtraction });
  // Never silently omit an explicitly listed product with an unreadable quantity.
  for (const [text, source] of [[customerRequest, 'customer_request'], [fulfillmentConfirmation, 'fulfillment_confirmation']] as const) {
    const extraction = source === 'customer_request' ? customerExtraction : systemExtraction;
    const parsedLines = new Set(extraction.products.map(product => product.line));
    text.split(/\r?\n/).forEach((line, index) => {
      const listed = line.trim().match(/^(?:(?:[-*•]\s*|\d+(?:\.(?!\d)|\))\s*|\d+\s+[-–—]\s*))+(.+)$/);
      const headerProse = listed && source === 'fulfillment_confirmation' &&
        (GENERAL_STOCK_SECTION.test(listed[1]) || GENERAL_AVAILABLE_SECTION.test(listed[1]) || extractSentenceOrderer(listed[1]) !== 'N/A' || findCurrentOrdererMention(listed[1], customerExtraction.ordererName) !== 'N/A' ||
          extractSentenceFacility(listed[1], customerIdentity.facilityName) !== 'N/A' || findCurrentFacilityMention(listed[1], customerExtraction.facilityName) !== 'N/A');
      if (listed && !headerProse && /[a-z]/i.test(listed[1]) && !isMetadataLabel(listed[1].split(':')[0]) && !parsedLines.has(index + 1)) {
        throw new Error(`Unable to read the product quantity in ${source === 'customer_request' ? 'Customer Request' : 'System Entry'} line ${index + 1}: ${line.trim()}. Use “Product - 5” or “Product [5/5]”.`);
      }
    });
  }
  const ambiguity = new Map<string, GeneralSemanticReview>();
  const productContext = [...customerExtraction.products, ...systemExtraction.products].map(product => product.name).join('\n');
  for (const product of [...customerExtraction.products, ...systemExtraction.products]) {
    const reason = getGeneralMedicalAmbiguity(product.name, productContext);
    if (reason && !ambiguity.has(product.normalizedName)) ambiguity.set(product.normalizedName,
      { originalText: product.originalText, source: product.source, possibleMatches: [], reason: `${reason} Verify before dispatch.` });
  }
  const items = compareExtractedGeneralProducts(customerExtraction.products, systemExtraction.products, orderLimitDecisions, support)
    .filter(item => !item.provenance.some(product => ambiguity.has(product.normalizedName)));
  if (!items.length && !ambiguity.size && !support.allowEmptyProductsForReview) {
    throw new Error('No explicit product quantities could be read from one of the current inputs. Use “Product - 5” or “Product [5/5]” and try again.');
  }
  // Keep the response shape compatible; facility, orderer and available phone numbers are audited headers.
  const customerFields = parseGeneralMetadata(customerRequest);
  const systemFields = parseGeneralMetadata(fulfillmentConfirmation);
  const unauditedField = (labels: string[]) => ({
    whatsappValue: extractMetadata(customerFields, labels),
    fulfillmentValue: extractMetadata(systemFields, labels),
    status: 'match' as const
  });
  const meta = {
    customerName: ordererName, ordererName, facility: facilityName, facilityName,
    phone,
    date: { whatsappValue: 'N/A', fulfillmentValue: 'N/A', status: 'match' },
    dropArea: unauditedField(['delivery drop area', 'drop area', 'delivery area']),
    district: unauditedField(['district']),
    deliveryTime: unauditedField(['delivery time', 'preferred time for delivery'])
  };
  const requestedCount = groupProducts(customerExtraction.products).size;
  // Unrequested zero-supply records are informational, not extra products.
  const systemCount = groupProducts(systemExtraction.products.filter(product =>
    product.quantity > 0 || customerExtraction.products.some(requested => requested.normalizedName === product.normalizedName))).size;
  const generalAuditResult = { meta,
    ...summarizeGeneralProducts(items, facilityName, ordererName, phone, requestedCount, systemCount, [...ambiguity.values()]) };
  traceGeneralAudit('comparison', { generalAuditResult });
  return generalAuditResult;
}

/** Score only validations performed by the final General audit, never AI certainty. */
export function buildGeneralAuditCheckSummary(items: { status: string; requested: string }[], facility: GeneralFieldResult, orderer: GeneralFieldResult, phone: GeneralFieldResult, discrepancyCount: number): GeneralAuditCheckSummary {
  let passedChecks = 0, failedChecks = 0;
  for (const field of [orderer, facility]) {
    if (field.status === 'match') passedChecks++;
    else if (field.status === 'mismatch' || field.status === 'not available in system entry') failedChecks++;
  }
  // Phone is optional, but when both sides supply it its comparison is audited.
  if (phone.status === 'mismatch') failedChecks++;
  else if (phone.status === 'match' && phone.whatsappValue !== 'N/A' && phone.fulfillmentValue !== 'N/A') passedChecks++;
  for (const item of items) {
    if (item.status === 'missing item' || item.status === 'extra item') {
      failedChecks++; // No second quantity check when there is no paired product.
    } else if (item.status === 'quantity mismatch') {
      passedChecks++; // Paired identity.
      failedChecks++; // Quantity validation only.
    } else if (item.status === 'match' || item.status === 'order limit applied' || item.status === 'out of stock') {
      if (item.status === 'out of stock' && item.requested === 'None') continue; // Unrequested zero supply is informational.
      passedChecks += 2; // Identity plus correct quantity/valid operational condition.
    } else if (item.status === 'pending order limit') {
      passedChecks++; // Identity is known; quantity validation has not been completed.
    }
  }
  const totalChecks = passedChecks + failedChecks;
  const rounded = totalChecks ? Math.round(passedChecks / totalChecks * 100) : 0;
  // Rounding a large audit must never turn a real failed check into a 100% match.
  const confidence = discrepancyCount > 0 || failedChecks > 0 ? Math.min(99, rounded) : rounded;
  return { totalChecks, passedChecks, failedChecks, discrepancyCount, confidence };
}

/** Rebuild every product-derived total while retaining authoritative header checks. */
export function summarizeGeneralProducts(items: GeneralComparisonItem[], facilityName: GeneralFieldResult, ordererName: GeneralFieldResult, phone: GeneralFieldResult, requestedCount: number, systemCount: number, semanticReviews: GeneralSemanticReview[] = []) {
  const metadataIssues = [
    ordererName.status === 'mismatch' ? 'Orderer Name Mismatch' : ordererName.status === 'not available in system entry' ? 'Orderer Name Not Found' : '',
    facilityName.status === 'mismatch' ? 'Facility Name Mismatch' : facilityName.status === 'not available in system entry' ? 'Facility Not Found' : '',
    phone.status === 'mismatch' ? 'Phone Number Mismatch' : ''
  ].filter(Boolean);
  metadataIssues.push(...semanticReviews.map(review => `Ambiguous Product — ${generalProductDisplayName(review.originalText)}`));
  // Counts remain visible; missing/extra products already contribute one issue
  // each, so a count difference must not count the same problem again.
  const discrepancies = [...metadataIssues, ...items.filter(item => item.fulfillment.fulfillmentStatus === 'discrepancy').map(item =>
    item.status === 'quantity mismatch' ? `${item.name} quantity mismatch: requested ${item.requested}, entered ${item.found}, difference ${item.difference}` :
    item.status === 'missing item' ? `${item.name} missing from System Entry` : `${item.name} extra in System Entry`)];
  const pendingOrderLimitCount = items.filter(item => item.fulfillment.fulfillmentStatus === 'pending order limit').length;
  const limitedCount = items.filter(item => item.fulfillment.fulfillmentStatus === 'order limit applied').length;
  const stockCount = items.filter(item => item.status === 'out of stock').length;
  const requestedStockCount = items.filter(item => item.status === 'out of stock' && item.provenance.some(product => product.source === 'customer_request')).length;
  const stockStatus: GeneralAuditDetails['stockStatus'] = requestedStockCount === 0 ? 'in stock' : requestedStockCount === requestedCount ? 'out of stock' : 'partially out of stock';
  const summary = calculateGeneralAuditSummary(items.filter(item => item.fulfillment.fulfillmentStatus !== 'pending order limit'), metadataIssues);
  const auditSummary = buildGeneralAuditCheckSummary(items, facilityName, ordererName, phone, summary.issueCount);
  auditSummary.failedChecks += semanticReviews.length;
  auditSummary.totalChecks += semanticReviews.length;
  auditSummary.confidence = auditSummary.totalChecks ? Math.round(auditSummary.passedChecks / auditSummary.totalChecks * 100) : 0;
  if (summary.issueCount) auditSummary.confidence = Math.min(99, auditSummary.confidence);
  const allMatch = summary.allMatch && pendingOrderLimitCount === 0;
  const finalStatus = summary.issueCount > 0 ? 'DISCREPANCY DETECTED' : pendingOrderLimitCount > 0 ? 'ORDER LIMIT VALIDATION REQUIRED' :
    limitedCount && requestedStockCount ? 'PARTIALLY FULFILLED — CONFIRMED' : limitedCount ? 'ORDER LIMIT APPLIED — CONFIRMED' :
    stockStatus === 'out of stock' ? 'OUT OF STOCK — CONFIRMED' : stockStatus === 'partially out of stock' ? 'PARTIALLY OUT OF STOCK — CONFIRMED' : 'CONFIRMED — NO DISCREPANCY';
  const confirmedDecisions = Object.fromEntries(items.filter(item => item.fulfillment.orderLimitDecision !== undefined).map(item => [item.fulfillment.key, item.fulfillment.orderLimitDecision!]));
  const message = summary.issueCount > 0 ? `${summary.issueCount} discrepanc${summary.issueCount === 1 ? 'y' : 'ies'} found — review before dispatch.${requestedStockCount ? ` ${requestedStockCount} requested product${requestedStockCount === 1 ? ' is' : 's are'} currently out of stock.` : ''}` :
    requestedStockCount && limitedCount ? `Order matches, with ${requestedStockCount} product${requestedStockCount === 1 ? '' : 's'} currently out of stock and some requested quantities affected by an order limit.` :
    requestedStockCount ? `Order matches, with ${requestedStockCount} product${requestedStockCount === 1 ? '' : 's'} currently out of stock.` :
    limitedCount ? 'Order matches, but some requested quantities were affected by an order limit.' : 'All audit checks passed — ready for dispatch.';
  const warnings = [
    ordererName.status !== 'match' && ordererName.status !== 'mismatch' ? 'ORDERER NAME NOT FOUND' : '',
    facilityName.status !== 'match' && facilityName.status !== 'mismatch' ? 'FACILITY NOT FOUND' : ''
  ].filter(Boolean);
  const generalAudit: GeneralAuditDetails = { facility: facilityName, orderer: ordererName, phone,
    message, warnings, auditSummary, ...(semanticReviews.length ? { semanticReviews } : {}),
    productCount: { requested: requestedCount, found: systemCount, status: requestedCount === systemCount ? 'match' : 'mismatch' }, discrepancies,
    counts: { fullySupplied: items.filter(item => item.fulfillment.fulfillmentStatus === 'fully supplied').length, outOfStock: stockCount, orderLimited: limitedCount, pendingOrderLimits: pendingOrderLimitCount },
    products: items.map(item => item.fulfillment), orderLimitDecisions: confirmedDecisions, pendingOrderLimitCount, stockStatus, finalStatus };
  return { items, generalAudit, ...summary, allMatch, auditSummary, confidence: auditSummary.confidence,
    verdict: summary.issueCount > 0 ? 'DISCREPANCY' : pendingOrderLimitCount ? 'ORDER LIMIT VALIDATION REQUIRED' : 'NO DISCREPANCY', insights: discrepancies };
}

/** Apply a user's answer immediately without reinterpreting products or headers. */
export function applyGeneralOrderLimitDecision<T extends ReturnType<typeof runGeneralAuditor>>(result: T, key: string, answer: boolean) {
  const target = result.items.find(item => item.fulfillment.key === key);
  if (!target?.fulfillment.orderLimitEligible) return result;
  const items = result.items.map((item): GeneralComparisonItem => {
    if (item !== target) return item;
    const status = answer ? 'order limit applied' : 'quantity mismatch';
    return { ...item, status,
      action: answer ? `${item.name} could not be fully fulfilled because the applicable order limit was reached.`
        : getGeneralAuditorAction(status, item.name, item.requested),
      fulfillment: { ...item.fulfillment, orderLimitDecision: answer,
        fulfillmentStatus: answer ? 'order limit applied' : 'discrepancy' } };
  });
  const details = result.generalAudit;
  return { ...result, ...summarizeGeneralProducts(items, details.facility, details.orderer, details.phone,
    details.productCount.requested, details.productCount.found, details.semanticReviews) };
}

/** Original identity mismatches cannot be waived by semantic interpretation or a server response. */
export function enforceGeneralIdentityMatches<T extends ReturnType<typeof runGeneralAuditor>>(result: T, customer: string, fulfillment: string) {
  const requested = extractGeneralIdentity(customer, 'customer_request');
  const supplied = extractGeneralIdentity(fulfillment, 'fulfillment_confirmation', requested.ordererName, requested.facilityName);
  const original = {
    orderer: compareGeneralField(requested.ordererName, supplied.ordererName, generalOrdererNamesMatch),
    facility: compareGeneralField(requested.facilityName, supplied.facilityName,
      (left, right) => normalizeGeneralFacility(left) === normalizeGeneralFacility(right))
  };
  const details = { ...result.generalAudit };
  let changed = false;
  for (const key of ['facility', 'orderer'] as const) {
    // Preserve a semantic extraction only when its name is actually present in
    // the fulfillment text. Missing fields cannot be invented to produce a pass.
    if (original[key].status === 'not available in system entry') {
      const value = details[key].fulfillmentValue;
      if (value !== 'N/A' && (` ${normalizeAuditText(fulfillment)} `).includes(` ${normalizeAuditText(value)} `)) {
        original[key] = compareGeneralField(original[key].whatsappValue, value,
          key === 'orderer' ? generalOrdererNamesMatch : (left, right) => normalizeGeneralFacility(left) === normalizeGeneralFacility(right));
      }
    }
    if (original[key].status !== 'missing from customer request' && (details[key].status !== original[key].status ||
      details[key].whatsappValue !== original[key].whatsappValue || details[key].fulfillmentValue !== original[key].fulfillmentValue)) {
      details[key] = original[key];
      changed = true;
    }
  }
  const nameMismatchCount = [details.facility, details.orderer].filter(field => field.status === 'mismatch' || field.status === 'not available in system entry').length;
  if (!changed && (!nameMismatchCount || !result.allMatch && result.issueCount >= nameMismatchCount)) return result;
  const meta = changed ? { ...result.meta, facility: details.facility, facilityName: details.facility,
    customerName: details.orderer, ordererName: details.orderer } : result.meta;
  return { ...result, meta, ...summarizeGeneralProducts(result.items, details.facility, details.orderer, details.phone,
    details.productCount.requested, details.productCount.found, details.semanticReviews) };
}
