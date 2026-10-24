import type { CatalogProduct } from './productCatalog';
export interface GeneralProductNameAlias {
  id: string; originalWording: string; normalizedAlias: string; catalogProductId: string; canonicalName: string;
  resolvedDescription: string; recognition: 'complete' | 'identity only'; status: 'approved' | 'disabled';
  constraints: { measurements: string[]; forms: string[]; routes: string[]; releases: string[]; qualifiers: string[] };
  confirmedBy: { id: string; name: string }; confirmedAt: string; updatedAt: string;
  history: { action: 'approved' | 'corrected' | 'disabled'; catalogProductId: string; actor: { id: string; name: string }; at: string }[];
}
export interface GeneralProductAliasState { revision: number; aliases: GeneralProductNameAlias[] }
export const emptyGeneralProductAliases = (): GeneralProductAliasState => ({ revision: 0, aliases: [] });
export const generalProductAliasKey = (name: string) => {
  const value = name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  // Ignore word order for single-strength names. Compound doses retain full
  // wording order so amounts cannot silently move between ingredients.
  const measurements = value.match(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|l|miu|iu)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:mcg|mg|g|ml|l|miu|iu))?\b/g) || [];
  return `${measurements.length > 1 ? value : value.split(' ').sort().join(' ')}|${measurements.join(' ')}`;
};
let state = emptyGeneralProductAliases();
let catalog: CatalogProduct[] = [];
let conflicts = new Set<string>();
let approved = new Map<string, GeneralProductNameAlias[]>();
export function setGeneralProductNameAliases(next: GeneralProductAliasState | undefined, products: CatalogProduct[]) {
  state = next || emptyGeneralProductAliases(); catalog = products.filter(product => product.scope === 'general'); approved = new Map(); conflicts = new Set();
  for (const alias of state.aliases) {
    if (alias.status !== 'approved' || !catalog.some(product => product.id === alias.catalogProductId && product.name === alias.canonicalName)) continue;
    const key = generalProductAliasKey(alias.originalWording);
    if (catalog.some(product => product.id !== alias.catalogProductId && [product.name, ...product.aliases].some(name => generalProductAliasKey(name) === key))) conflicts.add(key);
    approved.set(key, [...(approved.get(key) || []), alias]);
  }
}
export function generalAliasCatalog() { return catalog; }
export function generalAliasRevision() { return state.revision; }
export function generalLearnedAlias(name: string) {
  const candidates = approved.get(generalProductAliasKey(name)) || [];
  return candidates.length === 1 && !conflicts.has(generalProductAliasKey(name)) ? candidates[0] : undefined;
}
export function generalLearnedAliasAmbiguous(name: string) { return conflicts.has(generalProductAliasKey(name)) || (approved.get(generalProductAliasKey(name)) || []).length > 1; }
