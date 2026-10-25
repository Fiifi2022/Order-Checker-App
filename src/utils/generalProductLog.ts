import { catalogProductNames, type CatalogProduct } from '../../shared/productCatalog';
import { generalClinicalAttributes, matchGeneralClinicalProducts } from './generalProductMatching';

// Reference the existing Product Log; never create another product store.
let products: readonly CatalogProduct[] | undefined;
let cache = new Map<string, boolean>();
let normalizer: ((name: string) => string) | undefined;
let names: { product: CatalogProduct; values: string[] }[] = [];
let exactNames = new Map<string, Set<string>>();
let writtenNames = new Map<string, CatalogProduct[]>();
type LogNameResolution = { product: CatalogProduct; canonicalName: string; conflict: boolean; canNormalize: boolean };
const resolvedNames = new Map<string, LogNameResolution | undefined>();
const cleanLabel = (name: string) => name.replace(/\s*\[\s*\d+\s*\]\s*$/, '').replace(/\bin\s+(?=\d+(?:\.\d+)?\s*(?:ml|l)\b)/gi, '');
const writtenNormalization = (name: string) => cleanLabel(name).normalize('NFKD').toLowerCase()
  .replace(/\b(?:inj|injections)\b/g, 'injection').replace(/\b(?:tabs?|tablets)\b/g, 'tablet')
  .replace(/\b(?:caps?|capsules)\b/g, 'capsule').replace(/\b(?:syr|syrups)\b/g, 'syrup')
  .replace(/(\d)\s+(mg|mcg|g|ml|l|iu)\b/g, '$1$2').replace(/\s*\/\s*/g, '/')
  .replace(/[^a-z0-9./+−-]+/g, ' ').replace(/\.(?!\d)|(?<!\d)\./g, ' ').replace(/\s+/g, ' ').trim();
const writtenKey = (name: string) => {
  const value = writtenNormalization(name);
  const measurements = value.match(/\b\d+(?:\.\d+)?(?:mcg|mg|g|ml|l|miu|iu)(?:\/(?:\d+(?:\.\d+)?)?(?:mcg|mg|g|ml|l|miu|iu))?\b/g) || [];
  return `${[...new Set(value.split(' '))].sort().join(' ')}|${measurements.join(' ')}`;
};
/** Whole saved labels win over substring expansion; explicit clinical conflicts stay visible. */
export function resolveGeneralProductLogName(name: string): LogNameResolution | undefined {
  if (resolvedNames.has(name)) return resolvedNames.get(name);
  if (resolvedNames.size >= 4096) resolvedNames.clear();
  const candidates = writtenNames.get(writtenKey(name)) || [];
  if (!candidates.length || new Set(candidates.map(product => writtenKey(product.name))).size !== 1) { resolvedNames.set(name, undefined); return undefined; }
  const product = candidates[0], canonicalName = cleanLabel(product.name);
  const source = generalClinicalAttributes(name, writtenNormalization), target = generalClinicalAttributes(canonicalName, writtenNormalization);
  const concentration = target.measurements.map(value => value.match(/^(\d+(?:\.\d+)?)mg\/ml$/)).filter(Boolean);
  const volume = target.measurements.map(value => value.match(/^(\d+(?:\.\d+)?)ml$/)).filter(Boolean);
  const totalAmount = concentration.length === 1 && volume.length === 1
    ? `${Number((Number(concentration[0]![1]) * Number(volume[0]![1])).toPrecision(12))}mg` : undefined;
  const conflict = (['measurements', 'forms', 'routes', 'releases', 'qualifiers'] as const).some(field =>
    source[field].length > 0 && target[field].length > 0 && source[field].some(value => !target[field].includes(value) && !(field === 'measurements' && value === totalAmount)));
  const omittedSourceDetail = (['forms', 'routes', 'releases', 'qualifiers'] as const).some(field => source[field].some(value => !target[field].includes(value)));
  const resolved = { product, canonicalName, conflict, canNormalize: !conflict && !omittedSourceDetail };
  resolvedNames.set(name, resolved);
  return resolved;
}
const normalizedNames = new Map<string, string>();
const memoNormalize = (name: string) => {
  let result = normalizedNames.get(name);
  if (result === undefined) {
    result = normalizer!(name);
    if (normalizedNames.size >= 4096) normalizedNames.clear();
    normalizedNames.set(name, result);
  }
  return result;
};
export const getGeneralProductLog = () => products;
export function setGeneralProductLog(value: CatalogProduct[]) {
  products = value;
  names = value.map(product => ({ product, values: catalogProductNames(product).filter(name =>
    !product.contextualAliases.some(alias => alias.toLowerCase() === name.toLowerCase())) }));
  cache = new Map();
  normalizer = undefined;
  exactNames.clear(); normalizedNames.clear();
  writtenNames = new Map();
  resolvedNames.clear();
  // Ordinary clinical aliases already use the established terminology engine.
  // Pack-labelled entries need a whole-label mapping so their stock pack count
  // cannot be inserted into a medicine's identity by a substring replacement.
  for (const row of names.filter(row => row.product.scope === 'general' && row.product.aliases.length > 0 && /\[\s*\d+\s*\]\s*$/.test(row.product.name))) for (const value of row.values) {
    const key = writtenKey(value);
    writtenNames.set(key, [...(writtenNames.get(key) || []), row.product]);
  }
}
/** Recognition only: the auditor still compares full strengths, forms and quantities. */
export function isGeneralProductLogMatch(name: string, normalize: (name: string) => string) {
  if (!products) return false;
  if (normalizer !== normalize) {
    normalizer = normalize; cache.clear(); normalizedNames.clear(); exactNames = new Map();
    for (const row of names) for (const value of row.values) {
      const key = memoNormalize(value);
      if (!exactNames.has(key)) exactNames.set(key, new Set());
      exactNames.get(key)!.add(memoNormalize(row.product.name));
    }
  }
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const exact = exactNames.get(memoNormalize(name));
  const candidates = exact || new Set(names.filter(row => row.values.some(value =>
    matchGeneralClinicalProducts(name, value, memoNormalize).confident)).map(row => memoNormalize(row.product.name)));
  // Equivalent legacy entries may share a name across the two checker scopes.
  const matched = candidates.size === 1;
  if (cache.size >= 1024) cache.clear();
  cache.set(name, matched);
  return matched;
}
