import React, { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

type Kpis = any;
const today = new Date().toISOString().slice(0, 10);

export default function KpiDashboard() {
  const [data, setData] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ from: '', to: today, district: 'all', facility: 'all', user: 'all', source: 'all' });
  const [detailTitle, setDetailTitle] = useState('');
  const [detailRows, setDetailRows] = useState<any[] | null>(null);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value && value !== 'all') qs.set(key, String(value)); });
      const res = await fetch(`/api/kpis?${qs}`);
      if (!res.ok) throw new Error('The KPI records could not be loaded.');
      setData(await res.json());
    } catch (e: any) { setError(e.message || 'KPI data is unavailable.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filters]);
  const open = (title: string, rows = data?.records?.checks || []) => { setDetailTitle(title); setDetailRows(rows); };
  const pct = (o: any) => o?.rate === null || o?.rate === undefined ? '—' : `${(o.rate * 100).toFixed(1)}%`;
  const issueChecks = (data?.records?.checks || []).filter((r: any) => r._kind === 'audit' && (r.allMatch === false || Number(r.issueCount) > 0 || (r.errorsDetected || []).length > 0 || (r.items || []).some((i: any) => i.status !== 'match' && i.status !== 'out of stock')));
  const recordsForError = (label: string) => (data?.records?.checks || []).filter((r: any) => (r.items || []).some((i: any) => `${i.name || 'Unknown product'} — ${i.status || 'issue'}` === label) || (r.productsChecked || []).some((i: any) => (i.errors || []).some((e: string) => `${i.vaccine || 'Unknown product'} — ${e}` === label)));
  const csv = () => {
    if (!data) return;
    const lines = [
      ['KPI', 'Count / Numerator', 'Denominator', 'Rate'],
      ['Order Checker app uses (saved checks)', data.usage.appUses, '', ''],
      ['Companion extension uses (saved checks)', data.usage.extensionUses, '', ''],
      ['Issue items entered', data.usage.enteredIssues, '', ''],
      ['Issue items resolved', data.usage.resolvedIssues, '', ''],
      ['Issue checks entered', data.usage.issueChecksEntered, '', ''],
      ['Issue checks resolved', data.usage.issueChecksResolved, data.usage.issueChecksEntered, pct({ rate: data.usage.issueChecksEntered ? data.usage.issueChecksResolved / data.usage.issueChecksEntered : null })],
      ['Total saved checks', data.counts.checks, '', ''],
      ['Unique orders with stable IDs', data.counts.uniqueOrders, '', ''],
      ['Excluded invalid checks', data.quality.excludedInvalid, '', ''],
      ['Records missing required fields', Object.values(data.quality.missingFields).reduce((a: number, b: any) => a + Number(b), 0), '', '']
    ];
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csvSummary = lines.map(row => row.map(escape).join(',')).join('\n');
    const supporting = [['recordId','kind','date','appSource','district','facility','agent','result','issues','status'], ...data.records.checks.map((r: any) => [r.id, r._kind, r.timestamp, r.clientSource, r.district, r.facility || r.facilityName, r.user || r.ccaUser, r.auditResult || (r.allMatch ? 'PASS' : 'ISSUES'), r.issueCount, r.status])].map(row => row.map(escape).join(',')).join('\n');
    const blob = new Blob([`Filtered KPI summary\n${csvSummary}\n\nSupporting saved checks\n${supporting}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'order-check-kpis.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const select = (key: keyof typeof filters, options: string[], label: string) => <label className="text-xs font-semibold text-slate-600">{label}<select className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={filters[key]} onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))}><option value="all">All</option>{options.map(v => <option key={v}>{v}</option>)}</select></label>;
  const bars = (title: string, rows: any[], onSelect?: (r: any) => void, labelKey = 'label') => <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-3 font-bold text-slate-800">{title}</h3>{rows.length ? <div className="space-y-2">{rows.slice(0, 10).map((r: any, i: number) => <button key={`${r[labelKey] || r.date}-${i}`} onClick={() => onSelect?.(r)} className="w-full text-left"><div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate">{r[labelKey] || r.date}</span><span>{r.count ?? r.uses}</span></div><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-purple-600" style={{ width: `${Math.max(2, ((r.count ?? r.uses) / Math.max(...rows.map((x: any) => x.count ?? x.uses))) * 100)}%` }} /></div></button>)}</div> : <p className="text-sm text-slate-500">No saved records for this selection.</p>}</section>;
  const usageCards = useMemo(() => data ? [
    ['Order Checker app uses', data.usage.appUses, 'Saved app checks in this date range', () => open('Order Checker app checks', data.records.checks.filter((r: any) => r.clientSource !== 'companion_extension'))],
    ['Extension uses', data.usage.extensionUses, 'Saved companion extension checks', () => open('Companion extension checks', data.records.checks.filter((r: any) => r.clientSource === 'companion_extension'))],
    ['Issues entered', data.usage.enteredIssues, `${data.usage.issueChecksEntered} audit checks with issues`, () => open('Checks with issues entered', issueChecks)],
    ['Issues resolved', data.usage.resolvedIssues, `${data.usage.issueChecksResolved} of ${data.usage.issueChecksEntered} issue checks resolved`, () => open('Resolved issue checks', issueChecks.filter((r: any) => r.status === 'resolved'))]
  ] : [], [data]);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-black text-[#3B1A5E]">Order Checker Usage</h1><p className="max-w-3xl text-sm text-slate-500">Counts are saved verification checks, not page visits. Rechecks count as uses; stable order IDs are shown separately. Historical checks without a source marker are grouped with app use.</p></div><div className="flex gap-2"><button onClick={load} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold"><RefreshCw size={15}/>Refresh</button><button onClick={csv} disabled={!data} className="inline-flex items-center gap-2 rounded-lg bg-purple-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"><Download size={15}/>Export CSV</button></div></div>
    <div className="grid grid-cols-2 gap-3 rounded-xl border bg-slate-50 p-4 md:grid-cols-3 lg:grid-cols-6"><label className="text-xs font-semibold text-slate-600">From<input type="date" className="mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}/></label><label className="text-xs font-semibold text-slate-600">To<input type="date" className="mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}/></label>{select('district', data?.options.districts || [], 'District')}{select('facility', data?.options.facilities || [], 'Facility')}{select('user', data?.options.users || [], 'Agent')}{select('source', data?.options.sources || [], 'Order source')}</div>
    {loading ? <div className="rounded-xl border bg-white p-10 text-center text-slate-500">Loading saved KPI records…</div> : error ? <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}<button className="ml-3 underline" onClick={load}>Try again</button></div> : data && <>
      {data.sourceStatus?.failedCollections?.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><strong>Saved records are temporarily unavailable.</strong> The dashboard opened with available non-demo session records; totals may be incomplete. Failed data sources: {data.sourceStatus.failedCollections.join(', ')}. Refresh when the connection is restored.</div>}
      {data.quality.recordsAvailable === 0 && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">No operational checks are available in this view yet. Demo activity is excluded.</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{usageCards.map(([title, value, sub, click]: any) => <button key={title} onClick={click} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-purple-300"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</div><div className="mt-2 text-3xl font-black text-[#3B1A5E]">{value}</div><div className="mt-1 text-xs text-slate-500">{sub}</div></button>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        {bars('Saved checks by day', data.usage.daily, r => open(`Saved checks on ${r.date}`, data.records.checks.filter((c: any) => (c.timestamp || '').slice(0, 10) === r.date)), 'date')}
        {bars('Most common errors (product and issue)', data.errors, r => open(r.label, recordsForError(r.label)))}
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3"><h3 className="font-bold text-slate-800">Agent use per day</h3><p className="text-xs text-slate-500">Each row is a saved check. Extension checks with no agent name appear as Unknown agent.</p></div>{data.usage.agentsByDay.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Date','Agent','App checks','Extension checks','Total uses'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{data.usage.agentsByDay.map((r: any) => <tr key={`${r.date}-${r.agent}`} className="border-t"><td className="p-3">{r.date}</td><td className="p-3">{r.agent}</td><td className="p-3">{r.appUses}</td><td className="p-3">{r.extensionUses}</td><td className="p-3"><button className="font-bold text-purple-800 underline" onClick={() => open(`${r.agent} checks on ${r.date}`, data.records.checks.filter((c: any) => (c.timestamp || '').slice(0, 10) === r.date && (c.user || c.ccaUser || 'Unknown agent') === r.agent))}>{r.uses}</button></td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-500">No agent activity in this date range.</p>}</section>
      <div className="grid gap-4 md:grid-cols-3"><section className="rounded-xl border bg-white p-4"><h3 className="font-bold">Issue resolution</h3><p className="mt-3 text-sm">Issue checks resolved: {data.usage.issueChecksResolved} / {data.usage.issueChecksEntered} ({pct({ rate: data.usage.issueChecksEntered ? data.usage.issueChecksResolved / data.usage.issueChecksEntered : null })})</p><p className="mt-1 text-sm">Median resolution time: {data.timing.resolutionMedianSeconds == null ? '—' : `${(data.timing.resolutionMedianSeconds / 3600).toFixed(1)} hours`}</p></section><section className="rounded-xl border bg-white p-4"><h3 className="font-bold">Saved checks</h3><p className="mt-3 text-sm">Total: {data.counts.checks}</p><p className="mt-1 text-sm">Unique orders with stable IDs: {data.counts.uniqueOrders}</p><p className="mt-1 text-sm">Checks without stable order ID: {data.quality.excludedUniqueOrders}</p></section><section className="rounded-xl border bg-amber-50 p-4"><h3 className="font-bold text-amber-900">Data quality</h3><p className="mt-2 text-sm">Invalid / incomplete checks excluded from affected counts: {data.quality.excludedInvalid}</p><p className="text-sm">Missing required fields: {Object.values(data.quality.missingFields).reduce((a: number,b: any) => a + Number(b), 0)}</p><p className="mt-2 text-xs text-amber-800">Blocked checks are shown as checks. They are not counted as prevented errors.</p></section></div>
    </>}
    {detailRows && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3" onClick={() => setDetailRows(null)}><section className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}><header className="flex items-center justify-between border-b p-4"><div><h2 className="font-bold">{detailTitle}</h2><p className="text-xs text-slate-500">{detailRows.length} supporting checks</p></div><button aria-label="Close supporting checks" onClick={() => setDetailRows(null)}><X/></button></header><div className="overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Date','App source','District','Facility','Agent','Result','Issues','Status'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{detailRows.map((r,i) => <tr key={r.id || i} className="border-t"><td className="p-3">{r.timestamp || '—'}</td><td className="p-3">{r.clientSource === 'companion_extension' ? 'Extension' : r.clientSource === 'legacy_or_unknown' ? 'Legacy / unknown' : 'Order Checker app'}</td><td className="p-3">{r.district || '—'}</td><td className="p-3">{r.facility || r.facilityName || '—'}</td><td className="p-3">{r.user || r.ccaUser || 'Unknown agent'}</td><td className="p-3">{r.auditResult || (r.allMatch ? 'PASS' : 'Issues')}</td><td className="p-3">{r.issueCount ?? '—'}</td><td className="p-3">{r.status || '—'}</td></tr>)}</tbody></table></div></section></div>}
  </div>;
}
