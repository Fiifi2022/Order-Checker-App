import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Plus, RefreshCw, Search, Trash2, Undo2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import type { GeneralFacilityDirectoryResponse, ManagedGeneralFacility } from '../../shared/generalFacilityDirectory';

const empty = () => ({ name: '', district: '', region: '', facilityType: '' });
const pageSize = 25;
export default function GeneralFacilityManager({ onUpdated, request = authFetch }: {
  onUpdated: () => void;
  request?: typeof authFetch;
}) {
  const [directory, setDirectory] = useState<GeneralFacilityDirectoryResponse | null>(null);
  const [draft, setDraft] = useState(empty);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removed, setRemoved] = useState<ManagedGeneralFacility | null>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const loadSequence = useRef(0);
  const load = async (signal?: AbortSignal) => {
    if (inFlight.current && !signal) return;
    const sequence = ++loadSequence.current;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await request('/api/general/facilities', { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load facilities.');
      if (alive.current && sequence === loadSequence.current && !signal?.aborted) { setDirectory(data); setRemoved(null); }
    } catch (cause: any) {
      if (alive.current && sequence === loadSequence.current && !signal?.aborted) setError(cause.message || 'Could not load facilities.');
    } finally {
      if (sequence === loadSequence.current) { inFlight.current = false; if (alive.current) setBusy(false); }
    }
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { alive.current = false; controller.abort(); };
  }, []);
  const save = async (method: 'POST' | 'DELETE', values: Record<string, unknown>, facility?: ManagedGeneralFacility) => {
    if (!directory?.canEdit || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await request('/api/general/facilities', { method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, revision: directory.revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the facility list.');
      // Invalidate in-flight audits even if the user left this panel while saving.
      onUpdated();
      if (alive.current) {
        setDirectory(data);
        if (method === 'DELETE') { setRemoved(facility!); setMessage(`${facility!.name} removed from the reference list.`); }
        else { setRemoved(null); setMessage(values.action === 'restore' ? 'Facility restored.' : 'Facility added.'); setDraft(empty()); }
      }
    } catch (cause: any) { if (alive.current) setError(cause.message || 'Could not save facilities.'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return (directory?.facilities || []).filter(record => [record.name, record.district, record.region, record.facilityType]
      .some(value => value?.toLowerCase().includes(needle)));
  }, [directory, query]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const inputClass = 'block w-full mt-1 rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:bg-slate-50';
  return <section className="space-y-4" aria-label="Manage General Auditor facilities">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-bold text-[#3B1A5E] flex items-center gap-2"><Building2 size={18} />Facility reference</h3>
        <p className="text-sm text-slate-600 mt-1">Add or remove facilities used in General Auditor comparisons.</p></div>
      <button type="button" disabled={busy} onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm text-purple-800 disabled:opacity-50"><RefreshCw size={14} />Reload facilities</button>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
      <span>{message}</span>{removed && directory?.canEdit && <button type="button" disabled={busy} onClick={() => void save('POST', { action: 'restore', key: removed.key })} className="inline-flex items-center gap-1 font-semibold underline disabled:opacity-50"><Undo2 size={14} />Undo removal</button>}
    </div>}
    {directory?.canEdit && <form onSubmit={event => { event.preventDefault(); void save('POST', draft); }} className="rounded-2xl border border-purple-100 bg-purple-50/40 p-4">
      <fieldset disabled={busy} className="space-y-3"><legend className="text-sm font-bold text-purple-900 mb-2">Add a facility</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold text-slate-700">Facility name<input name="name" required maxLength={160} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Kotoso RCH" className={inputClass} /></label>
          <label className="text-xs font-semibold text-slate-700">District (optional)<input name="district" maxLength={160} value={draft.district} onChange={event => setDraft({ ...draft, district: event.target.value })} className={inputClass} /></label>
          <label className="text-xs font-semibold text-slate-700">Region (optional)<input name="region" maxLength={160} value={draft.region} onChange={event => setDraft({ ...draft, region: event.target.value })} className={inputClass} /></label>
          <label className="text-xs font-semibold text-slate-700">Facility type (optional)<input name="facilityType" maxLength={160} value={draft.facilityType} onChange={event => setDraft({ ...draft, facilityType: event.target.value })} placeholder="e.g. CHPS, Health Centre" className={inputClass} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus size={15} />Add facility</button>
          <p className="text-xs text-slate-500">Include the district and region to distinguish facilities with similar names.</p></div>
      </fieldset>
    </form>}
    {directory && !directory.canEdit && <p className="text-sm text-slate-600">View access. Administrator, Warehouse and Compliance roles can add or remove facilities.</p>}
    <div className="rounded-2xl border border-purple-100 bg-white overflow-hidden">
      <div className="p-4 flex flex-wrap gap-3 items-center justify-between border-b border-purple-100">
        <label className="relative block flex-1 min-w-[180px]"><span className="sr-only">Search facilities</span><Search size={15} className="absolute left-3 top-3 text-slate-400" />
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search name, district or region" className="w-full rounded-lg border border-purple-200 py-2 pl-9 pr-3 text-sm" /></label>
        <p className="text-xs text-slate-500" role="status">{directory ? `${filtered.length.toLocaleString()} of ${directory.facilities.length.toLocaleString()} facilities` : 'Loading facilities…'}</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">General Auditor facility reference list</caption>
        <thead className="bg-purple-50/50 text-xs text-purple-900"><tr>{['Facility', 'District', 'Region', 'Type'].map(label => <th key={label} scope="col" className="px-4 py-3 font-semibold">{label}</th>)}{directory?.canEdit && <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody className="divide-y divide-purple-50">{visible.map(record => <tr key={record.key}>
          <th scope="row" className="px-4 py-3 font-medium text-slate-800">{record.name}</th><td className="px-4 py-3 text-slate-600">{record.district || '—'}</td><td className="px-4 py-3 text-slate-600">{record.region || '—'}</td><td className="px-4 py-3 text-slate-600">{record.facilityType || '—'}</td>
          {directory?.canEdit && <td className="px-4 py-3 text-right"><button type="button" disabled={busy} aria-label={`Remove ${record.name}${record.district ? ` in ${record.district}` : ''}`} onClick={() => void save('DELETE', { key: record.key }, record)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} />Remove</button></td>}
        </tr>)}</tbody>
      </table></div>
      {directory && !visible.length && <p className="p-6 text-sm text-slate-500">{query ? 'No facilities match your search.' : 'No facilities on the reference list yet.'}</p>}
      {filtered.length > pageSize && <div className="border-t border-purple-100 px-4 py-3 flex items-center justify-between text-xs text-slate-600">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button>
        <span>Page {currentPage + 1} of {lastPage + 1}</span><button type="button" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button>
      </div>}
    </div>
  </section>;
}
