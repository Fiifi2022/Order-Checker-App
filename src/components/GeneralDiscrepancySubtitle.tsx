import { generalProductDisplayName } from '../utils/generalAuditor';

const identityLabels: Record<string, string> = {
  FACILITY_MISMATCH: 'Facility Name Mismatch',
  ORDERER_NAME_MISMATCH: 'Orderer Name Mismatch',
  ORDERER_NAME_NOT_FOUND: 'Orderer Name Not Found',
  FACILITY_NOT_FOUND: 'Facility Name Not Found',
  'Facility Not Found': 'Facility Name Not Found'
};

// Format the final audit's existing discrepancy strings; do not detect errors here.
function displayDiscrepancy(error: string): string {
  if (identityLabels[error]) return identityLabels[error];
  const productLabels: [RegExp, string][] = [
    [/^(.+?) quantity mismatch(?::.*)?$/i, 'Quantity Mismatch'],
    [/^(.+?) missing from System Entry$/i, 'Missing Product'],
    [/^(.+?) extra in System Entry$/i, 'Extra Product'],
    [/^(.+?) product mismatch(?::.*)?$/i, 'Product Mismatch']
  ];
  for (const [pattern, label] of productLabels) {
    const match = error.match(pattern);
    if (match) return `${label} — ${generalProductDisplayName(match[1])}`;
  }
  const codedProduct = error.match(/^(QUANTITY_MISMATCH|MISSING_PRODUCT|EXTRA_PRODUCT|PRODUCT_MISMATCH)\s*(?:—|:)\s*(.+)$/);
  if (codedProduct) {
    const labels: Record<string, string> = { QUANTITY_MISMATCH: 'Quantity Mismatch', MISSING_PRODUCT: 'Missing Product', EXTRA_PRODUCT: 'Extra Product', PRODUCT_MISMATCH: 'Product Mismatch' };
    return `${labels[codedProduct[1]]} — ${generalProductDisplayName(codedProduct[2])}`;
  }
  return error;
}

export default function GeneralDiscrepancySubtitle({ discrepancies }: { discrepancies: string[] }) {
  if (!discrepancies.length) return null;
  const errors = discrepancies.map(displayDiscrepancy);
  if (errors.length === 1) return <p className="text-xs text-slate-500 mt-1 sm:mt-0">{errors[0]}</p>;
  return <ul className="text-xs text-slate-500 mt-1 sm:mt-0 list-disc pl-4 space-y-1" aria-label="Audit discrepancies">
    {errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
  </ul>;
}
