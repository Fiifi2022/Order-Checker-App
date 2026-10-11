import { catalogKey, type CatalogProduct } from '../../shared/productCatalog';
import { parseGeneralProducts } from './generalAuditor';

/** Match whole product identities; never infer receiving instructions from a partial name. */
export function productReceivingHints(text: string, scope: CatalogProduct['scope'], products: CatalogProduct[]) {
  const names = new Set([
    ...text.split(/\r?\n/).map(line => catalogKey(line.replace(/^\s*[-•]\s*/, ''))),
    ...parseGeneralProducts(text, 'customer_request').map(item => catalogKey(item.name)),
    ...parseGeneralProducts(text, 'fulfillment_confirmation').map(item => catalogKey(item.name)),
  ]);
  const scoped = products.filter(product => product.scope === scope);
  const matched = new Map<string, CatalogProduct>();
  for (const name of names) {
    const candidates = scoped.filter(product => [product.name, product.displayName || '', product.fulfillmentSystemName || '',
      ...product.aliases.filter(alias => !product.contextualAliases.some(value => catalogKey(value) === catalogKey(alias)))
    ].some(label => label && catalogKey(label) === name));
    if (candidates.length === 1) matched.set(candidates[0].id, candidates[0]);
  }
  return [...matched.values()].filter(product => product.fulfillmentSystemName || product.receivingDetails);
}
