import { catalogAliasKey, catalogKey, catalogMatchLabelKey, catalogProductNames, type CatalogProduct, type ProductCatalog } from './productCatalog';

export interface CatalogHealthIssue {
  id: string;
  code: 'duplicate_id' | 'duplicate_product' | 'name_overlap' | 'alias_conflict' | 'contextual_overlap' | 'invalid_product' | 'invalid_context_alias' |
    'broken_link' | 'conflicting_link' | 'one_way_link' | 'orphan_alias' | 'alias_record_conflict' | 'alias_record_drift';
  severity: 'error' | 'warning';
  title: string;
  explanation: string;
  productIds: string[];
  labels: string[];
}
export interface CatalogHealthReport {
  revision: number;
  productCount: number;
  pendingAliasCount: number;
  errorCount: number;
  warningCount: number;
  affectedProductCount: number;
  issues: CatalogHealthIssue[];
}

/** Pure repository checks: no AI, clinical substitutions, writes or automatic merges. */
export function inspectCatalogHealth(catalog: ProductCatalog): CatalogHealthReport {
  const issues: CatalogHealthIssue[] = [];
  const add = (code: CatalogHealthIssue['code'], severity: CatalogHealthIssue['severity'], title: string, explanation: string, products: CatalogProduct[], labels: string[] = []) => {
    const productIds = [...new Set(products.map(product => product.id))].sort();
    const uniqueLabels = [...new Set(labels)].sort();
    issues.push({id:JSON.stringify([code, productIds, uniqueLabels.map(catalogMatchLabelKey)]),code,severity,title,explanation,productIds,labels:uniqueLabels});
  };
  const byId = new Map<string, CatalogProduct[]>();
  const validProducts=new Set<CatalogProduct>();
  const labels = new Map<string, {product: CatalogProduct; names: string[]; contextual: boolean}[]>();
  const canonicals = new Map<string, CatalogProduct[]>();
  for (const product of catalog.products) {
    byId.set(product.id,[...(byId.get(product.id) || []),product]);
    if (typeof product.id!=='string' || !product.id.trim() || typeof product.name!=='string' || !product.name.trim() || typeof product.category!=='string' || !product.category.trim() || !['general','vaccine'].includes(product.scope) ||
      !Array.isArray(product.aliases) || !Array.isArray(product.contextualAliases) || [...product.aliases,...product.contextualAliases].some(alias=>typeof alias!=='string' || !alias.trim())) {
      add('invalid_product','error','Incomplete product record','A product ID, canonical name, category, checker and valid alias lists are required.',[product]);
      continue;
    }
    validProducts.add(product);
    const canonical = `${product.scope}:${catalogKey(product.name)}`;
    canonicals.set(canonical,[...(canonicals.get(canonical) || []),product]);
    const own = new Map<string,string[]>();
    for (const label of catalogProductNames(product)) {
      const key=catalogMatchLabelKey(label);
      if(key) own.set(key,[...(own.get(key) || []),label]);
    }
    for (const [key,names] of own) {
      const contextual = names.every(name => product.contextualAliases.some(alias => catalogMatchLabelKey(alias)===catalogMatchLabelKey(name))) &&
        catalogMatchLabelKey(product.name)!==key;
      const scoped=`${product.scope}:${key}`;
      labels.set(scoped,[...(labels.get(scoped) || []),{product,names,contextual}]);
    }
    for (const alias of product.contextualAliases) if(!product.aliases.some(name=>catalogAliasKey(name)===catalogAliasKey(alias))) {
      add('invalid_context_alias','warning','Context alias is not in the alias list','Add the verified alias to the alias list or remove its unused context entry.',[product],[alias]);
    }
  }
  for (const products of byId.values()) if(products.length>1) add('duplicate_id','error','Duplicate product ID','These records share an ID. Restore distinct records before editing; do not merge different products.',products);
  for (const products of canonicals.values()) if(products.length>1) add('duplicate_product','error','Duplicate canonical product name','Multiple product records in the same checker use the same normalized canonical name. Verify the intended record before retiring a duplicate.',products,products.map(product=>product.name));
  for (const entries of labels.values()) {
    if(new Set(entries.map(entry=>entry.product.id)).size<2) continue;
    const products=entries.map(entry=>entry.product);
    const canonicalKeys=new Set(products.map(product=>catalogMatchLabelKey(product.name)));
    if(canonicalKeys.size===1) {
      if(new Set(products.map(product=>catalogKey(product.name))).size===1) continue; // Already reported as duplicate canonical records.
      add('name_overlap','warning','Similar canonical wording needs review','These names contain the same normalized words. This does not establish clinical equivalence; verify identity, age group, specifications and approved mappings before any cleanup.',products,entries.flatMap(entry=>entry.names));
      continue;
    }
    const contextual=entries.every(entry=>entry.contextual);
    add(contextual?'contextual_overlap':'alias_conflict',contextual?'warning':'error',contextual?'Shared context-required alias':'Alias identifies different products',
      contextual?'This alias needs context to select a product. Keep it contextual only where verified; do not make it an unconditional match.'
        :'Verify which product owns this wording. Remove or correct the conflicting alias, display name or FS name; keep different clinical products separate.',products,entries.flatMap(entry=>entry.names));
  }
  for (const product of validProducts) if(product.linkedProductId) {
    const targets=byId.get(product.linkedProductId) || [];
    const target=targets[0];
    if(targets.length!==1 || !target || target.id===product.id || target.scope===product.scope) add('broken_link','error','Invalid checker link','Choose one existing counterpart in the other checker, or clear this link.',[product,...targets]);
    else if(target.linkedProductId && target.linkedProductId!==product.id) add('conflicting_link','error','Conflicting checker links','The target is linked to a different product. Review and correct the links before syncing aliases.',[product,target,...(byId.get(target.linkedProductId) || [])]);
    else if(!target.linkedProductId) add('one_way_link','warning','One-way checker link','Review the pair and save a verified reciprocal link, or remove the unused link.',[product,target]);
  }
  const activeRecords=new Map<string,Set<string>>();
  for(const record of catalog.aliasRecords || []) {
    if(record.status==='rejected' || record.status==='approved' && !record.active) {
      const products=byId.get(record.productId) || [];
      if(products.some(product=>validProducts.has(product) && catalogProductNames(product).some(name=>catalogAliasKey(name)===catalogAliasKey(record.text)))) {
        add('alias_record_drift','error','Retired alias is still published','Remove this wording from the product fields, or verify and correct its alias record before using it again.',products,[record.text]);
      }
    }
    if(!record.active || record.status!=='approved') continue;
    const products=byId.get(record.productId) || [];
    if(products.length!==1 || !validProducts.has(products[0])) {
      add('orphan_alias','error','Active alias has no unique product','Review this alias record. Retired aliases and historical records are kept separately.',products,[record.text]);
      continue;
    }
    const product=products[0], key=catalogMatchLabelKey(record.text), scoped=`${product.scope}:${key}`;
    activeRecords.set(scoped,new Set([...(activeRecords.get(scoped) || []),product.id]));
    if(record.normalizedText!==catalogAliasKey(record.text) || !catalogProductNames(product).some(name=>catalogAliasKey(name)===catalogAliasKey(record.text))) {
      add('alias_record_drift','error','Approved alias and catalogue disagree','Correct or deactivate the approved mapping in Alias Management; verify the product wording before reapproving.',[product],[record.text]);
    }
  }
  for(const [scoped,ids] of activeRecords) {
    const owners=new Set([...(labels.get(scoped) || []).map(entry=>entry.product.id),...ids]);
    if(owners.size>1 && !issues.some(issue=>['alias_conflict','duplicate_product','contextual_overlap'].includes(issue.code) && [...owners].every(id=>issue.productIds.includes(id)))) {
      const products=[...owners].flatMap(id=>byId.get(id) || []);
      add('alias_record_conflict','error','Competing approved alias records','More than one product claims this approved alias. Review the mappings before using it as a unique identity.',products,
        (catalog.aliasRecords || []).filter(record=>record.active && record.status==='approved' && ids.has(record.productId) && `${products[0]?.scope}:${catalogMatchLabelKey(record.text)}`===scoped).map(record=>record.text));
    }
  }
  const unique=[...new Map(issues.map(issue=>[issue.id,issue])).values()].sort((a,b)=>Number(b.severity==='error')-Number(a.severity==='error') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return {revision:catalog.revision,productCount:catalog.products.length,pendingAliasCount:(catalog.aliasRecords || []).filter(record=>record.status==='pending').length,
    errorCount:unique.filter(issue=>issue.severity==='error').length,warningCount:unique.filter(issue=>issue.severity==='warning').length,
    affectedProductCount:new Set(unique.flatMap(issue=>issue.productIds)).size,issues:unique};
}
