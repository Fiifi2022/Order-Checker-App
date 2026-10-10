import { assignedRoles } from '../../shared/roles';
import React, { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import type { ManagedAccount } from '../types';

export default function AdminAccounts({ onAssignRole, onUpdated }: {
  onAssignRole: (account: ManagedAccount) => void;
  onUpdated: () => void;
}) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ManagedAccount | null>(null);
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [nest, setNest] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recovery, setRecovery] = useState<{ type: string; link: string } | null>(null);
  const read = async (url: string, init?: RequestInit) => {
    const response = await authFetch(url, init);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not complete the account action.');
    return data;
  };
  const load = async (append = false) => {
    setLoading(true); setError('');
    try {
      // Reload all previously loaded pages so edited accounts remain visible.
      let next = append ? cursor : null;
      let list: ManagedAccount[] = append ? accounts : [];
      const target = append ? 0 : accounts.length;
      do {
        const data = await read(`/api/admin/accounts${next ? `?cursor=${encodeURIComponent(next)}` : ''}`);
        list = [...list, ...data.accounts];
        next = data.nextCursor;
      } while (!append && next && list.length < target);
      setAccounts(list); setCursor(next);
      if (selected) setSelected(list.find(account => account.uid === selected.uid) || null);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const choose = (account: ManagedAccount) => {
    setSelected(account); setName(account.name); setPosition(account.position); setNest(account.nest);
    setPassword(''); setConfirmation(''); setRecovery(null); setError(''); setNotice('');
  };
  const mutate = async (work: () => Promise<void>, message: string) => {
    setBusy(true); setError(''); setNotice(''); setRecovery(null);
    try { await work(); setNotice(message); await load(); onUpdated(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  };
  const accountAction = (action: string) => read(`/api/admin/accounts/${encodeURIComponent(selected!.uid)}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'password' ? { password } : {}) }),
  });
  const runAction = (action: string, message: string) => { void mutate(async () => { await accountAction(action); }, message); };
  const getLink = (action: string) => { void mutate(async () => {
    const result = await accountAction(action);
    setRecovery({ type: action === 'reset_link' ? 'Password reset' : 'Email verification', link: result.link });
  }, 'Recovery link created. Share it privately with this account holder.'); };
  const visible = accounts.filter(account => {
    const matches = `${account.name} ${account.email} ${account.position} ${account.nest}`.toLowerCase().includes(search.toLowerCase());
    return matches && (filter === 'all' || (filter === 'pending' && !account.role) || (filter === 'disabled' && account.disabled) || (filter === 'unverified' && !account.emailVerified));
  });
  const date = (value: string) => value ? new Date(value).toLocaleString() : 'Never';
  return <section className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-900">Account administration</h3><p className="text-xs text-slate-600">View sign-ups, fix profiles, and manage account access.</p></div><button disabled={loading || busy} onClick={() => { void load(); }} className="flex items-center gap-1 text-sm text-purple-800 disabled:opacity-50"><RefreshCw size={16} />Refresh</button></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        <label className="relative block"><span className="sr-only">Search loaded accounts</span><Search className="absolute left-3 top-3 text-slate-400" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search loaded accounts" className="w-full rounded-xl border border-slate-200 p-2.5 pl-9 text-sm" /></label>
        <select aria-label="Filter accounts" value={filter} onChange={e => setFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"><option value="all">All accounts</option><option value="pending">Awaiting approval</option><option value="unverified">Email unverified</option><option value="disabled">Disabled</option></select>
        <p className="text-xs text-slate-500">{visible.length} shown · {accounts.length} loaded{cursor ? ' · more available' : ''}</p>
        <div className="max-h-[540px] overflow-y-auto space-y-2">
          {visible.map(account => <button key={account.uid} disabled={busy || loading} onClick={() => choose(account)} className={`w-full text-left rounded-xl border p-3 ${selected?.uid === account.uid ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <strong className="block text-sm text-slate-900">{account.name || 'Profile incomplete'}</strong><span className="block text-xs text-slate-600 break-all">{account.email || 'No email'}</span><span className="block text-xs text-slate-500 mt-1">{account.position || 'No position'} · {account.nest || 'No Nest'}</span><span className="block text-xs font-semibold mt-2 text-purple-800">{account.disabled ? 'Disabled' : assignedRoles(account).join(' + ') || 'Awaiting approval'} · {account.emailVerified ? 'Email verified' : 'Email unverified'}</span>
          </button>)}
          {loading && <p role="status" className="p-3 text-sm text-slate-500">Loading accounts…</p>}
          {!loading && !visible.length && <p className="p-3 text-sm text-slate-500">No matching accounts.</p>}
        </div>
        {cursor && <button disabled={busy || loading} onClick={() => { void load(true); }} className="w-full border border-purple-200 p-2 rounded-xl text-sm text-purple-800 disabled:opacity-50">Load more accounts</button>}
      </div>
      {selected ? <div className="rounded-2xl border border-slate-200 p-4 space-y-5">
        <div><h4 className="font-bold text-slate-900">{selected.name || selected.email}</h4><p className="text-xs text-slate-600 break-all">{selected.email}</p><p className="mt-2 text-xs text-slate-500">Signed up: {date(selected.createdAt)}<br />Last sign-in: {date(selected.lastSignInAt)}<br />Sign-in method: {selected.providers.join(', ') || 'Unknown'}</p></div>
        <form onSubmit={e => { e.preventDefault(); void mutate(async () => { await read(`/api/admin/accounts/${encodeURIComponent(selected.uid)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, position, nest }) }); }, 'Account profile updated.'); }}>
          <fieldset disabled={busy || loading} className="space-y-3">
            {([{ label: 'Name', value: name, change: setName }, { label: 'Position', value: position, change: setPosition }, { label: 'Nest', value: nest, change: setNest }]).map(field => <label key={field.label} className="block text-xs font-bold text-slate-700">{field.label}<input required maxLength={100} value={field.value} onChange={e => field.change(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg p-2 text-sm font-normal" /></label>)}
            <button className="rounded-lg bg-purple-800 px-4 py-2 text-sm font-semibold text-white">Save profile</button>
          </fieldset>
        </form>
        <div className="border-t border-slate-100 pt-4 space-y-3"><p className="text-sm">Access roles: <strong>{assignedRoles(selected).join(' + ') || 'Unassigned'}</strong></p><button disabled={busy || loading} onClick={() => onAssignRole(selected)} className="rounded-lg border border-purple-200 px-3 py-2 text-sm text-purple-800">{selected.role ? 'Update role' : 'Approve and assign role'}</button></div>
        <div className="border-t border-slate-100 pt-4 space-y-3"><h5 className="text-sm font-bold">Password and recovery</h5>
          {selected.providers.includes('password') ? <>
            <button disabled={busy || loading} onClick={() => getLink('reset_link')} className="text-sm text-purple-800 underline">Create password reset link</button>
            <form onSubmit={e => { e.preventDefault(); if (password !== confirmation) { setError('Passwords do not match.'); return; } void mutate(async () => { try { await accountAction('password'); } finally { setPassword(''); setConfirmation(''); } }, 'Password updated. The user must sign in again.'); }}><fieldset disabled={busy || loading} className="space-y-2">
              <label className="block text-xs font-bold">New password<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg p-2 text-sm" /></label>
              <label className="block text-xs font-bold">Confirm password<input required type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg p-2 text-sm" /></label>
              <button className="rounded-lg border border-purple-200 px-3 py-2 text-sm text-purple-800">Set new password</button>
            </fieldset></form>
          </> : <p className="text-xs text-slate-600">Google passwords are managed through Google. Use the account controls below to resolve access problems.</p>}
          {!selected.emailVerified && <button disabled={busy || loading} onClick={() => getLink('verification_link')} className="block text-sm text-purple-800 underline">Create email verification link</button>}
          {recovery && <div className="rounded-xl bg-amber-50 p-3 space-y-2"><label className="block text-xs font-bold text-amber-900">{recovery.type} link<input readOnly value={recovery.link} onFocus={e => e.target.select()} className="mt-2 w-full rounded-lg border border-amber-200 p-2 text-xs" /></label><button onClick={() => { void navigator.clipboard.writeText(recovery.link).then(() => setNotice('Recovery link copied.')).catch(() => setError('Select the link and copy it manually.')); }} className="text-xs text-purple-800 underline">Copy link</button><p className="text-xs text-amber-800">This link is sensitive. Share it privately with the account holder.</p></div>}
        </div>
        <div className="border-t border-slate-100 pt-4 flex flex-wrap gap-2">
          <button disabled={busy || loading} onClick={() => runAction('revoke_sessions', 'Existing sessions revoked. The user must sign in again.')} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Sign out all sessions</button>
          <button disabled={busy || loading} onClick={() => runAction(selected.disabled ? 'enable' : 'disable', selected.disabled ? 'Account enabled.' : 'Account disabled. Access is blocked.')} className={`rounded-lg px-3 py-2 text-sm ${selected.disabled ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{selected.disabled ? 'Enable account' : 'Disable account'}</button>
        </div>
      </div> : <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-sm text-slate-500">Select an account to view its details and resolve sign-in problems.</div>}
    </div>
  </section>;
}
