export interface CatalogProduct {
  id: string;
  scope: 'general' | 'vaccine';
  name: string;
  displayName?: string;
  fulfillmentSystemName?: string;
  receivingDetails?: string;
  category: string;
  aliases: string[];
  contextualAliases: string[];
  note: string;
  linkedProductId?: string;
  // Preserve existing interpretation metadata when editing aliases.
  terminology?: Record<string, any>;
  acronym?: { category: 'medicine' | 'blood' | 'diagnostic'; contextual?: boolean; aliases?: string[] };
}
export interface ProductCatalog { aliasRecords?: CatalogAliasRecord[]; revision: number; products: CatalogProduct[]; updatedAt?: string; updatedBy?: string }
export const catalogKey = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/(?<=[a-z])-(?=[a-z])/g, ' ').replace(/\s+/g, ' ').trim();
export function catalogProductNames(product: CatalogProduct): string[] {
  const names = [product.name, product.displayName, product.fulfillmentSystemName, ...product.aliases]
    .filter((name): name is string => typeof name === 'string' && !!name.trim());
  return [...new Map(names.map(name => [catalogKey(name), name.trim()])).values()];
}
export function canManageCatalog(roles: readonly string[]) {
  return roles.some(role => ['admin', 'warehouse', 'dco', 'auditor'].includes(role));
}
export function validateCatalogProduct(input: any, existing?: CatalogProduct): CatalogProduct {
  if (!input || !['general', 'vaccine'].includes(input.scope) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160 || /[\r\n]/.test(input.name)) throw new Error('Enter a product name and choose a valid scope.');
  if (existing && (existing.name !== input.name.trim() || existing.scope !== input.scope)) throw new Error('Existing canonical names and scopes cannot be changed. Add a new product instead.');
  const list = (values: any) => {
    if (!Array.isArray(values) || values.length > 150 || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 160 || /[\r\n]/.test(value))) throw new Error('Aliases must be non-empty names, one per line (maximum 150).');
    return [...new Map(values.map((value: string) => [catalogKey(value), value.trim()])).values()] as string[];
  };
  const displayName = input.displayName ?? existing?.displayName ?? input.name.trim();
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 160 || /[\r\n]/.test(displayName)) throw new Error('Enter a product name of at most 160 characters.');
  const fulfillmentSystemName = input.fulfillmentSystemName ?? existing?.fulfillmentSystemName ?? '';
  const receivingDetails = input.receivingDetails ?? existing?.receivingDetails ?? '';
  if (typeof fulfillmentSystemName !== 'string' || fulfillmentSystemName.length > 160 || /[\r\n]/.test(fulfillmentSystemName)) throw new Error('Fulfillment System name must be one line, at most 160 characters.');
  if (typeof receivingDetails !== 'string' || receivingDetails.length > 2000) throw new Error('Receiving details must be at most 2,000 characters.');
  const labels = displayName.trim() !== input.name.trim() ? [displayName.trim()] : [];
  const aliases = list(Array.isArray(input.aliases) ? [...input.aliases, ...labels, ...(fulfillmentSystemName.trim() ? [fulfillmentSystemName.trim()] : [])] : input.aliases);
  const contextualAliases = list(input.contextualAliases ?? []);
  if (contextualAliases.some(alias => !aliases.some(value => catalogKey(value) === catalogKey(alias)))) throw new Error('Every context-required alias must also appear in the aliases list.');
  if (typeof input.category !== 'string' || !input.category.trim() || input.category.length > 60 || typeof input.note !== 'string' || input.note.length > 2000) throw new Error('Enter a category and a note of at most 2,000 characters.');
  if (input.linkedProductId !== undefined && (typeof input.linkedProductId !== 'string' || input.linkedProductId.length > 100)) throw new Error('Choose a valid sync product.');
  return { ...existing, fulfillmentSystemName: fulfillmentSystemName.trim(), receivingDetails: receivingDetails.trim(), linkedProductId: input.linkedProductId ?? existing?.linkedProductId ?? '', id: existing?.id || '', scope: input.scope, name: input.name.trim(), displayName: displayName.trim(), category: input.category.trim(), aliases, contextualAliases, note: input.note.trim() };
}
export function checkAliasConflicts(product: CatalogProduct, products: CatalogProduct[], existing?: CatalogProduct) {
  const previous = new Set(existing ? catalogProductNames(existing).map(catalogMatchLabelKey) : []);
  for (const alias of catalogProductNames(product)) {
    const key = catalogMatchLabelKey(alias);
    if (previous.has(key)) continue; // Preserve established contextual overlaps in the seed vocabulary.
    const conflict = products.find(other => other.id !== product.id && other.scope === product.scope && catalogProductNames(other).some(value => catalogMatchLabelKey(value) === key));
    if (conflict) throw new Error(`“${alias}” already belongs to ${conflict.name}. Use a more specific alias.`);
  }
}

let catalogRevision = 0;
export const getCatalogRevision = () => catalogRevision;
export function setCatalogRevision(revision: number) { catalogRevision = revision; }

export function catalogCounterpart(product: CatalogProduct, products: CatalogProduct[]): CatalogProduct | undefined {
  if (product.linkedProductId) return products.find(other => other.id === product.linkedProductId && other.scope !== product.scope);
  const matches = products.filter(other => other.scope !== product.scope &&
    (catalogKey(other.name) === catalogKey(product.name) ||
      (product.scope === 'vaccine' && other.aliases.some(alias => catalogKey(alias) === catalogKey(product.name))) ||
      (other.scope === 'vaccine' && product.aliases.some(alias => catalogKey(alias) === catalogKey(other.name)))));
  return matches.length === 1 ? matches[0] : undefined;
}

export interface AliasSuggestion { alias: string; kind: 'alias' | 'abbreviation'; requiresContext: boolean; reason: string }

export const catalogAliasKey = (value:string) => catalogKey(value).replace(/[^a-z0-9./+]+/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
/** Whole-label conflict detection only. Retains strengths, volumes and blood qualifiers. */
export const catalogMatchLabelKey = (value: string) => catalogAliasKey(value.replace(/\b[a-z](?:\.\s*[a-z])+\b(?:\.(?![a-z]))?/gi, match => match.replace(/[.\s]/g, '')));
export interface CatalogAliasRecord {
 id:string;productId:string;text:string;normalizedText:string;source:'catalogue'|'gemini'|'manual'|'deterministic';
 status:'pending'|'approved'|'rejected';active:boolean;createdAt:string|null;approvedAt:string|null;approvedBy:string|null;updatedAt:string|null;
 confidence?:number;clinicalUncertainty?:boolean;requiresContext?:boolean;reason?:string;
}
export interface CatalogAliasEvent {id:string;aliasId:string;action:string;actor:string;at:string;before:CatalogAliasRecord|null;after:CatalogAliasRecord}
