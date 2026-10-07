import React, { useEffect, useRef, useState } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification, signInWithEmailAndPassword, updateProfile, type User } from 'firebase/auth';
import { ShieldCheck, LogOut } from 'lucide-react';
import { auth, loginWithGoogle, logoutUser } from '../firebase';
import { authFetch } from '../utils/authFetch';
import type { UserRegistration, UserRoleRecord } from '../types';

function errorMessage(error: any) {
  const messages: Record<string, string> = {
    'auth/popup-blocked': 'Allow popups in your browser, then try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled. Please try again.',
    'auth/unauthorized-domain': 'This site needs to be added to Firebase’s authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method needs to be enabled in Firebase.',
    'auth/network-request-failed': 'Check your connection and try again.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/user-not-found': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'This email already has an account. Use Sign in.',
    'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
  };
  return messages[error?.code] || error?.message || 'Could not complete this request. Please retry.';
}
export default function AuthGate({ children }: { children: (profile: UserRoleRecord) => React.ReactNode }) {
  const [profile, setProfile] = useState<UserRoleRecord | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [registration, setRegistration] = useState<UserRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [nest, setNest] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const loadAccount = async (account: User | null) => {
    const current = ++generation.current;
    setProfile(null); setUser(account); setRegistration(null); setLoading(true);
    try {
      if (!account) return;
      const response = await authFetch('/api/auth/registration');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load your profile.');
      if (current !== generation.current) return;
      setRegistration(data);
      if (!account.emailVerified) return;
      const access = await authFetch('/api/auth/me');
      const assignedProfile = await access.json();
      if (current !== generation.current) return;
      if (access.ok) { setProfile(assignedProfile); setError(''); }
      else if (access.status !== 403) throw new Error(assignedProfile.error || 'Could not verify access.');
    } catch (err) { if (current === generation.current) setError(errorMessage(err)); }
    finally { if (current === generation.current) setLoading(false); }
  };
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, account => { void loadAccount(account); });
    const expired = () => { setProfile(null); setError('Your session has expired. Please sign in again.'); void logoutUser().catch(() => {}); };
    window.addEventListener('ordercheck-session-expired', expired);
    return () => { ++generation.current; unsubscribe(); window.removeEventListener('ordercheck-session-expired', expired); };
  }, []);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const saveProfile = async (account: User) => {
    const response = await authFetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, position, nest }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save your profile.');
    await updateProfile(account, { displayName: name.trim() });
    await loadAccount(account);
    setRegistration(data);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void action(async () => {
      if (user) { await saveProfile(user); setNotice('Your profile has been saved for administrator review.'); return; }
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        setPassword(''); return;
      }
      if ([name, position, nest].some(value => !value.trim())) throw new Error('Complete your name, position, and Nest.');
      if (password !== confirmation) throw new Error('Passwords do not match.');
      const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
      setPassword(''); setConfirmation('');
      await saveProfile(result.user);
      await sendEmailVerification(result.user);
      setNotice('Account created. Check your inbox for the verification link.');
    });
  };
  const profileFields = <>
    <label className="block text-sm font-medium text-slate-700">Full name<input required maxLength={100} autoComplete="name" value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="Your full name" /></label>
    <label className="block text-sm font-medium text-slate-700">Position<input required maxLength={100} value={position} onChange={e => setPosition(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="e.g. Customer Care Advocate" /></label>
    <label className="block text-sm font-medium text-slate-700">Nest<input required maxLength={100} value={nest} onChange={e => setNest(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="Your Nest" /></label>
  </>;
  if (profile && !loading) return <>{children(profile)}</>;
  return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
    <section className="w-full max-w-md bg-white border border-purple-100 rounded-3xl p-8 shadow-xl">
      <ShieldCheck className="w-12 h-12 text-purple-800 mb-4" />
      <h1 className="text-3xl font-bold text-slate-900">Welcome to OrderCheck</h1>
      <p className="mt-3 text-slate-600">Access your team’s order audits and vaccine allocations.</p>
      {error && <p role="alert" className="mt-5 p-3 rounded-xl bg-rose-50 text-rose-800 text-sm">{error}</p>}
      {notice && <p role="status" className="mt-5 p-3 rounded-xl bg-emerald-50 text-emerald-800 text-sm">{notice}</p>}
      {loading ? <p role="status" className="mt-6 text-slate-600">Checking your session…</p> : user ? <div className="mt-6 space-y-4">
        <p className="text-sm text-slate-600">Signed in as <strong>{user.email}</strong></p>
        {!registration && <form onSubmit={submit} className="space-y-4"><p className="text-sm text-slate-600">Complete your profile to request access.</p>{profileFields}<button disabled={busy} className="w-full rounded-xl bg-purple-800 text-white p-3 font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save profile'}</button></form>}
        {!user.emailVerified && <div className="space-y-3"><p className="text-sm text-slate-600">Verify your email using the link in your inbox before accessing OrderCheck.</p><button disabled={busy} onClick={() => { void action(async () => { await sendEmailVerification(user); setNotice('Verification email sent. Check your inbox.'); }); }} className="text-purple-800 text-sm underline disabled:opacity-50">Send verification email</button></div>}
        {registration && <div className="rounded-xl bg-purple-50 p-4 text-sm text-purple-900"><strong>Awaiting administrator approval</strong><p className="mt-2">{registration.name} · {registration.position} · {registration.nest}</p><p className="mt-2">An administrator will assign your access role.</p></div>}
        <button disabled={busy} onClick={() => { void action(async () => { await reload(user); await user.getIdToken(true); await loadAccount(user); }); }} className="w-full border border-purple-200 rounded-xl p-3 text-purple-800 disabled:opacity-50">{busy ? 'Checking…' : 'Check verification and access'}</button>
        <button disabled={busy} onClick={() => { void action(async () => { await logoutUser(); setName(''); setPosition(''); setNest(''); }); }} className="w-full flex items-center justify-center gap-2 p-3 text-slate-600"><LogOut size={16} />Sign out</button>
      </div> : <>
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          {(['signin', 'signup'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); setError(''); setNotice(''); }} className={`rounded-lg p-2 text-sm font-semibold ${mode === value ? 'bg-white text-purple-800 shadow-sm' : 'text-slate-600'}`}>{value === 'signin' ? 'Sign in' : 'Sign up'}</button>)}
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            {mode === 'signup' && profileFields}
            <label className="block text-sm font-medium text-slate-700">Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
            <label className="block text-sm font-medium text-slate-700">Password<input required type="password" minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" />{mode === 'signup' && <span className="text-xs text-slate-500">Use at least 8 characters.</span>}</label>
            {mode === 'signup' && <label className="block text-sm font-medium text-slate-700">Confirm password<input required type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>}
            <button className="w-full rounded-xl bg-purple-800 hover:bg-purple-900 text-white p-3 font-semibold disabled:opacity-50">{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
          </fieldset>
        </form>
        <div className="my-4 text-center text-xs text-slate-500">or</div>
        <button onClick={() => { void action(async () => { await loginWithGoogle(); }); }} disabled={busy} className="w-full rounded-xl border border-slate-300 hover:bg-slate-50 p-3 font-semibold disabled:opacity-50">Continue with Google</button>
        <p className="mt-5 text-xs text-slate-500">New accounts require email verification and administrator approval.</p>
      </>}
    </section>
  </main>;
}
