export type KpiFilter = {
  from?: string;
  to?: string;
  district?: string;
  facility?: string;
  user?: string;
  source?: string;
  cycle?: string;
};

const value = (obj: any, ...keys: string[]): string => {
  for (const key of keys) if (obj?.[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) return String(obj[key]).trim();
  return '';
};
const pct = (n: number, d: number) => ({ numerator: n, denominator: d, rate: d ? n / d : null });
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null;
};
const dateOf = (r: any) => value(r, 'verificationCompletedAt', 'timestamp', 'validatedAt', 'completedAt');
const isDemo = (r: any) => r?.isDemo === true || r?.demo === true || r?.recordType === 'demo' || /^ACT-SYS-/.test(value(r, 'id'));
const hasDate = (r: any) => Number.isFinite(Date.parse(dateOf(r)));
const matches = (r: any, f: KpiFilter) => {
  const d = Date.parse(dateOf(r));
  if (f.from && (!Number.isFinite(d) || d < Date.parse(`${f.from}T00:00:00`))) return false;
  if (f.to && (!Number.isFinite(d) || d > Date.parse(`${f.to}T23:59:59.999`))) return false;
  const checks: [string, string][] = [['district', f.district || ''], ['facility', f.facility || ''], ['user', f.user || ''], ['source', f.source || '']];
  for (const [field, want] of checks) {
    if (!want || want === 'all') continue;
    const got = field === 'user' ? value(r, 'user', 'ccaUser', 'actorName') : field === 'source' ? value(r, 'orderSource', 'source') : value(r, field, field === 'facility' ? 'facilityName' : field);
    if (got !== want) return false;
  }
  return true;
};
const distribution = (rows: any[], key: 'district' | 'facility' | 'user' | 'source') => {
  const counts: Record<string, number> = {};
  rows.forEach(r => { const k = key === 'user' ? value(r, 'user', 'ccaUser', 'actorName') : key === 'source' ? value(r, 'orderSource', 'source') : value(r, key, key === 'facility' ? 'facilityName' : key); if (k) counts[k] = (counts[k] || 0) + 1; });
  return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};

export function calculateKpis(input: { audits?: any[]; vaccineChecks?: any[]; transactions?: any[]; allocations?: any[]; filter?: KpiFilter }) {
  const filter = input.filter || {};
  const realAudits = (input.audits || []).filter(r => !isDemo(r));
  const realChecks = (input.vaccineChecks || []).filter(r => !isDemo(r));
  const realTransactions = (input.transactions || []).filter(r => !isDemo(r));
  const sourceChecks = [...realAudits.map(r => ({ ...r, _kind: 'audit' })), ...realChecks.map(r => ({ ...r, _kind: 'vaccine' }))];
  const dimensionMatched = sourceChecks.filter(r => matches(r, { ...filter, from: undefined, to: undefined }));
  const allChecks = dimensionMatched.filter(r => matches(r, filter));
  const validAudit = allChecks.filter(r => r._kind === 'audit' && hasDate(r) && value(r, 'id'));
  const validVaccine = allChecks.filter(r => r._kind === 'vaccine' && hasDate(r) && value(r, 'id'));
  const allValid = [...validAudit, ...validVaccine];
  const distinctOrders = new Set(allValid.map(r => value(r, 'orderId')).filter(Boolean));
  const passedChecks = allValid.filter(r => r.allMatch === true || r.auditResult === 'GREEN_LIGHT');
  const checksWithIssues = allValid.filter(r => r.auditResult === 'DO_NOT_PROCESS' || r.allMatch === false || Number(r.issueCount) > 0 || (r.errorsDetected || []).length > 0 || (r.items || []).some((i: any) => i.status !== 'match' && i.status !== 'out of stock'));
  const auditIssues = validAudit.filter(r => r.allMatch === false || (Number(r.issueCount) > 0) || (r.errorsDetected || []).length > 0);
  const vaccineChecks = validVaccine;
  const blocked = vaccineChecks.filter(r => r.auditResult === 'DO_NOT_PROCESS');
  const filteredTx = realTransactions.filter(r => matches(r, filter) && hasDate(r) && value(r, 'id'));
  const confirmedChecks = vaccineChecks.filter(r => r.confirmed && value(r, 'confirmedTransactionId'));
  const confirmedPairs = confirmedChecks.filter(r => realTransactions.some(t => value(t, 'id') === value(r, 'confirmedTransactionId') && value(t, 'auditCheckId', 'orderId') === value(r, 'id') && matches(t, { ...filter, from: undefined, to: undefined })));
  const confirmedDiscrepant = confirmedPairs.filter(r => r.auditResult === 'DO_NOT_PROCESS' || (r.errorsDetected || []).length > 0);
  const durations = allValid.map(r => Number(r.durationSec ?? ((Date.parse(value(r, 'verificationCompletedAt')) - Date.parse(value(r, 'verificationStartedAt'))) / 1000))).filter(n => Number.isFinite(n) && n >= 0);
  const errors: Record<string, number> = {};
  for (const r of [...validAudit, ...validVaccine]) {
    const issues = r._kind === 'audit' ? (r.items || []).filter((i: any) => i.status !== 'match' && i.status !== 'out of stock').map((i: any) => [`${i.name || 'Unknown product'} — ${i.status}`, i.status]) : (r.productsChecked || []).filter((i: any) => (i.errors || []).length > 0).map((i: any) => [`${i.vaccine || 'Unknown product'} — ${i.status || 'issue'}`, i.status || 'issue']);
    for (const [label] of issues as any) errors[label] = (errors[label] || 0) + 1;
  }
  const allocationRows = (input.allocations || []).flatMap(f => Object.entries(f.vaccines || {}).map(([product, v]: [string, any]) => ({ facility: f.facilityName, district: f.district, cycle: f.cycle, product, ordered: Number(v.taken || 0), allocated: Number(v.original || 0) + Number(v.carryOver || 0) + Number(v.topUp || 0) + Number(v.adjustment || 0), remaining: Number(v.remaining || 0), category: /syringe|needle|soloshot/i.test(product) ? 'consumables' : 'vaccines' }))).filter(r => (!filter.district || filter.district === 'all' || r.district === filter.district) && (!filter.facility || filter.facility === 'all' || r.facility === filter.facility) && (!filter.cycle || filter.cycle === 'all' || r.cycle === filter.cycle));
  const utilization = (category: string) => { const rows = allocationRows.filter(r => r.category === category); const ordered = rows.reduce((s, r) => s + r.ordered, 0); const allocated = rows.reduce((s, r) => s + r.allocated, 0); return { ordered, allocated, rate: allocated ? ordered / allocated : null }; };
  const missingFields: Record<string, number> = {};
  for (const r of dimensionMatched) for (const [field, keys] of [['date', ['timestamp', 'validatedAt']], ['facility', ['facility', 'facilityName']], ['district', ['district']], ['user', ['user', 'ccaUser']], ['cycle', ['cycle', 'allocationSheet']], ['order source', ['orderSource', 'source']], ['stable order ID', ['orderId']]] as [string, string[]][]) if (!value(r, ...keys)) missingFields[field] = (missingFields[field] || 0) + 1;
  const timeline: Record<string, number> = {};
  for (const r of allValid) { const d = dateOf(r).slice(0, 10); timeline[d] = (timeline[d] || 0) + 1; }
  const appChecks = allValid.filter(r => value(r, 'clientSource', 'checkSource') !== 'companion_extension');
  const extensionChecks = allValid.filter(r => value(r, 'clientSource', 'checkSource') === 'companion_extension');
  const usageByDay: Record<string, { date: string; appUses: number; extensionUses: number; uses: number }> = {};
  const agentUsage: Record<string, { date: string; agent: string; appUses: number; extensionUses: number; uses: number }> = {};
  for (const r of allValid) {
    const date = dateOf(r).slice(0, 10);
    const isExtension = value(r, 'clientSource', 'checkSource') === 'companion_extension';
    const agent = value(r, 'user', 'ccaUser', 'actorName') || 'Unknown agent';
    const day = usageByDay[date] ||= { date, appUses: 0, extensionUses: 0, uses: 0 };
    const agentDay = agentUsage[`${date}|${agent}`] ||= { date, agent, appUses: 0, extensionUses: 0, uses: 0 };
    if (isExtension) { day.extensionUses++; agentDay.extensionUses++; }
    else { day.appUses++; agentDay.appUses++; }
    day.uses++;
    agentDay.uses++;
  }
  const auditIssueItems = (r: any) => (r.items || []).filter((i: any) => i.status !== 'match' && i.status !== 'out of stock');
  const issueAudits = validAudit.filter(r => r.allMatch === false || Number(r.issueCount) > 0 || (r.errorsDetected || []).length > 0 || auditIssueItems(r).length > 0);
  const enteredIssueCount = issueAudits.reduce((sum, r) => sum + Math.max(1, Number(r.issueCount) || auditIssueItems(r).length || (r.errorsDetected || []).length), 0);
  const resolvedIssueAudits = issueAudits.filter(r => r.status === 'resolved' && Number.isFinite(Date.parse(value(r, 'resolvedAt'))));
  const resolutionDurations = resolvedIssueAudits.map(r => (Date.parse(value(r, 'resolvedAt')) - Date.parse(value(r, 'timestamp'))) / 1000).filter(n => n >= 0);
  const resolvedIssueCount = resolvedIssueAudits.reduce((sum, r) => sum + Math.max(1, Number(r.resolvedIssueCount) || Number(r.issueCount) || auditIssueItems(r).length || (r.errorsDetected || []).length), 0);
  const mostCommonErrors: Record<string, number> = {};
  for (const r of allValid) {
    const entries: string[] = r._kind === 'audit'
      ? [
          ...auditIssueItems(r).map((i: any) => `${i.name || 'Unknown product'} — ${i.status || 'issue'}`),
          ...Object.entries(r.meta || {}).filter(([, detail]: [string, any]) => detail?.status === 'mismatch').map(([field]) => `Metadata — ${field} mismatch`)
        ]
      : (r.productsChecked || []).flatMap((i: any) => (i.errors || []).map((e: string) => `${i.vaccine || 'Unknown product'} — ${e}`));
    if (entries.length === 0) for (const error of r.errorsDetected || []) entries.push(`${r._kind === 'vaccine' ? 'Allocation' : 'Audit'} — ${error}`);
    for (const label of new Set(entries)) mostCommonErrors[label] = (mostCommonErrors[label] || 0) + 1;
  }
  return {
    counts: { auditChecks: validAudit.length, vaccineChecks: vaccineChecks.length, checks: allValid.length, uniqueOrders: distinctOrders.size, confirmedOrders: confirmedPairs.length },
    rates: { auditPass: pct(passedChecks.length, allValid.length), discrepancy: pct(checksWithIssues.length, allValid.length), block: pct(blocked.length, vaccineChecks.length), confirmation: pct(confirmedPairs.length, vaccineChecks.length), confirmedDiscrepancy: pct(confirmedDiscrepant.length, confirmedPairs.length), resolution: pct(resolvedIssueAudits.length, auditIssues.length) },
    timing: { verificationAverageSeconds: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null, verificationMedianSeconds: median(durations), resolutionMedianSeconds: median(resolutionDurations) },
    errors: Object.entries(mostCommonErrors).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    usage: { appUses: appChecks.length, extensionUses: extensionChecks.length, totalUses: allValid.length, enteredIssues: enteredIssueCount, resolvedIssues: resolvedIssueCount, issueChecksEntered: issueAudits.length, issueChecksResolved: resolvedIssueAudits.length, daily: Object.values(usageByDay).sort((a, b) => a.date.localeCompare(b.date)), agentsByDay: Object.values(agentUsage).sort((a, b) => a.date.localeCompare(b.date) || a.agent.localeCompare(b.agent)) },
    utilization: { vaccines: utilization('vaccines'), consumables: utilization('consumables') },
    stockExhaustion: { facilities: new Set(allocationRows.filter(r => r.remaining === 0).map(r => r.facility)).size, products: new Set(allocationRows.filter(r => r.remaining === 0).map(r => `${r.facility}|${r.product}`)).size },
    breakdowns: { district: distribution(allValid, 'district'), facility: distribution(allValid, 'facility'), user: distribution(allValid, 'user'), source: distribution(allValid, 'source'), confirmationsByDistrict: distribution(filteredTx, 'district'), confirmationsByFacility: distribution(filteredTx, 'facility'), confirmationsByUser: distribution(filteredTx, 'user'), confirmationsBySource: distribution(filteredTx, 'source'), timeline: Object.entries(timeline).sort().map(([date, count]) => ({ date, count })) },
    records: {
      checks: allValid.map(r => ({
        id: r.id, _kind: r._kind, clientSource: value(r, 'clientSource', 'checkSource') || 'legacy_or_unknown', timestamp: dateOf(r), verificationStartedAt: r.verificationStartedAt,
        verificationCompletedAt: r.verificationCompletedAt, durationSec: r.durationSec,
        district: r.district, facility: r.facility, facilityName: r.facilityName,
        user: r.user, ccaUser: r.ccaUser, orderSource: r.orderSource, source: r.source,
        cycle: r.cycle, allocationSheet: r.allocationSheet, orderId: r.orderId,
        allMatch: r.allMatch, issueCount: r.issueCount, resolvedIssueCount: r.resolvedIssueCount, status: r.status, resolvedAt: r.resolvedAt,
        auditResult: r.auditResult, errorsDetected: r.errorsDetected,
        confirmed: r.confirmed, confirmedTransactionId: r.confirmedTransactionId,
        meta: r.meta,
        items: (r.items || []).map((i: any) => ({ name: i.name, status: i.status, errors: i.errors })),
        productsChecked: (r.productsChecked || []).map((i: any) => ({ vaccine: i.vaccine, status: i.status, errors: i.errors }))
      })),
      transactions: filteredTx.map(r => ({ id: r.id, timestamp: r.timestamp, district: r.district, facilityName: r.facilityName, ccaUser: r.ccaUser, source: r.source, cycle: r.cycle, auditCheckId: r.auditCheckId, orderId: r.orderId, status: r.status, items: (r.items || []).map((i: any) => ({ vaccine: i.vaccine, currentOrder: i.currentOrder, requestedQty: i.requestedQty })) }))
    },
    quality: { excludedInvalid: allChecks.length - allValid.length, excludedUniqueOrders: allValid.filter(r => !value(r, 'orderId')).length, missingFields, recordsAvailable: allChecks.length },
    options: { districts: [...new Set(allChecks.map(r => value(r, 'district')).filter(Boolean))].sort(), facilities: [...new Set(allChecks.map(r => value(r, 'facility', 'facilityName')).filter(Boolean))].sort(), users: [...new Set(allChecks.map(r => value(r, 'user', 'ccaUser')).filter(Boolean))].sort(), sources: [...new Set(allChecks.map(r => value(r, 'orderSource', 'source')).filter(Boolean))].sort() }
  };
}
