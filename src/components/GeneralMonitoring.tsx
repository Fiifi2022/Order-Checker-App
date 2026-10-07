import { authFetch } from '../utils/authFetch';
import { useState } from 'react';
export default function GeneralMonitoring() {
  const [history, setHistory] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (diagnose = false) => {
    setBusy(true); setError('');
    try {
      const response = await authFetch(diagnose ? '/api/general-auditor/diagnostics' : '/api/general-auditor/history');
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'General Auditor monitoring unavailable.');
      if (diagnose) {
        setDiagnostics(data.services);
        try { const response = await authFetch('/api/gemini-status'); const result = await response.json(); setDiagnostics(previous => [...previous, { service: 'Gemini last known state', status: response.ok ? result.status.replaceAll('_', ' ') : 'Unavailable', detail: 'Reported from real audit usage; no Gemini request made.' }]); }
        catch { setDiagnostics(previous => [...previous, { service: 'Gemini API availability', status: 'Failed', detail: 'Stored status unavailable.' }]); }
      } else setHistory(data);
    } catch (error: any) { setError(error.message); } finally { setBusy(false); }
  };
  return <details className="bg-white border border-purple-100 rounded-xl p-4 text-xs">
    <summary className="font-semibold cursor-pointer">General Auditor history, analytics & diagnostics</summary>
    <div className="flex gap-3 my-3"><button disabled={busy} onClick={() => load()} className="rounded border p-2">Refresh history & analytics</button><button disabled={busy} onClick={() => load(true)} className="rounded border p-2">Run diagnostics</button></div>
    {busy && <p role="status">Checking services…</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
    {diagnostics.length > 0 && <ul className="space-y-1 mb-3">{diagnostics.map((row, index) => <li key={index}>{row.service}: <strong>{row.status}</strong>{row.detail && ` — ${row.detail}`}</li>)}</ul>}
    {history && <><p className="mb-2">History source: {history.source}. {history.warning}</p><dl className="grid sm:grid-cols-3 gap-2">{Object.entries(history.analytics).filter(([, value]) => !Array.isArray(value)).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="font-bold">{String(value)}{key.endsWith('Rate') ? '%' : ''}</dd></div>)}</dl>
      {['frequentlyMismatchedProducts', 'frequentlyOutOfStockProducts'].map(key => <p key={key} className="mt-2">{key.replace(/([A-Z])/g, ' $1')}: {history.analytics[key].map((row: any) => `${row.name} (${row.count})`).join(', ') || 'None'}</p>)}
      <div className="overflow-auto mt-4"><table className="w-full text-left"><thead><tr>{['Time', 'Facility', 'Orderer', 'Verdict', 'Issues', 'Stock / Limits / Supplied', 'Seconds', 'Resolution'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{history.records.map((row: any) => <tr key={row.id}><td className="p-2">{row.timestamp}</td><td>{row.facility}</td><td>{row.orderer || row.generalAudit.orderer.whatsappValue}</td><td>{row.generalAudit.finalStatus}</td><td>{row.issueCount}</td><td>{row.generalAudit.counts?.outOfStock ?? '—'} / {row.generalAudit.counts?.orderLimited ?? '—'} / {row.generalAudit.counts?.fullySupplied ?? '—'}</td><td>{row.durationSec}</td><td>{row.status}{row.resolutionNotes && `: ${row.resolutionNotes}`}</td></tr>)}</tbody></table></div>
      {!history.records.length && <p>No General Auditor records yet.</p>}</>}
  </details>;
}
