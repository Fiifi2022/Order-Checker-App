// Use the same source evidence, catalog revision, and order-limit decisions as the portal.
export function auditBody(whatsappMessage, fulfillmentConfirmation, revision, decisions = {}) {
  return { whatsappMessage, fulfillmentConfirmation, auditScope: 'general_auditor', productCatalogRevision: revision,
    generalOrderLimitDecisions: decisions, checkSource: 'companion_extension', checkId: `EXT-${crypto.randomUUID()}` };
}
export function profileRoles(profile) {
  const labels = { admin: 'Administrator', warehouse: 'Warehouse', dco: 'Warehouse', cca: 'CCA', auditor: 'Compliance' };
  return [...new Set((profile.roles ?? [profile.role]).filter(role => labels[role]).map(role => labels[role]))].join(' + ');
}
