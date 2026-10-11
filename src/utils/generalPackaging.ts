import { getCatalogRevision } from '../../shared/productCatalog';
import catalogue from './generalPackagingCatalogue.json';

// Snapshot of the approved catalogue already embedded in server.ts.
// Conflicting normalized entries remain unsupported rather than choosing a factor.
let indexes = new WeakMap<Function, Map<string, number | null>>();
let indexRevision = -1;
export function getGeneralPackagingFactor(name: string, normalize: (name: string) => string) {
  if (indexRevision !== getCatalogRevision()) { indexes = new WeakMap(); indexRevision = getCatalogRevision(); }
  let index = indexes.get(normalize);
  if (!index) {
    index = new Map();
    for (const row of catalogue) {
      const key = normalize(row.name);
      if (index.has(key) && index.get(key) !== row.internalQuantity) index.set(key, null);
      else if (!index.has(key)) index.set(key, row.internalQuantity);
    }
    indexes.set(normalize, index);
  }
  return index.get(normalize(name)) ?? null;
}
export const generalPackagingCatalogueSize = catalogue.length;
const packages = new Set(['box', 'pack', 'card', 'bottle']);
const individuals = new Set(['unit', 'piece', 'tablet', 'capsule', 'sachet', 'test', 'vial', 'dose']);
export function generalQuantityBasis(name: string, requested: number, supplied: number, requestUnit: string, supplyUnit: string, normalize: (name: string) => string) {
  const factor = getGeneralPackagingFactor(name, normalize);
  const requestPackage = packages.has(requestUnit) && individuals.has(supplyUnit);
  const supplyPackage = packages.has(supplyUnit) && individuals.has(requestUnit);
  if (!factor || factor <= 1 || (!requestPackage && !supplyPackage)) return null;
  return {
    requested: requestPackage ? requested * factor : requested,
    supplied: supplyPackage ? supplied * factor : supplied,
    unit: requestPackage ? supplyUnit : requestUnit,
    factor,
    description: `1 ${requestPackage ? requestUnit : supplyUnit} = ${factor} ${requestPackage ? supplyUnit : requestUnit} (approved product catalogue)`
  };
}
