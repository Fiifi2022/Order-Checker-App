import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { assignedRoles } from '../shared/roles';
import { emptyGeneralProductAliases, generalProductAliasKey, type GeneralProductAliasState } from '../shared/generalProductAliases';
import type { ProductCatalog } from '../shared/productCatalog';
import { normalizeGeneralProductIdentityWithoutLearned, enforceGeneralProductAssignments } from '../src/utils/generalAuditor';
import { isGeneralBiologic } from '../src/utils/generalMedicalTerminology';
import { isGeneralBloodProduct } from '../src/utils/medicalProductAcronyms';
import { matchGeneralClinicalProducts } from '../src/utils/generalProductMatching';
import { generalAliasSafety } from '../src/utils/generalAliasSafety';

const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
export function changeGeneralProductAlias(state: GeneralProductAliasState, input: any, catalog: ProductCatalog, actor: { id: string; name: string }, at = new Date().toISOString()): GeneralProductAliasState {
  const previous = state.aliases.find(alias => alias.id === input.id);
  if (input.action !== 'approve' && !previous) fail('Alias not found.', 404);
  if (input.action !== 'approve' && input.revision !== state.revision) fail('The dictionary changed. Reload before editing.', 409);
  if (input.action === 'disable') return { revision: state.revision + 1, aliases: state.aliases.map(alias => alias === previous ? { ...alias, status: 'disabled', updatedAt: at, history: [...alias.history, { action: 'disabled', catalogProductId: alias.catalogProductId, actor, at }] } : alias) };
  if (!['approve', 'correct'].includes(input.action)) fail('Choose an alias action.');
  const wording = input.action === 'correct' ? previous!.originalWording : input.originalWording;
  if (typeof wording !== 'string' || !wording.trim() || wording.length > 500 || /\b(?:unknown|something|medicine|antibiotic)\b/i.test(wording)) fail('Establish a specific product name before learning it.');
  const product = catalog.products.find(product => product.scope === 'general' && product.id === input.catalogProductId);
  if (!product) fail('Choose an existing General Auditor catalogue product.');
  if ((isGeneralBiologic(product!.name) || isGeneralBloodProduct(product!.name)) && !matchGeneralClinicalProducts(wording, product!.name, normalizeGeneralProductIdentityWithoutLearned).confident) fail('Biologic and blood product identifiers must be established independently before learning wording.');
  const safety = generalAliasSafety(wording, product!.name, normalizeGeneralProductIdentityWithoutLearned);
  if (safety.conflicts.length) fail(`This wording conflicts with the catalogue ${safety.conflicts.join(', ')}. A per-order confirmation cannot approve this permanent alias.`);
  const normalizedAlias = generalProductAliasKey(wording);
  const duplicate = state.aliases.find(alias => alias.normalizedAlias === normalizedAlias && alias.id !== previous?.id);
  if (duplicate) {
    if (duplicate.status === 'approved' && duplicate.catalogProductId === product!.id) return state;
    fail('This wording already exists. Correct or reactivate its existing entry explicitly.', 409);
  }
  const alias = { id: previous?.id || createHash('sha256').update(normalizedAlias).digest('hex'), originalWording: wording.trim(), normalizedAlias,
    catalogProductId: product!.id, canonicalName: product!.name, resolvedDescription: safety.resolvedDescription,
    recognition: safety.complete ? 'complete' as const : 'identity only' as const, status: 'approved' as const,
    constraints: { measurements: safety.attributes.measurements, forms: safety.attributes.forms, routes: safety.attributes.routes, releases: safety.attributes.releases, qualifiers: safety.attributes.qualifiers },
    confirmedBy: actor, confirmedAt: at, updatedAt: at,
    history: [...(previous?.history || []), { action: previous ? 'corrected' as const : 'approved' as const, catalogProductId: product!.id, actor, at }] };
  return { revision: state.revision + 1, aliases: [...state.aliases.filter(other => other.id !== alias.id), alias] };
}

/** Resolve approval evidence from the saved audit, never a caller-supplied name. */
export function generalAliasApprovalEvidence(record: any, key: string, catalog: ProductCatalog) {
  if (record?.generalAudit && typeof record.whatsappMessage === 'string' && typeof record.fulfillmentConfirmation === 'string') record = enforceGeneralProductAssignments(record, record.whatsappMessage, record.fulfillmentConfirmation);
  const verification = record?.generalAudit?.productVerifications?.find((product: any) => product.key === key || product.candidateKeys?.includes(key));
  const item = record?.items?.find((item: any) => item.fulfillment?.key === key);
  const originalWording = verification?.productName || item?.provenance?.find((source: any) => source.source === 'customer_request')?.name;
  const name = verification?.confirmation?.productName || (item?.fulfillment?.productStatus === 'product match' ? item.provenance?.find((source: any) => source.source === 'fulfillment_confirmation')?.name : undefined);
  if (!record?.generalAudit || !originalWording || !name || verification && !verification.confirmation) fail('Confirm the product in the saved audit before learning its wording.');
  const exact = catalog.products.filter(product => product.scope === 'general' && product.name === name);
  const candidates = exact.length ? exact : catalog.products.filter(product => product.scope === 'general' && normalizeGeneralProductIdentityWithoutLearned(product.name) === normalizeGeneralProductIdentityWithoutLearned(name));
  if (candidates.length !== 1) fail('The confirmed product must identify one current catalogue entry.');
  return { originalWording, catalogProductId: candidates[0].id };
}
export function generalProductAliasHandlers(deps: {
  readCatalog: () => Promise<ProductCatalog>; readAudit: (id: string) => Promise<any>;
  change: (input: any, actor: { id: string; name: string }) => Promise<GeneralProductAliasState>;
}) {
  const read: RequestHandler = async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { const catalog = await deps.readCatalog(); res.json({ ...(catalog.productNameAliases || emptyGeneralProductAliases()), products: catalog.products.filter(product => product.scope === 'general') }); }
    catch { res.status(503).json({ error: 'Could not load the name dictionary. Please retry.' }); }
  };
  const save: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const actor = res.locals.authUser;
    if (!assignedRoles(actor).some(role => ['admin', 'cca', 'warehouse', 'dco', 'auditor'].includes(role))) { res.status(403).json({ error: 'Authorized product verification access is required.' }); return; }
    try {
      let input = req.body || {};
      if (input.action === 'approve') {
        if (input.approvePermanently !== true || typeof input.auditId !== 'string' || typeof input.key !== 'string') fail('Explicitly approve learning from a saved audit.');
        const evidence = generalAliasApprovalEvidence(await deps.readAudit(input.auditId), input.key, await deps.readCatalog());
        input = { action: 'approve', ...evidence };
      }
      const state = await deps.change(input, { id: actor.id, name: actor.name });
      res.json(state);
    } catch (error: any) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Could not save the dictionary. Please retry.' }); }
  };
  return { read, save };
}
