import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export interface AuthProfile {
  id: string; email: string; name: string; role: string; district: string; createdAt: string;
}
export const actorContext = new AsyncLocalStorage<AuthProfile>();
const roles = new Set(['admin', 'warehouse', 'dco', 'cca', 'auditor']);
export function canAccess(role: string, method: string, path: string) {
  if (path === '/roles/switch') return false;
  if (role === 'admin') return true;
  if (path === '/admin' || path.startsWith('/admin/')) return false;
  if (path.startsWith('/roles') && method !== 'GET') return false;
  if (/clear|reset-demo/.test(path)) return false;
  if (method === 'GET') return true;
  if (['/activity/log', '/verify', '/scan-screenshot', '/vaccine/validate'].includes(path)) return true;
  if (role === 'auditor') return false;
  if (/topup|\/adjust$|dhd-inventory\/stock/.test(path)) return ['warehouse', 'dco'].includes(role);
  if (/blueprint|\/upload$|\/facilities\//.test(path)) return false;
  return ['cca', 'warehouse', 'dco'].includes(role);
}
export function createAuthentication(
  verify: (token: string) => Promise<any>,
  findProfile: (email: string) => Promise<AuthProfile | null>,
): RequestHandler {
  return async (req, res, next) => {
    if (req.path === '/health' && req.method === 'GET') { next(); return; }
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
    if (!match) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
    let identity: any;
    try { identity = await verify(match[1]); }
    catch { res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); return; }
    const registrationRequest = (req.path === '/auth/register' && req.method === 'POST') || (req.path === '/auth/registration' && req.method === 'GET');
    if (registrationRequest) {
      if (!identity.uid || !identity.email || identity.firebase?.sign_in_provider === 'anonymous') {
        res.status(403).json({ error: 'Sign in with an email account to complete your profile.' }); return;
      }
      res.locals.identity = identity;
      next(); return;
    }
    if (!identity.email || identity.email_verified !== true || identity.firebase?.sign_in_provider === 'anonymous') {
      res.status(403).json({ error: 'A verified email account is required.' }); return;
    }
    let profile: AuthProfile | null;
    try { profile = await findProfile(identity.email.toLowerCase()); }
    catch { res.status(503).json({ error: 'Account access could not be verified. Please retry.' }); return; }
    if (!profile || !roles.has(profile.role)) {
      res.status(403).json({ error: 'Your account has not been granted access. Contact an administrator.' }); return;
    }
    if (!canAccess(profile.role, req.method, req.path)) {
      res.status(403).json({ error: 'Your role does not permit this action.' }); return;
    }
    res.locals.authUser = profile;
    // Never accept a caller-supplied operating identity for writes.
    if (req.body && typeof req.body === 'object') {
      req.body.actor = profile;
      req.body.user = profile.name;
      req.body.ccaUser = profile.name;
      req.body.addedBy = profile.name;
    }
    actorContext.run(profile, next);
  };
}
