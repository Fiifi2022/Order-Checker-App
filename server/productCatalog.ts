import { productReceivingHints } from '../src/utils/productReceivingHints';
import { intentAliases } from '../shared/generalIntentAliases';
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { assignedRoles } from '../shared/roles';
import packaging from '../src/utils/generalPackagingCatalogue.json';
import { generalApprovedProductIdentities } from '../src/utils/generalMedicalTerminology';
import { setCatalogRevision, canManageCatalog, catalogKey, checkAliasConflicts, validateCatalogProduct, type CatalogProduct, type ProductCatalog } from '../shared/productCatalog';
import { generalMedicalTerminology } from '../src/utils/generalMedicalTerminology';
import { medicalProductAcronyms } from '../src/utils/medicalProductAcronyms';
import { applyGeneralCatalog } from '../src/utils/productCatalog';
import * as vaccineService from './vaccineService';

const productId = (scope: string, name: string) => createHash('sha256').update(`${scope}:${catalogKey(name)}`).digest('hex');
export function defaultProducts(): CatalogProduct[] {
  const general = new Map<string, CatalogProduct>();
  for (const term of generalMedicalTerminology) general.set(catalogKey(term.canonicalName), {
    id: productId('general', term.canonicalName), scope: 'general', name: term.canonicalName,
    category: term.category, aliases: [...term.aliases], contextualAliases: [...term.contextualAliases],
    note: term.note, terminology: { ...term },
  });
  for (const term of medicalProductAcronyms) {
    const key = catalogKey(term.name), existing = general.get(key);
    const aliases = [...new Set([...(existing?.aliases || []), ...term.aliases])];
    general.set(key, { ...existing, id: productId('general', term.name), scope: 'general', name: existing?.name || term.name,
      category: existing?.category || term.category, aliases,
      contextualAliases: [...new Set([...(existing?.contextualAliases || []), ...(term.contextual ? term.aliases : [])])],
      note: existing?.note || term.note || '', acronym: { category: term.category, contextual: !!term.contextual, aliases: [...term.aliases] },
    });
  }
  for (const row of intentAliases) {
    const key = catalogKey(row.name), existing = general.get(key);
    general.set(key, { ...existing, id: productId('general', row.name), scope: 'general', name: row.name,
      category: existing?.category || 'medicine', aliases: [...new Set([...(existing?.aliases || []), ...row.aliases])],
      contextualAliases: existing?.contextualAliases || [], note: existing?.note || '' });
  }
  for (const row of packaging) {
    const key = catalogKey(row.name);
    if (!general.has(key)) general.set(key, { id: productId('general', row.name), scope: 'general', name: row.name,
      category: 'product', aliases: [], contextualAliases: [], note: `Existing packaging reference: ${row.internalQuantity} units per package. Alias edits do not change this factor.` });
  }
  for (const identity of generalApprovedProductIdentities) {
    const key = catalogKey(identity.canonicalName), existing = general.get(key);
    general.set(key, { ...existing, id: productId('general', identity.canonicalName), scope: 'general', name: identity.canonicalName,
      category: existing?.category || 'biologic', aliases: [...new Set([...(existing?.aliases || []), ...identity.aliases])],
      contextualAliases: existing?.contextualAliases || [], note: existing?.note || '',
      terminology: { ...existing?.terminology, canonicalId: identity.canonicalId } });
  }
  return [...general.values(), ...Object.entries({ ...vaccineService.getAliases(), 'R21': ['R21', 'R21 vaccine'], 'Soloshot 0.05ml': ['Soloshot 0.05ml'], 'Soloshot 0.5ml': ['Soloshot 0.5ml'], 'Syringe and needle 2ml': ['Syringe and needle 2ml', 'Syringes and needles 2ml'], 'Syringe and needle 5ml': ['Syringe and needle 5ml', 'Syringes and needles 5ml'] }).map(([name, aliases]): CatalogProduct => ({
    id: productId('vaccine', name), scope: 'vaccine', name, category: /diluent|dropper/i.test(name) ? 'companion' : 'vaccine',
    aliases: [...aliases], contextualAliases: [], note: '',
  }))];
}
export function applyCatalog(catalog: ProductCatalog) {
  setCatalogRevision(catalog.revision);
  applyGeneralCatalog(catalog.products);
  vaccineService.replaceAliases(Object.fromEntries(catalog.products.filter(product => product.scope === 'vaccine').map(product => [product.name, product.aliases])));
}
export function saveCatalogProduct(catalog: ProductCatalog, input: any, actor: string): ProductCatalog {
  if (input?.revision !== catalog.revision) throw Object.assign(new Error('The catalog changed. Reload it before saving.'), { status: 409 });
  const existing = input.id ? catalog.products.find(product => product.id === input.id) : undefined;
  if (input.id && !existing) throw Object.assign(new Error('Product not found. Reload the catalog.'), { status: 404 });
  const product = validateCatalogProduct(input, existing);
  if (!existing) product.id = productId(product.scope, product.name);
  if (!existing && catalog.products.some(other => other.id === product.id)) throw new Error('This product already exists. Edit its aliases instead.');
  checkAliasConflicts(product, catalog.products, existing);
  let products = existing ? catalog.products.map(other => other.id === product.id ? product : other) : [...catalog.products, product];
  if (existing?.linkedProductId && existing.linkedProductId !== product.linkedProductId) {
    products = products.map(other => other.id === existing.linkedProductId && other.linkedProductId === product.id ? { ...other, linkedProductId: '' } : other);
  }
  if (product.linkedProductId) {
    const counterpart = products.find(other => other.id === product.linkedProductId && other.scope !== product.scope);
    if (!counterpart) throw new Error('Choose an existing product in the other checker to sync with.');
    if (counterpart.linkedProductId && counterpart.linkedProductId !== product.id) throw new Error('The sync product is already linked to another catalog entry. Unlink it first.');
    const previous = new Set((existing?.aliases || []).map(catalogKey));
    const additions = product.aliases.filter(alias => !previous.has(catalogKey(alias)) || (product.fulfillmentSystemName !== existing?.fulfillmentSystemName && catalogKey(alias) === catalogKey(product.fulfillmentSystemName || '')));
    const receivingUpdates: Partial<CatalogProduct> = {};
    for (const field of ['fulfillmentSystemName', 'receivingDetails'] as const) {
      if (input[field] !== undefined && product[field] !== (existing?.[field] || '')) receivingUpdates[field] = product[field];
    }
    const updated = { ...counterpart, ...receivingUpdates, linkedProductId: product.id, aliases: [...new Map([...counterpart.aliases, ...additions].map(alias => [catalogKey(alias), alias])).values()],
      contextualAliases: [...new Set([...counterpart.contextualAliases, ...product.contextualAliases.filter(alias => additions.some(value => catalogKey(value) === catalogKey(alias)))])] };
    if (updated.scope === 'vaccine' && additions.some(alias => product.contextualAliases.some(value => catalogKey(value) === catalogKey(alias)))) throw new Error('Context-required abbreviations cannot sync to Vaccine Checker. Use an unambiguous alias.');
    checkAliasConflicts(updated, products, counterpart);
    products = products.map(other => other.id === counterpart.id ? updated : other);
  }
  return { revision: catalog.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor,
    products };
}
export function productCatalogHandlers(deps: {
  read: () => Promise<ProductCatalog>;
  save: (input: any, actor: string) => Promise<ProductCatalog>;
}) {
  const read: RequestHandler = async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { const catalog = await deps.read(); applyCatalog(catalog); res.json({ ...catalog, canEdit: canManageCatalog(assignedRoles(res.locals.authUser)), accessRoles: assignedRoles(res.locals.authUser) }); }
    catch { res.status(503).json({ error: 'Could not load the product catalog. Please retry.' }); }
  };
  const save: RequestHandler = async (req, res) => {
    if (!canManageCatalog(assignedRoles(res.locals.authUser))) { res.status(403).json({ error: 'Administrator, Warehouse, or Compliance access is required.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    try { const catalog = await deps.save(req.body, res.locals.authUser.email); applyCatalog(catalog); res.json({ ...catalog, canEdit: canManageCatalog(assignedRoles(res.locals.authUser)), accessRoles: assignedRoles(res.locals.authUser) }); }
    catch (error: any) { res.status(error.status || (error.code ? 503 : 400)).json({ error: error.code ? 'Could not save the product catalog. Please retry.' : error.message }); }
  };
  const hints: RequestHandler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['general', 'vaccine'].includes(req.body?.scope) || typeof req.body?.text !== 'string' || req.body.text.length > 100000) {
      res.status(400).json({ error: 'Choose a checker and provide at most 100,000 characters of order text.' }); return;
    }
    try {
      const catalog = await deps.read();
      res.json({ revision: catalog.revision, products: productReceivingHints(req.body.text, req.body.scope, catalog.products).map(product => ({
        id: product.id, name: product.displayName || product.name, fulfillmentSystemName: product.fulfillmentSystemName || '', receivingDetails: product.receivingDetails || '',
      })) });
    } catch { res.status(503).json({ error: 'Product receiving reminders unavailable. Please retry.' }); }
  };
  return { read, save, hints };
}
