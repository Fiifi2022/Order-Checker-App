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
// The operator confirmed this FS presentation: 5 system packs = 50 blisters.
// It is distinct from the catalogue's tablets-per-blister internalQuantity.
const blisterPackPresentations = [{ name: 'Sulphadoxine/Pyrimethamine 500mg/25mg Tablet', blistersPerPack: 10 }];
export function generalQuantityBasis(name: string, requested: number, supplied: number, requestUnit: string, supplyUnit: string, normalize: (name: string) => string, systemPackRatio = false) {
  const blisterPack = blisterPackPresentations.find(presentation => normalize(presentation.name) === normalize(name));
  if (blisterPack && (requestUnit === 'blister' && (supplyUnit === 'pack' || !supplyUnit && systemPackRatio) || requestUnit === 'pack' && supplyUnit === 'blister')) {
    const factor = blisterPack.blistersPerPack;
    return { requested: requestUnit === 'pack' ? requested * factor : requested,
      supplied: requestUnit === 'blister' ? supplied * factor : supplied, unit: 'blister', factor,
      supplyUnit: supplyUnit || 'pack',
      description: `1 pack = ${factor} blisters (confirmed FS product presentation)` };
  }
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
