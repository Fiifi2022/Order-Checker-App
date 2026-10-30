// Use the same source evidence, catalog revision, and order-limit decisions as the portal.
export function auditBody(whatsappMessage, fulfillmentConfirmation, revision, decisions = {}, previousAudit) {
  return { whatsappMessage, fulfillmentConfirmation, auditScope: 'general_auditor', includeProductCatalog: true, productCatalogRevision: revision,
    generalOrderLimitDecisions: decisions, checkSource: 'companion_extension', checkId: previousAudit?.generalAudit && previousAudit.id || `EXT-${crypto.randomUUID()}`,
    ...(previousAudit?.generalAudit && previousAudit.id ? { restoreProductConfirmations: true } : {}) };
}
export function profileRoles(profile) {
  const labels = { admin: 'Administrator', warehouse: 'Warehouse', dco: 'Warehouse', cca: 'CCA', auditor: 'Compliance' };
  return [...new Set((profile.roles ?? [profile.role]).filter(role => labels[role]).map(role => labels[role]))].join(' + ');
}

// Both clients require the catalogue-ID matcher before showing a live verdict.
export function requireCatalogAuditResponse(data) {
  if (data?.auditEngine !== 'general-catalog-v3') {
    throw new Error('The audit service needs the updated catalogue matcher. Update the backend and retry.');
  }
  return data;
}
