import {generalVaccineCounterpart} from '../../shared/generalVaccineCatalog';
import { catalogKey, catalogProductNames, type CatalogProduct } from '../../shared/productCatalog';
import { generalClinicalAttributes, matchGeneralClinicalProducts, type GeneralClinicalAttributes } from './generalProductMatching';

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
  .replace(/\b[a-z](?:\.\s*[a-z])+\b(?:\.(?![a-z]))?/g, value => value.replace(/[.\s]/g, ''))
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

export interface GeneralCatalogResolution {
  product?: CatalogProduct;
  normalizedName: string;
  alias?: string;
  source?: 'Exact' | 'Alias' | 'Normalized' | 'AI';
  reason?: string;
  recognized: boolean;
}
const identityLabel = (name: string) => writtenNormalization(name)
  .replace(/\bsusp\b/g, 'suspension').replace(/mls\b/g, 'ml')
  .replace(/\b(?:bottles?|vials?|ampoules?|ampules?|packs?)\b/g, ' ').replace(/\s+/g, ' ').trim();
const identityKey = (name: string) => identityLabel(name).split(/[^a-z0-9./+]+/).filter(Boolean).sort().join(' ');
const identityAttributes = (name: string) => generalClinicalAttributes(name, identityLabel);
/** Permanent learning needs the product's important details in the new wording;
 * a counterpart can resolve this audit without authorizing a broader alias. */
export function canAutomaticallyLearnGeneralAlias(name:string,product:CatalogProduct) {
  const source=identityAttributes(name),target=identityAttributes(product.name);
  const measurements=new Set(source.measurements);
  if(!source.measurements.length && source.forms.length && source.bareNumbers.length===1 && target.measurements.length===1 && /^\d+(?:\.\d+)?mg$/.test(target.measurements[0]) &&
    Number(source.bareNumbers[0])===Number(target.measurements[0].slice(0,-2)))measurements.add(target.measurements[0]);
  if(source.forms.includes('injection')) {
    const ratio=identityLabel(name).match(/\b\d+(?:\.\d+)?(?:mcg|mg|g)\/(\d+(?:\.\d+)?)ml\b/);
    if(ratio && Number(ratio[1])>1)measurements.add(`${Number(ratio[1])}ml`);
  }
  return target.measurements.every(value=>measurements.has(value)) &&
    (['forms','routes','releases','qualifiers'] as const).every(field=>target[field].every(value=>source[field].includes(value)));
}
const measurementKind = (value: string) => value.replace(/[\d.]+/g, '');
/** Explicit details may be omitted, but two stated values of the same kind must agree. */
export function generalCatalogAttributeConflict(a: string, b: string): string | undefined {
  const left = identityAttributes(a), right = identityAttributes(b);
  // In an injection presented as a total amount per ampoule volume, retain
  // that stated volume when the catalogue also specifies the container.
  const injectionVolume=(name:string,attributes:GeneralClinicalAttributes)=>attributes.forms.includes('injection')
    ? identityLabel(name).match(/\b\d+(?:\.\d+)?(?:mcg|mg|g)\/(\d+(?:\.\d+)?)ml\b/) : null;
  for(const [name,source,target] of [[a,left,right],[b,right,left]] as const) {
    const ratio=injectionVolume(name,source),containers=target.measurements.filter(value=>/^\d+(?:\.\d+)?ml$/.test(value));
    if(ratio && Number(ratio[1])>1 && containers.length===1 && Number(ratio[1])!==Number(containers[0].slice(0,-2)))return 'The stated injection presentation volume conflicts with the catalogue.';
  }
  for(const [source,target] of [[left,right],[right,left]]) {
    if(!source.measurements.length && source.forms.length && source.bareNumbers.length===1 && target.measurements.length===1 && /^\d+(?:\.\d+)?mg$/.test(target.measurements[0]) &&
      Number(source.bareNumbers[0])!==Number(target.measurements[0].slice(0,-2))) return 'The stated product strength conflicts with the catalogue.';
  }
  const strengthKinds = (values: string[]) => values.filter(value=>/^(?:[\d.]+)(?:mg|iu)/.test(value)).map(measurementKind);
  const leftStrength = strengthKinds(left.measurements), rightStrength = strengthKinds(right.measurements);
  if(leftStrength.length && rightStrength.length && !leftStrength.some(value=>rightStrength.includes(value))) return 'Explicit strength representations cannot be reconciled using the catalogue.';
  for (const field of ['measurements', 'forms', 'routes', 'releases', 'qualifiers'] as const) {
    const x = left[field], y = right[field];
    if (!x.length || !y.length) continue;
    if (field === 'measurements') {
      for (const value of x) {
        const peers = y.filter(other => measurementKind(other) === measurementKind(value));
        if (peers.length && !peers.includes(value)) return 'Explicit strength, concentration or container size conflicts with the catalogue product.';
      }
    } else if (!x.every(value => y.includes(value))) return `Explicit ${field} conflict with the catalogue product.`;
  }
}
const catalogFamilyKey=(value:string)=>identityAttributes(value).ingredient.split(' ').filter(Boolean).sort().join(' ');
// Every candidate and its medical attributes still constrain fuzzy wording.
function safeNameWord(a:string,b:string) {
  if(a===b)return true;
  if(Math.min(a.length,b.length)<6)return false;
  if(a==='paracet' && b==='paracetamol' || b==='paracet' && a==='paracetamol')return true;
  if(Math.abs(a.length-b.length)>1)return false;
  if(a.length===b.length) {
    const differences=[...a].flatMap((char,index)=>char===b[index]?[]:[index]);
    return differences.length===1 || differences.length===2 && differences[1]===differences[0]+1 && a[differences[0]]===b[differences[1]] && a[differences[1]]===b[differences[0]];
  }
  const shorter=a.length<b.length?a:b,longer=a.length<b.length?b:a;
  return [...longer].some((_,index)=>longer.slice(0,index)+longer.slice(index+1)===shorter);
}
type IndexedCatalogName={product:CatalogProduct;value:string;family:string;canonicalFamily:string;order:number};
let indexedCatalogNames:IndexedCatalogName[]=[];
const contextualCatalogNames=new Map<string,IndexedCatalogName[]>();
const literalCanonicalNames=new Map<string,IndexedCatalogName[]>(),literalCatalogNames=new Map<string,IndexedCatalogName[]>();
const packedCatalogNames=new Map<string,IndexedCatalogName[]>();
const packedCatalogKey=(name:string)=>{
  const pack=name.match(/\[\s*(\d+)\s*\]\s*$/);
  return pack ? `${identityKey(name)}|pack:${Number(pack[1])}` : '';
};
const exactCatalogNames=new Map<string,IndexedCatalogName[]>(),aliasFamilies=new Map<string,IndexedCatalogName[]>(),catalogFamilies=new Map<string,IndexedCatalogName[]>();
function indexCurrentCatalog(current:readonly CatalogProduct[]) {
  indexedCatalogNames=[];contextualCatalogNames.clear();literalCanonicalNames.clear();literalCatalogNames.clear();packedCatalogNames.clear();exactCatalogNames.clear();aliasFamilies.clear();catalogFamilies.clear();
  const add=(map:Map<string,IndexedCatalogName[]>,key:string,row:IndexedCatalogName)=>map.set(key,[...(map.get(key)||[]),row]);
  const generalLabels=new Map<string,Set<string>>();
  for(const product of current.filter(row=>row.scope==='general')) for(const value of catalogProductNames(product)) {
    const key=catalogKey(value),ids=generalLabels.get(key)||new Set<string>();ids.add(product.id);generalLabels.set(key,ids);
  }
  for(const source of current) {
    const counterpart=source.scope==='vaccine'?generalVaccineCounterpart(source,current):undefined;
    for(const value of catalogProductNames(source)) {
      const owners=generalLabels.get(catalogKey(value));
      const product=counterpart && (!owners || [...owners].every(id=>id===counterpart.id)) ? counterpart : source;
      const row={product,value,family:catalogFamilyKey(value),canonicalFamily:catalogFamilyKey(product.name),order:indexedCatalogNames.length};
      if(source.contextualAliases.some(alias=>identityKey(alias)===identityKey(value)) && identityKey(value)!==identityKey(source.name)) {add(contextualCatalogNames,identityKey(value),row);continue;}
      add(literalCatalogNames,catalogKey(value),row);
      const packed=packedCatalogKey(value);if(packed)add(packedCatalogNames,packed,row);
      if(catalogKey(value)===catalogKey(product.name)) add(literalCanonicalNames,catalogKey(value),row);
      indexedCatalogNames.push(row);add(exactCatalogNames,identityKey(value),row);add(aliasFamilies,row.family,row);
      for(const family of new Set([row.family,row.canonicalFamily])) add(catalogFamilies,family,row);
    }
  }
}
/** Resolve against the supplied current Product Catalog, including every approved alias.
 * No second vocabulary, retained snapshot, AI call or quantity inference lives here. */
function resolveCurrentCatalogIdentity(name: string, current: readonly CatalogProduct[], preferredIds: readonly string[] = [], depth = 0): GeneralCatalogResolution {
  const normalizedName = identityKey(name);
  const candidates=indexedCatalogNames;
  let direct=exactCatalogNames.get(normalizedName) || [];
  if(direct.some(row=>row.product.scope==='general')) direct=direct.filter(row=>row.product.scope==='general');
  let expandedAlias: string | undefined;
  const pick = (matches: typeof candidates, directMatch: boolean): GeneralCatalogResolution | undefined => {
    if (!matches.length) return;
    const general = matches.filter(row=>row.product.scope==='general');
    if(general.length) matches=general;
    const ids = new Set(matches.map(row => row.product.id));
    if (ids.size !== 1) return { normalizedName, recognized: true, reason: 'Multiple catalogue product IDs match this description.' };
    const row = matches[0], canonical = identityKey(row.product.name) === normalizedName;
    return { product: row.product, normalizedName, recognized: true, alias: row.value === row.product.name ? expandedAlias : row.value,
      source: directMatch ? canonical ? 'Exact' : 'Alias' : 'Normalized' };
  };
  const contextual=contextualCatalogNames.get(normalizedName)||[];
  // Saved whole names and approved aliases retain their exact product IDs.
  // Broader normalization can discard pack labels or reorder names and must
  // never make an otherwise unique exact catalogue entry ambiguous.
  const literalMatches=literalCatalogNames.get(catalogKey(name)) || [];
  const preferGeneral=literalMatches.some(row=>row.product.scope==='general');
  const literalCanonical=pick((literalCanonicalNames.get(catalogKey(name)) || []).filter(row=>!preferGeneral || row.product.scope==='general'),true);
  if(literalCanonical?.product && literalCanonical.product.scope==='general' && literalCanonical.product.category!=='vaccine' && /^[a-z]{2,5}$/i.test(name)) {
    const vaccineContext=pick([...literalMatches,...contextual].filter(row=>(row.product.scope==='vaccine' || row.product.category==='vaccine') && preferredIds.includes(row.product.id)),true);
    if(vaccineContext?.product)return vaccineContext;
  }
  if(literalCanonical) return literalCanonical;
  const labelKey = catalogKey(name);
  const approvedAliases = literalMatches.filter(row => row.product.aliases.some(alias => catalogKey(alias) === labelKey));
  const displayNames = literalMatches.filter(row => row.product.displayName && catalogKey(row.product.displayName) === labelKey);
  const fulfillmentNames = literalMatches.filter(row => row.product.fulfillmentSystemName && catalogKey(row.product.fulfillmentSystemName) === labelKey);
  const prioritizedLiteral = approvedAliases.length ? approvedAliases : displayNames.length ? displayNames : fulfillmentNames.length ? fulfillmentNames : literalMatches;
  const literalAlias=pick(prioritizedLiteral,true);
  if(literalAlias?.product) return literalAlias;
  if(literalAlias) {
    const preferredLiteral=pick(prioritizedLiteral.filter(row=>preferredIds.includes(row.product.id)),true);
    return preferredLiteral?.product ? preferredLiteral : literalAlias;
  }
  const packed=packedCatalogKey(name);
  if(packed) {
    const packedMatch=pick(packedCatalogNames.get(packed) || [],true);
    if(packedMatch)return packedMatch;
  }
  // A full saved name followed by its approved abbreviation describes one
  // product. Remove a redundant label only when both descriptions independently
  // resolve to the same catalogue ID, preserving explicit clinical conflicts.
  if(depth<3) for (const annotation of [...name.matchAll(/\(([^()]*)\)/g)].slice(0,2)) {
    const outside=(name.slice(0,annotation.index)+' '+name.slice(annotation.index!+annotation[0].length)).replace(/\s+/g,' ').trim();
    if(!outside || !annotation[1].trim())continue;
    const label=resolveCurrentCatalogIdentity(annotation[1].trim(),current,preferredIds,depth+1);
    if(!label.product || label.source==='Normalized')continue;
    const full=resolveCurrentCatalogIdentity(outside,current,preferredIds,depth+1);
    if(full.product?.id===label.product.id) return {...full,normalizedName,source:'Normalized',alias:label.alias || annotation[1].trim()};
  }
  const alternatives=name.split(/\s*[/|]\s*/).filter(Boolean);
  if(depth<3 && alternatives.length>1 && alternatives.length<=4 && alternatives.every(part=>part.length<name.length)) {
    const resolved=alternatives.map(part=>resolveCurrentCatalogIdentity(part,current,preferredIds,depth+1));
    if(resolved.every(match=>!!match.product) && new Set(resolved.map(match=>match.product!.id)).size===1) {
      return {...resolved[0],normalizedName,source:'Normalized',alias:resolved.find(match=>match.alias)?.alias};
    }
  }
  if(contextual.length && !direct.length) {
    const supported=contextual.filter(row=>preferredIds.includes(row.product.id));
    if(supported.length) return pick(supported,true)!;
    return {normalizedName,recognized:true,reason:'This approved alias requires a uniquely verified product context.'};
  }
  const exact = pick(direct.filter(row=>identityKey(row.product.name)===normalizedName), true);
  const directAlias = pick(direct, true);
  // Explicit saved presentation aliases retain their approved whole-label mapping.
  if (directAlias?.product && directAlias.source==='Alias' && identityAttributes(directAlias.product.name).forms.length) return directAlias;
  const input = identityAttributes(name);
  const sourceFamily=catalogFamilyKey(name),families=new Set([sourceFamily]);
  for(const row of aliasFamilies.get(sourceFamily)||[]) {
    families.add(row.canonicalFamily);
    if(row.value!==row.product.name) expandedAlias??=row.value;
  }
  const family=input.ingredient ? [...new Set([...families].flatMap(key=>catalogFamilies.get(key)||[]))].sort((a,b)=>a.order-b.order) : [];
  let compatible = family.filter(row => !generalCatalogAttributeConflict(name, row.value) && !generalCatalogAttributeConflict(name, row.product.name));
  if(compatible.some(row=>row.product.scope==='general')) compatible=compatible.filter(row=>row.product.scope==='general');
  if (compatible.length) {
    // A more specific saved presentation wins over a generic ingredient entry.
    const score = (row: typeof compatible[number]) => {
      const attrs = identityAttributes(row.product.name);
      return attrs.measurements.length * 4 + attrs.forms.length * 2 + attrs.routes.length + attrs.qualifiers.length;
    };
    const preferred = compatible.filter(row=>preferredIds.includes(row.product.id));
    if(new Set(preferred.map(row=>row.product.id)).size===1) return pick(preferred,false)!;
    if(exact?.product) return exact;
    if(directAlias?.product) return directAlias;
    const best = Math.max(...compatible.map(score));
    const result = pick(compatible.filter(row => score(row) === best), false);
    if (result) return result;
  }
  if(directAlias) return directAlias;
  if(!family.length && input.ingredient) {
    const words=input.ingredient.split(' ').sort();
    const plausible=candidates.filter(row=>{
      const attributes=identityAttributes(row.product.name),other=attributes.ingredient.split(' ').sort();
      if(words.length!==other.length || !words.every((word,index)=>safeNameWord(word,other[index])))return false;
      if(generalCatalogAttributeConflict(name,row.product.name))return false;
      // Omitted mg is allowed only for a unique, explicitly named formulation
      // with one matching strength. Never infer a ratio or container volume.
      if(input.bareNumbers.length && (!input.forms.length || attributes.measurements.length!==1 ||
        !attributes.measurements[0].endsWith('mg') || JSON.stringify(input.bareNumbers)!==JSON.stringify(attributes.measurements.map(value=>value.slice(0,-2)))))return false;
      return true;
    });
    const fuzzy=pick(plausible,false);if(fuzzy)return fuzzy;
  }
  return { normalizedName, recognized: family.length > 0,
    reason: family.length ? 'Known catalogue family, but explicit attributes conflict or a unique product ID could not be established.' : 'No approved catalogue name or alias establishes this product identity.' };
}

// Cache only repository-validated resolutions. Catalogue edits invalidate every
// entry; AI suggestions never enter this cache or the saved alias dictionary.
let catalogIdentitySignature = '';
const catalogIdentityCache = new Map<string, GeneralCatalogResolution>();
export function resolveGeneralCatalogIdentity(name: string, current: readonly CatalogProduct[], preferredIds: readonly string[] = []): GeneralCatalogResolution {
  const signature = JSON.stringify(current);
  return resolveCatalogSnapshot(name, current, preferredIds, signature);
}
function resolveCatalogSnapshot(name: string, current: readonly CatalogProduct[], preferredIds: readonly string[], signature: string): GeneralCatalogResolution {
  if (signature !== catalogIdentitySignature) { catalogIdentitySignature = signature; catalogIdentityCache.clear(); indexCurrentCatalog(current); }
  const key = JSON.stringify([name, [...preferredIds].sort()]);
  const cached = catalogIdentityCache.get(key);
  if (cached) return cached;
  const result = resolveCurrentCatalogIdentity(name, current, preferredIds);
  if (result.product) {
    if (catalogIdentityCache.size >= 1024) catalogIdentityCache.clear();
    catalogIdentityCache.set(key, result);
  }
  return result;
}
/** One immutable repository snapshot and signature per audit. Both successful
 * and unresolved lookups are reused locally; a new audit observes new edits. */
export function createGeneralCatalogResolver(current: readonly CatalogProduct[]) {
  const snapshot = structuredClone(current), signature = JSON.stringify(snapshot);
  const resolutions = new Map<string, GeneralCatalogResolution>();
  return (name: string, preferredIds: readonly string[] = []) => {
    const key = JSON.stringify([name, [...preferredIds].sort()]);
    let result = resolutions.get(key);
    if (!result) {
      result = resolveCatalogSnapshot(name, snapshot, preferredIds, signature);
      resolutions.set(key, result);
    }
    return result;
  };
}
/** Review routing only: shared ingredient words never establish equivalence. */
export function relatedGeneralCatalogDescriptions(a: string, b: string): boolean {
  const words = (name: string) => new Set(identityAttributes(name).ingredient.split(' ').filter(Boolean));
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return false;
  const contains = (x: Set<string>, y: Set<string>) => [...x].every(word => y.has(word));
  return (contains(left,right) || contains(right,left)) && [...left].some(word => word.length >= 4 && right.has(word));
}
