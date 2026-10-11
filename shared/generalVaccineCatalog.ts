import { catalogKey, catalogProductNames, type CatalogProduct } from './productCatalog';

let identities = new Map<string, string>();
let conflicts = new Set<string>();

/** Bring vaccine catalog labels into General without merging its distinct identities. */
export function setGeneralVaccineCatalog(products: CatalogProduct[]) {
  const general = products.filter(product => product.scope === 'general');
  const labels = new Map<string, CatalogProduct[]>();
  const contextual = new Set<string>();
  for (const product of general) {
    for (const label of catalogProductNames(product)) {
      const key = catalogKey(label);
      labels.set(key, [...(labels.get(key) || []), product]);
    }
    product.contextualAliases.forEach(label => contextual.add(catalogKey(label)));
  }
  const candidates = new Map<string, Set<string>>();
  conflicts = new Set();
  for (const product of products.filter(product => product.scope === 'vaccine')) {
    const counterparts = labels.get(catalogKey(product.name)) || [];
    const linked = general.find(other => other.id === product.linkedProductId || other.linkedProductId === product.id);
    const vaccineCounterparts = counterparts.filter(other => other.category === 'vaccine');
    const counterpart = counterparts.length === 1 ? counterparts[0] : vaccineCounterparts.length === 1 ? vaccineCounterparts[0] : undefined;
    if (!linked && counterparts.length > 1 && !counterpart) {
      catalogProductNames(product).forEach(label => conflicts.add(catalogKey(label)));
      continue;
    }
    const canonical = linked?.name || counterpart?.name || product.name;
    for (const label of catalogProductNames(product)) {
      const key = catalogKey(label);
      if (contextual.has(key) || product.contextualAliases.some(alias => catalogKey(alias) === key) ||
        (labels.get(key) || []).some(other => other.name !== canonical)) {
        conflicts.add(key); continue;
      }
      const targets = candidates.get(key) || new Set<string>();
      targets.add(canonical); candidates.set(key, targets);
    }
  }
  for (const [key, targets] of candidates) if (targets.size > 1) conflicts.add(key);
  identities = new Map([...candidates].filter(([key, targets]) => targets.size === 1 && !conflicts.has(key))
    .map(([key, targets]) => [key, [...targets][0]]));
}

export const resolveCatalogVaccineName = (name: string) => identities.get(catalogKey(name));
export const isConflictingVaccineAlias = (name: string) => conflicts.has(catalogKey(name));
