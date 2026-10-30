import { generalInputFingerprint, sameGeneralAuditSources } from './general-auditor.js';

// Session storage is private to extension pages and scoped to the signed-in account.
export async function rememberGeneralAudit(record, backendUrl) {
  if (!record?.generalAudit || !record.id) return;
  try {
    const { authSession } = await chrome.storage.session.get('authSession');
    if (!authSession?.email) return;
    await chrome.storage.session.set({ generalAuditSnapshot: { id: record.id, backendUrl, email: authSession.email, fingerprint: generalInputFingerprint(record), ...(record.storage?.status !== 'saved' ? {record} : {}) } });
  } catch { /* Audit history on the server remains authoritative. */ }
}
export async function restoreGeneralAudit(request, backendUrl, sources) {
  try {
    const { authSession, generalAuditSnapshot: snapshot } = await chrome.storage.session.get(['authSession', 'generalAuditSnapshot']);
    if (!snapshot || snapshot.email !== authSession?.email || snapshot.backendUrl !== backendUrl || snapshot.fingerprint !== generalInputFingerprint(sources)) return null;
    let record;
    try{record=await request(`/api/audits/${encodeURIComponent(snapshot.id)}`);}
    catch{record=snapshot.record;}
    if(snapshot.record && (!record || record.timestamp!==snapshot.record.timestamp || JSON.stringify(record.generalAudit?.orderLimitDecisions || {})!==JSON.stringify(snapshot.record.generalAudit.orderLimitDecisions || {})))record=snapshot.record;
    const current=await chrome.storage.session.get('authSession');
    if(current.authSession?.email!==snapshot.email)return null;
    if (record?.id !== snapshot.id || !record.generalAudit || !sameGeneralAuditSources(record, sources)) return null;
    return record;
  } catch { return null; }
}
