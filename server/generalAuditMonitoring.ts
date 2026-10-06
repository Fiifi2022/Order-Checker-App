import { runGeneralAuditor, normalizeGeneralProductName } from './generalAuditor';
import { generalPackagingCatalogueSize, getGeneralPackagingFactor } from '../src/utils/generalPackaging';
export function generalAuditHistory(records: any[]) {
  return [...new Map(records.filter(record => !record.isDemo && record.generalAudit && (record.auditScope === 'general_auditor' || !record.auditScope)).map(record => [record.id, record])).values()].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}
export function generalAuditAnalytics(records: any[]) {
  const rows = generalAuditHistory(records);
  const count = (test: (row: any) => boolean) => rows.filter(test).length;
  const rate = (value: number) => rows.length ? Math.round(value / rows.length * 1000) / 10 : 0;
  const productCount = (kind: string) => count(row => row.generalAudit.products.some((p: any) => p.fulfillmentStatus === 'discrepancy' && p.discrepancyKind === kind));
  const errors = rows.filter(row => row.generalAudit.discrepancies.length > 0);
  const frequent = (status: string) => {
    const totals = new Map<string, number>();
    for (const row of rows) for (const product of row.generalAudit.products) if (product.fulfillmentStatus === status) totals.set(product.name, (totals.get(product.name) || 0) + 1);
    return [...totals].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  };
  return { totalAudits: rows.length, successfulAudits: count(row => row.allMatch === true), discrepancyRate: rate(errors.length),
    quantityMismatchRate: rate(productCount('quantity')), missingProductRate: rate(productCount('missing')), extraProductRate: rate(productCount('extra')),
    facilityMismatchRate: rate(count(row => row.generalAudit.facility.status === 'mismatch')), ordererMismatchRate: rate(count(row => row.generalAudit.orderer.status === 'mismatch')),
    partialOutOfStockRate: rate(count(row => row.generalAudit.stockStatus === 'partially out of stock')), fullOutOfStockRate: rate(count(row => row.generalAudit.stockStatus === 'out of stock')),
    orderLimitAudits: count(row => row.generalAudit.products.some((p: any) => p.fulfillmentStatus === 'order limit applied')),
    pendingOrderLimitAudits: count(row => row.generalAudit.pendingOrderLimitCount > 0),
    averageDurationSec: rows.length ? Math.round(rows.reduce((total, row) => total + (Number(row.durationSec) || 0), 0) / rows.length * 100) / 100 : 0,
    resolutionRate: errors.length ? Math.round(errors.filter(row => row.status === 'resolved').length / errors.length * 1000) / 10 : 0,
    frequentlyMismatchedProducts: frequent('discrepancy'), frequentlyOutOfStockProducts: frequent('out of stock') };
}
export function generalRuleDiagnostics() {
  const request = 'Facility: Vea Health Centre\nOrderer: Mary A. Mensah\nPhone: 0241234567\nORS - 1 box';
  const supplied = 'Facility: VEA HC\nOrderer: Mary Mensah\nPhone: +233241234567\nORS - 25 units';
  const lower = runGeneralAuditor('Product A - 10', 'Product A - 5');
  const diagnostics = [
    { service: 'General audit rules', ok: runGeneralAuditor(request, supplied).allMatch },
    { service: 'Product normalization', ok: normalizeGeneralProductName('ACT/AL') === normalizeGeneralProductName('Coartem') && normalizeGeneralProductName('Amox') === normalizeGeneralProductName('Amoxicillin') },
    { service: 'Quantity conversion catalogue', ok: getGeneralPackagingFactor('ORS', normalizeGeneralProductName) === 25, detail: `${generalPackagingCatalogueSize} existing approved entries; ambiguous factors are declined.` },
    { service: 'Order Limit workflow', ok: lower.items[0].status === 'quantity mismatch' && runGeneralAuditor('Product A - 10', 'Product A - 5 (order limit applied)').allMatch },
    { service: 'Out-of-stock rules', ok: runGeneralAuditor('Product A - 1', 'Product A (0/1)').allMatch }
  ];
  return diagnostics.map(row => ({ ...row, status: row.ok ? 'Passed' : 'Failed' }));
}
