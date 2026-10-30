import { recognizeGeneralDocument } from '../src/utils/generalDocumentStructure';
import { isGeneralKnownProductDescription } from '../src/utils/generalProductMatching';
import { CLINICAL_PAIRINGS } from '../shared/vaccinePairing';
import { getCatalogRevision } from '../shared/productCatalog';
import { isGeneralProductLogMatch } from '../src/utils/generalProductLog';
import { getGeneralVaccineCatalogVersion } from '../shared/generalVaccineCatalog';
import { Type } from '@google/genai';
import { extractGeneralInput, parseGeneralProducts, normalizeGeneralProductName, stripGeneralListPrefix, isMetadataLabel, type GeneralProductSource } from './generalAuditor';
import { findGeneralFacilityNames, normalizeGeneralFacilityName, type GeneralFacilityContext } from '../src/utils/generalFacility';
import { classifyGeneralText, stripGeneralNonOrderInformation } from '../src/utils/generalTextClassification';
import { medicalProductAcronyms } from '../src/utils/medicalProductAcronyms';
import { getGeneralTerminologyAliases, generalApprovedProductIdentities, resolveGeneralApprovedIdentity, getGeneralMedicalAmbiguity, stripGeneralLeadingSpecification } from '../src/utils/generalMedicalTerminology';
import packaging from '../src/utils/generalPackagingCatalogue.json';
import { projectGeneralOrderSentences } from '../src/utils/generalSentenceExtraction';

export interface StructuredGeneralOrder {
  facilityName: string | null;
  ordererName: string | null;
  products: { name: string; quantity: number | null; unit: string | null }[];
  deliveryArea: string | null;
  district: string | null;
  unresolvedFields: string[];
  extractionConfidence: number;
}
export interface DeterministicGeneralOrder {
  text: string;
  changed: boolean;
  order: StructuredGeneralOrder;
  unresolvedText: string[];
  conflictingFields?: string[];
  missingQuantityProducts?: string[];
}
const numberWords: Record<string, number> = Object.fromEntries('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ').map((word, n) => [word, n]));
const unit = '(?:vials?|box(?:es)?|packs?|blisters?|strips?|doses?|units?|bottles?|tablets?|capsules?|sachets?|tests?|pieces?)';
const quantityOnly = new RegExp(`^(?:(?:quantity|qty|amount)\\s*[:=]?\\s*)?(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*(${unit})?\\s*[.!]?$`, 'i');
const clinical = /^(?:patient(?:\s+(?:name|age|sex|gender))?\s*[:;=]|(?:age|sex|gender|diagnosis|clinical\s+(?:condition|history)|condition|bsct|wbct|hb|bp|pulse|temperature)\b|(?:a\s+)?\d+\s*[- ]?(?:years?\s*[- ]?old|y\/?o)\b)/i;
const request = /\b(?:need|request|send|supply|order|quantity|qty|vials?|vails?|packs?|boxes?|doses?)\b/i;
const label = '(?:name of orderer|orderer name|ordered by|requested by|orderer|name of health facility|health facility|facility name|name of facility|facility|hospital|delivery\\s*\\/\\s*drop area|delivery drop area|delivery area|drop area|district(?: name)?|product|item|vaccine|medicine|drug|quantity|qty|amount)';
const labelBoundary = new RegExp(`(^|[;\\n]|[.!?]\\s+|\\s+(?=${label}\\s*[:;=]))(${label})\\s*[:;=]\\s*`, 'gi');
const lexicon = () => [...new Set([
  ...Object.entries(CLINICAL_PAIRINGS).flatMap(([name, pairing]) => [name, pairing.accessoryCanonical]),
  ...packaging.map(row => row.name), ...medicalProductAcronyms.flatMap(row => [row.name, ...row.aliases]),
  ...getGeneralTerminologyAliases().flatMap(row => [row.name, ...row.aliases]),
  ...generalApprovedProductIdentities.flatMap(row => [row.canonicalName, ...row.aliases]),
])];
let cachedVocabulary: { version: string; entries: string[]; normalized: Set<string> } | undefined;
function currentVocabulary() {
  const version = `${getCatalogRevision()}:${getGeneralVaccineCatalogVersion()}`;
  if (!cachedVocabulary || cachedVocabulary.version !== version) {
    const entries = lexicon();
    cachedVocabulary = { version, entries, normalized: new Set(entries.map(normalizeGeneralProductName)) };
  }
  return cachedVocabulary;
}
function cleanRequest(line: string) {
  return line.replace(/^[,;.!\s]+/, '').replace(/^and\s+(?=(?:we|i|please|pls|send|supply)\b)/i, '').replace(/^(?:(?:hi|hello)(?:\s+zipline)?[,.! ]*\s*)/i, '')
    .replace(/^(?:can|could|would)\s+you\s+(?:(?:please|kindly)\s+)?(?=send|supply|give)/i, '')
    .replace(/^(?:(?:please|pls|kindly)[, ]*\s*)?(?:(?:we|i)\s+(?:also\s+)?(?:urgently\s+)?(?:need|want|require|request|would like(?:\s+to\s+(?:order|request))?)|(?:send|give|supply)(?:\s+(?:us|me))?)\s+/i, '')
    .replace(/^(?:products?|items?|vaccines?|medicines?|drugs?)\s*[:=]\s*/i, '')
    .replace(/\s+(?:for\s+(?:continuous\s+)?(?:case\s+management|a\s+patient|the\s+patient)|because\b).*$/i, '')
    .replace(/\s+(?:please|thanks|thank you)[.!]?$/i, '').trim();
}
/** Deliberately bounded spelling corrections: medicine identities are never fuzzy substituted. */
export function normalizeGeneralQuantityText(text: string) {
  return text.replace(/\b(?:vails?|vialls?|vilas?)\b/gi, 'vials')
    .replace(/\b(?:boxs|boxe|boex|bxs)\b/gi, 'boxes')
    .replace(/\b(?:paks?|pakcs|pacsk)\b/gi, 'packs')
    .replace(/\b(?:dozes|dosses|dosess)\b/gi, 'doses')
    .replace(/(\d)(?=(?:vails?|vialls?|vilas?|boxs|boxe|boex|bxs|paks?|pakcs|pacsk|dozes|dosses|dosess)\b)/gi, '$1 ')
    .replace(new RegExp(`\\b(${Object.keys(numberWords).join('|')})\\s+(?=${unit}\\b)`, 'gi'), word => `${numberWords[word.trim().toLowerCase()]} `)
    .replace(new RegExp(`\\b(quantity|qty|amount)\\s*[:=]?\\s*(${Object.keys(numberWords).join('|')})\\b`, 'gi'), (_, field, word) => `${field}: ${numberWords[word.toLowerCase()]}`);
}
/** Clinical data is discarded before either extraction or optional model use. */
export function redactGeneralClinicalText(text: string) {
  return text.split(/\r?\n/).map(line => {
    if (clinical.test(line.trim()) && !request.test(line)) return '';
    return line.replace(/\bpatient(?:\s+name)?\s*[:=]\s*[^,;\n.!]+/gi, '[patient redacted]')
      .replace(/\b(?:\d{1,3}\s*[- ]?(?:years?\s*[- ]?old|y\/?o)|(?:age|sex|gender)\s*[:=]\s*[^,;\n.!]+|(?:bsct|wbct)\s*(?:is|of|[:=])?\s*[<>]?\s*\d+(?:\.\d+)?\s*(?:minutes?|mins?)?)/gi, '[clinical detail redacted]')
      .replace(/(?:\+?233|00233|0)(?:[ ().-]*\d){9}\b/g, '[contact redacted]');
  }).join('\n');
}

export function extractGeneralOrderDeterministically(raw: string, source: GeneralProductSource, context: GeneralFacilityContext = {}, reference?: StructuredGeneralOrder, explicitProductNames: string[] = []): DeterministicGeneralOrder {
  const { entries, normalized: vocabulary } = currentVocabulary();
  const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const explicitNames = new Set(explicitProductNames.map(normalizeGeneralProductName));
  // Specifications can precede the catalogue label as well as follow it.
  // Remove them only for recognition; the original specification reaches comparison.
  const knownName = (name: string) => isGeneralProductLogMatch(name, normalizeGeneralProductName) || isGeneralKnownProductDescription(name, normalizeGeneralProductName) || explicitNames.has(normalizeGeneralProductName(name)) || vocabulary.has(normalizeGeneralProductName(name)) ||
    vocabulary.has(normalizeGeneralProductName(stripGeneralLeadingSpecification(name))) || entries.some(entry => {
    const candidate = plain(name), base = plain(entry);
    if (!candidate.startsWith(base + ' ')) return false;
    const suffix = candidate.slice(base.length).replace(/(?<![a-z])(?:mcg|mg|g|ml|l|miu|iu|units?|adult|paediatric|pediatric|oral|iv|im|sc|syrup|suspension|tablets?|capsules?|injection|infusion|solution|cream|ointment|gel|powder|bottles?)(?![a-z])/gi, '');
    return /^[\d\s]*$/.test(suffix);
  });
  const projected = projectGeneralOrderSentences(stripGeneralNonOrderInformation(raw), context, line => {
    const classification = classifyGeneralText(line);
    return classification.category === 'administrative' || !!classification.orderChange;
  });
  let text = recognizeGeneralDocument(projected, line => ({ category: 'unresolved_order', orderChange: classifyGeneralText(line).orderChange })).auditText.normalize('NFKC').replace(/\u00a0/g, ' ');
  let improved = text !== raw || raw.split('\n').some(line => {
    const labels = [...line.matchAll(new RegExp(`\\b${label}\\s*[:;=]`, 'gi'))];
    return labels.length > 1 || labels.some(match => !match[0].endsWith(':') || /^ordered by/i.test(match[0]));
  });
  text = text.split('\n').map(line => {
    const products = parseGeneralProducts(line, source);
    // A word such as "Vaccine" inside a complete catalogue product name is
    // not a metadata label, even when its quantity follows an equals sign.
    return products.length === 1 && knownName(products[0].name) ? line
      : line.replace(labelBoundary, (_, boundary, field) => `\n${/^ordered by$/i.test(field) ? 'Orderer' : field}: `);
  }).join('\n');
  text = text.split('\n').map(line => line.includes(';') && !classifyGeneralText(line).orderChange && (isMetadataLabel(line.split(':')[0]) && !/^notes\b/i.test(line) || line.split(';').every(part => parseGeneralProducts(part, source).length > 0)) ? line.replace(/;\s*/g, '\n') : line).join('\n');
  text = text.split('\n').map(line => {
    const products = parseGeneralProducts(line, source);
    if (products.length === 1 && knownName(products[0].name)) return line;
    return line.replace(/([.!?])\s+(?=[a-z])/gi, (match, mark, offset, input) => /(?:\b(?:dr|mr|mrs|ms|prof|inj|tab|cap|susp|soln)|\d)$/i.test(input.slice(0, offset)) ? match : `${mark}\n`);
  }).join('\n');
  const prepared = text.split(/\r?\n/).map(line => {
    const plain = line.trim();
    if (clinical.test(plain)) {
      improved = true;
      if (!request.test(plain)) return '';
      return plain.match(/\b(?:(?:please\s+)?(?:we\s+|i\s+)?(?:need|want|request)|send|quantity|qty)\b.*$/i)?.[0] || '';
    }
    if (/^(?:contact|phone|telephone|tel|mobile)(?: number)?\s+[+\d ().-]+$/i.test(plain)) { improved = true; return ''; }
    return plain;
  }).join('\n');
  const output: string[] = [];
  const pending: { index: number; name: string }[] = [];
  const quantities: { index: number; value: string }[] = [];
  for (const rawLine of prepared.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const normalized = normalizeGeneralQuantityText(rawLine);
    // Correct a unit attached to its number before testing the spelling dictionary.
    const line = normalizeGeneralQuantityText(normalized.replace(/(\d)(?=(?:vails?|vialls?|vilas?|boxs|boxe|boex|bxs|paks?|pakcs|pacsk|dozes|dosses|dosess)\b)/gi, '$1 '));
    if (line !== rawLine) improved = true;
    if (/^(?:hi|hello)\s+zipline[.! ,]*$/i.test(line)) continue;
    if (/^ordered by\s*:/i.test(line)) { output.push(line.replace(/^ordered by/i, 'Orderer')); continue; }
    if (isMetadataLabel(line.split(/[:=]/)[0]) && !/^(?:quantity|qty|amount)\b/i.test(line)) { output.push(line.replace(/[.!]+$/, '')); continue; }
    const amount = line.match(quantityOnly);
    if (amount && (/^(?:quantity|qty|amount)\b/i.test(line) || amount[2])) {
      quantities.push({ index: output.length, value: `${amount[1]}${amount[2] ? ` ${amount[2]}` : ''}` });
      output.push(line); continue;
    }
    const clean = cleanRequest(line);
    // Split an inline list only when every segment independently names a known product.
    const parts = clean.split(/\s*,\s*|\s+and\s+/i);
    if (parts.length > 1 && !(parseGeneralProducts(clean, source).length === 1 && knownName(parseGeneralProducts(clean, source)[0].name)) && parts.every(part => {
      const product = parseGeneralProducts(part, source);
      return product.length === 1 && knownName(product[0].name);
    })) { improved = true; output.push(...parts); continue; }
    const parsed = parseGeneralProducts(clean, source);
    if (clean !== line && (parsed.length === 1 && knownName(parsed[0].name) || knownName(clean))) {
      improved = true;
      output.push(clean);
    } else { output.push(line); }
    if (!parsed.length && knownName(clean)) pending.push({ index: output.length - 1, name: clean });
  }
  // Pair nearby labelled products/quantities in sequence; never zip two product lists
  // to an unrelated block of numbers. A single product may span metadata/clinical lines.
  const used = new Set<number>();
  for (const item of pending) {
    // A block of product names followed by a block of quantities has no explicit pairing.
    if (pending.some(other => other.index < item.index && !quantities.some(q => q.index > other.index && q.index < item.index))) continue;
    const candidates = quantities.filter(q => !used.has(q.index) &&
      (q.index === item.index + 1 || q.index === item.index - 1 || pending.length === 1 && quantities.length === 1));
    if (candidates.length !== 1) continue;
    const q = candidates[0];
    if (q.index !== item.index + 1 && pending.some(other => other !== item && other.index === q.index - 1)) continue;
    improved = true;
    output[item.index] = `${item.name} - ${q.value}`;
    output[q.index] = '';
    used.add(q.index);
  }
  text = improved ? output.join('\n') : raw;
  let extracted = extractGeneralInput(text, source, reference?.ordererName || 'N/A', reference?.facilityName || 'N/A');
  if (extracted.facilityName === 'N/A') {
    const names = findGeneralFacilityNames(text, context.records);
    if (names.length === 1) { improved = true; text += `\nFacility: ${names[0]}`; extracted = extractGeneralInput(text, source, reference?.ordererName || 'N/A', reference?.facilityName || 'N/A'); }
  }
  const fields = (pattern: RegExp) => text.match(pattern)?.[1].trim() || null;
  const evidenceByLine = new Map(extracted.products.map(product => [product.line, product]));
  const unresolvedText = text.split('\n').filter((line, index) => {
    if (!line.trim() || classifyGeneralText(line).category === 'administrative') return false;
    if ([extracted.facilityName, extracted.ordererName].some(value => value !== 'N/A' && stripGeneralListPrefix(line) === value)) return false;
    if (isMetadataLabel(line.split(/[:=]/)[0]) && !/^(?:quantity|qty|amount)\b/i.test(line)) return false;
    // Section-derived zero quantities are explicit stock evidence from the whole message.
    const evidence = evidenceByLine.get(index + 1);
    const parsed = evidence ? [evidence] : parseGeneralProducts(line, source);
    if (!parsed.length && classifyGeneralText(line).category === 'mandatory_order') return false;
    if (!parsed.length && (extractGeneralInput(line, source).facilityName !== 'N/A' || extractGeneralInput(line, source).ordererName !== 'N/A')) return false;
    return !parsed.length || parsed.some(product => product.quantityReview || !knownName(product.name) || getGeneralMedicalAmbiguity(product.name));
  });
  const conflictingFields: string[] = [];
  for (const [field, pattern, normalize] of [
    ['ordererName', /^(?:name of orderer|orderer name|ordered by|requested by|orderer)\s*:\s*(.+)$/gim, (value: string) => value.toLowerCase().replace(/^(?:dr|mr|mrs|ms)\.?\s+/, '').replace(/[^a-z]+/g, ' ').trim()],
    ['facilityName', /^(?:name of health facility|health facility|facility name|name of facility|facility|hospital)\s*:\s*(.+)$/gim, normalizeGeneralFacilityName],
  ] as const) {
    const matches = [...text.matchAll(pattern)];
    if (new Set(matches.map(match => normalize(match[1]))).size > 1) {
      conflictingFields.push(field);
      extracted = { ...extracted, [field]: 'N/A' };
      unresolvedText.push(...matches.map(match => match[0]));
    }
  }
  const certainProducts = extracted.products.filter(product => !product.quantityReview && knownName(product.name) && !getGeneralMedicalAmbiguity(product.name));
  const unresolvedFields = [extracted.facilityName === 'N/A' ? 'facilityName' : '', extracted.ordererName === 'N/A' ? 'ordererName' : '', !certainProducts.length || unresolvedText.some(line => !/^(?:name of orderer|orderer|ordered by|requested by|name of health facility|health facility|facility|hospital)\s*:/i.test(line) && !/^(?:signed(?: by)?|duty (?:nurse|officer)(?: is)?|my name is)\b/i.test(line)) ? 'products' : ''].filter(Boolean);
  return { text, changed: improved, unresolvedText, conflictingFields, missingQuantityProducts: pending.filter(item => output[item.index] === item.name && !getGeneralMedicalAmbiguity(item.name) && !extracted.products.some(product => product.normalizedName === normalizeGeneralProductName(item.name) && (product.stockSection || product.stockIndicator))).map(item => item.name), order: {
    facilityName: extracted.facilityName === 'N/A' ? null : extracted.facilityName,
    ordererName: extracted.ordererName === 'N/A' ? null : extracted.ordererName,
    products: certainProducts.map(product => ({ name: resolveGeneralApprovedIdentity(product.name)?.canonicalName || product.name, quantity: product.quantity, unit: product.unit })),
    deliveryArea: fields(/^(?:delivery\s*\/\s*drop area|delivery drop area|drop area|delivery area)\s*:\s*(.+)$/im),
    district: fields(/^district(?: name)?\s*:\s*(.+)$/im),
    unresolvedFields, extractionConfidence: unresolvedFields.length ? 0 : 1,
  } };
}

const nullableText = { type: Type.STRING, nullable: true };
export const structuredGeneralOrderSchema = {
  type: Type.OBJECT,
  properties: {
    facilityName: nullableText, ordererName: nullableText,
    products: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, quantity: { type: Type.NUMBER, nullable: true }, unit: nullableText }, required: ['name', 'quantity', 'unit'] } },
    deliveryArea: nullableText, district: nullableText,
    unresolvedFields: { type: Type.ARRAY, items: { type: Type.STRING } }, extractionConfidence: { type: Type.NUMBER },
  }, required: ['facilityName', 'ordererName', 'products', 'deliveryArea', 'district', 'unresolvedFields', 'extractionConfidence'],
};
export function validateStructuredGeneralOrder(value: unknown): value is StructuredGeneralOrder {
  if (!value || typeof value !== 'object') return false;
  const data = value as StructuredGeneralOrder;
  const text = (value: unknown) => value === null || typeof value === 'string' && value.length <= 400 && !/[\r\n]/.test(value);
  return ['facilityName', 'ordererName', 'deliveryArea', 'district'].every(field => field in data && text(data[field as keyof StructuredGeneralOrder])) &&
    Array.isArray(data.products) && data.products.length <= 100 && data.products.every(product => product && typeof product.name === 'string' && product.name.length > 0 && text(product.name) &&
      (product.quantity === null || typeof product.quantity === 'number' && Number.isFinite(product.quantity) && product.quantity >= 0) && 'unit' in product && text(product.unit)) &&
    Array.isArray(data.unresolvedFields) && data.unresolvedFields.every(field => ['facilityName', 'ordererName', 'products', 'quantity', 'unit', 'deliveryArea', 'district'].includes(field)) &&
    typeof data.extractionConfidence === 'number' && Number.isFinite(data.extractionConfidence) && data.extractionConfidence >= 0 && data.extractionConfidence <= 1;
}
