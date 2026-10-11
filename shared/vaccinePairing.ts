import { catalogKey, catalogProductNames, type CatalogProduct } from './productCatalog';

export const CLINICAL_PAIRINGS: Record<string, { type: 'diluent' | 'dropper'; name: string; accessoryCanonical: string; dosesPerVial: number }> = {
  BCG: { type: 'diluent', name: 'BCG Diluent', accessoryCanonical: 'BCG Diluent', dosesPerVial: 20 },
  MR: { type: 'diluent', name: 'MR Diluent', accessoryCanonical: 'MR Diluent', dosesPerVial: 10 },
  'Yellow Fever': { type: 'diluent', name: 'Yellow Fever Diluent', accessoryCanonical: 'Yellow Fever Diluent', dosesPerVial: 10 },
  'Men A': { type: 'diluent', name: 'Men A Diluent', accessoryCanonical: 'Men A Diluent', dosesPerVial: 10 },
  OPV: { type: 'dropper', name: 'OPV Dropper', accessoryCanonical: 'OPV Dropper', dosesPerVial: 20 },
  Rota: { type: 'dropper', name: 'Rota Dropper', accessoryCanonical: 'Rota Dropper', dosesPerVial: 1 },
};

export function vaccinePairingFailure(primaryQuantity: number, companionQuantity: number) {
  if (primaryQuantity > 0 && companionQuantity <= 0) return 'missing' as const;
  if (primaryQuantity > 0 && companionQuantity > 0 && primaryQuantity !== companionQuantity) return 'quantity' as const;
  if (primaryQuantity <= 0 && companionQuantity > 0) return 'orphan' as const;
  return null;
}

const defaultNames: Record<string, string[]> = {
  BCG: ['BCG Vaccine', 'Bacille Calmette-Guerin Vaccine', 'Bacillus Calmette-Guerin'],
  MR: ['Measles-Rubella Vaccine', 'Measles Rubella Vaccine', 'MR Vaccine'],
  'Yellow Fever': ['Yellow Fever Vaccine', 'YF', 'YF Vaccine'],
  'Men A': ['Meningococcal A Vaccine', 'Meningococcal Conjugate A Vaccine', 'Men A Vaccine', 'Men-A', 'Mena'],
  OPV: ['Oral Polio Vaccine', 'OPV Vaccine', 'bOPV', 'OPV (One and Three)'],
  Rota: ['Rotavirus Vaccine', 'Rota Vaccine'],
  'BCG Diluent': ['BCG Vaccine Diluent', 'Bacille Calmette-Guerin Vaccine Diluent'],
  'MR Diluent': ['Measles-Rubella Vaccine Diluent', 'Measles Rubella Vaccine Diluent'],
  'Yellow Fever Diluent': ['Yellow Fever Vaccine Diluent', 'YF Diluent'],
  'Men A Diluent': ['Meningococcal A Vaccine Diluent', 'Meningococcal Conjugate A Vaccine Diluent'],
  'OPV Dropper': ['Oral Polio Vaccine Dropper', 'OPV Droppers'],
  'Rota Dropper': ['Rotavirus Vaccine Dropper', 'Rota Droppers'],
};
const key = (value: string) => catalogKey(value).replace(/\bdiluents\b/g, 'diluent').replace(/\bdroppers\b/g, 'dropper');
let names = new Map<string, string>();
export function setVaccinePairingCatalog(products: CatalogProduct[]) {
  const candidates = new Map<string, Set<string>>();
  const add = (canonical: string, labels: string[]) => labels.forEach(label => {
    const targets = candidates.get(key(label)) || new Set<string>();
    targets.add(canonical); candidates.set(key(label), targets);
  });
  for (const [canonical, aliases] of Object.entries(defaultNames)) add(canonical, [canonical, ...aliases]);
  const defaults = new Map([...candidates].map(([label, targets]) => [label, [...targets][0]]));
  if (products.length) {
    candidates.clear();
    // Once loaded, the catalog owns aliases. Rule identities remain stable.
    for (const canonical of Object.keys(defaultNames)) add(canonical, [canonical]);
  }
  for (const product of products) {
    const canonical = defaults.get(key(product.name));
    if (canonical) add(canonical, catalogProductNames(product).filter(label => !product.contextualAliases.some(alias => key(alias) === key(label))));
  }
  names = new Map([...candidates].filter(([, targets]) => targets.size === 1).map(([label, targets]) => [label, [...targets][0]]));
}
setVaccinePairingCatalog([]);
export const resolveVaccinePairingName = (name: string) => names.get(key(name));
