/** Only skip vocabulary reads for endpoints that return raw saved data without
 * product interpretation. Parsing, alias lists and all mutations stay fresh. */
export function needsProductCatalog(method: string, path: string): boolean {
  if (method === 'GET' && (
    /^\/vaccine\/blueprint-districts\/[^/]+\/(?:current|facility-quantities)$/.test(path) ||
    ['/vaccine/companion/context', '/vaccine/companion/facilities', '/vaccine/transactions', '/vaccine/adjustments', '/vaccine/audit-logs', '/vaccine/dhd-inventory'].includes(path)
  )) return false;
  return path === '/verify' || path.startsWith('/vaccine/');
}
