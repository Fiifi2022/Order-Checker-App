import type { RequestHandler } from 'express';
import { registrationFields } from './registration';

export interface ManagedAccount {
  uid: string; email: string; name: string; position: string; nest: string;
  emailVerified: boolean; disabled: boolean; providers: string[];
  createdAt: string; lastSignInAt: string; role: string | null; district: string;
}
export function accountSummary(user: any, profile: any, role: any): ManagedAccount {
  return {
    uid: user.uid, email: user.email || '', name: profile?.name || user.displayName || role?.name || '',
    position: profile?.position || role?.position || '', nest: profile?.nest || role?.nest || '',
    emailVerified: user.emailVerified === true, disabled: user.disabled === true,
    providers: (user.providerData || []).map((provider: any) => provider.providerId),
    createdAt: user.metadata?.creationTime || '', lastSignInAt: user.metadata?.lastSignInTime || '',
    role: role?.role || null, district: role?.district || '',
  };
}
export function adminAccountHandlers(deps: {
  list: (cursor?: string) => Promise<{ accounts: ManagedAccount[]; nextCursor: string | null }>;
  get: (uid: string) => Promise<any>;
  updateProfile: (uid: string, fields: ReturnType<typeof registrationFields>) => Promise<void>;
  updateAuth: (uid: string, update: any) => Promise<any>;
  revoke: (uid: string) => Promise<void>;
  resetLink: (email: string) => Promise<string>;
  verificationLink: (email: string) => Promise<string>;
  audit: (actor: any, uid: string, action: string) => Promise<void>;
}) {
  const guarded = (work: (req: any, res: any) => Promise<void>): RequestHandler => async (req, res) => {
    if (res.locals.authUser?.role !== 'admin') { res.status(403).json({ error: 'Administrator access is required.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    try { await work(req, res); }
    catch (error: any) {
      const messages: Record<string, [number, string]> = {
        'auth/user-not-found': [404, 'This account no longer exists. Refresh the account list.'],
        'auth/invalid-password': [400, 'Choose a stronger password.'],
        'auth/too-many-requests': [429, 'Too many requests. Please wait and retry.'],
      };
      const [status, message] = messages[error?.code] || [503, 'Could not complete the account action. Refresh the account details before retrying.'];
      res.status(status).json({ error: message });
    }
  };
  const list = guarded(async (req, res) => {
    const cursor = req.query.cursor;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048)) { res.status(400).json({ error: 'Invalid account page.' }); return; }
    res.json(await deps.list(cursor));
  });
  const profile = guarded(async (req, res) => {
    let fields: ReturnType<typeof registrationFields>;
    try { fields = registrationFields(req.body); }
    catch (error: any) { res.status(400).json({ error: error.message }); return; }
    await deps.updateProfile(req.params.uid, fields);
    await deps.audit(res.locals.authUser, req.params.uid, 'profile_updated');
    res.json({ success: true });
  });
  const action = guarded(async (req, res) => {
    const { action, password } = req.body || {};
    if (!['password', 'disable', 'enable', 'revoke_sessions', 'reset_link', 'verification_link'].includes(action)) {
      res.status(400).json({ error: 'Select a valid account action.' }); return;
    }
    const user = await deps.get(req.params.uid);
    if (action === 'disable' && user.email?.toLowerCase() === res.locals.authUser.email.toLowerCase()) {
      res.status(400).json({ error: 'You cannot disable your own administrator account.' }); return;
    }
    if (['password', 'reset_link'].includes(action) && !user.providerData?.some((provider: any) => provider.providerId === 'password')) {
      res.status(400).json({ error: 'This account uses Google sign-in. Its Google password must be changed through Google.' }); return;
    }
    if (action === 'password') {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        res.status(400).json({ error: 'The new password must contain 8–128 characters.' }); return;
      }
      await deps.updateAuth(user.uid, { password });
      await deps.revoke(user.uid);
    } else if (action === 'disable' || action === 'enable') {
      await deps.updateAuth(user.uid, { disabled: action === 'disable' });
    } else if (action === 'revoke_sessions') { await deps.revoke(user.uid); }
    else {
      if (!user.email) { res.status(400).json({ error: 'This account has no email address.' }); return; }
      const link = action === 'reset_link' ? await deps.resetLink(user.email) : await deps.verificationLink(user.email);
      await deps.audit(res.locals.authUser, user.uid, action);
      res.json({ success: true, link }); return;
    }
    await deps.audit(res.locals.authUser, user.uid, action);
    res.json({ success: true });
  });
  return { list, profile, action };
}
