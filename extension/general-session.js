import { generalInputFingerprint, sameGeneralAuditSources } from './general-auditor.js';

// Session storage is private to extension pages and scoped to the signed-in account.
export async function rememberGeneralAudit(record, backendUrl) {
  if (!record?.generalAudit || !record.id) return;
  try {
    const { authSession } = await chrome.storage.session.get('authSession');
    if (!authSession?.email) return;
    await chrome.storage.session.set({ generalAuditSnapshot: { id: record.id, backendUrl, email: authSession.email, fingerprint: generalInputFingerprint(record) } });
  } catch { /* Audit history on the server remains authoritative. */ }
}
export async function restoreGeneralAudit(request, backendUrl, sources) {
  try {
    const { authSession, generalAuditSnapshot: snapshot } = await chrome.storage.session.get(['authSession', 'generalAuditSnapshot']);
    if (!snapshot || snapshot.email !== authSession?.email || snapshot.backendUrl !== backendUrl || snapshot.fingerprint !== generalInputFingerprint(sources)) return null;
    const record = await request(`/api/audits/${encodeURIComponent(snapshot.id)}`);
    if (record?.id !== snapshot.id || !record.generalAudit || !sameGeneralAuditSources(record, sources)) return null;
    return record;
  } catch { return null; }
}
