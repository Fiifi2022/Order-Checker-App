import type { FacilityBlueprintRow } from '../components/VaccineAllocationBlueprint';

const fields = ['processing', 'completed', 'facility', 'subDistrict', 'deliverySite'];
const subfields = ['carryOver', 'allocation', 'distributed', 'balance'];

export function blueprintColumnKey(index: number, products: string[]): string {
  if (index < 5) return `field:${fields[index]}`;
  const product = products[Math.floor((index - 5) / 4)];
  return `vaccine:${product}:${subfields[(index - 5) % 4]}`;
}

export function visibleBlueprintColumns(products: string[], deletedKeys: string[]): number[] {
  const deleted = new Set(deletedKeys);
  return Array.from({ length: 5 + products.length * 4 }, (_, index) => index)
    .filter(index => !deleted.has(blueprintColumnKey(index, products)));
}

export function deleteBlueprintColumnData(rows: FacilityBlueprintRow[], products: string[], indexes: number[]): FacilityBlueprintRow[] {
  return rows.map(row => {
    const next = { ...row, vaccines: { ...row.vaccines } };
    for (const index of indexes) {
      if (index < 5) {
        const field = fields[index] as 'processing' | 'completed' | 'facility' | 'subDistrict' | 'deliverySite';
        next[field] = '';
      } else {
        const product = products[Math.floor((index - 5) / 4)];
        const field = subfields[(index - 5) % 4] as 'carryOver' | 'allocation' | 'distributed' | 'balance';
        if (next.vaccines[product]) next.vaccines[product] = { ...next.vaccines[product], [field]: '' };
      }
    }
    return next;
  });
}
