import { catalogKey, catalogProductNames, type CatalogProduct } from './productCatalog';

let version = 0;
let configuration = '';

export const getGeneralVaccineCatalogVersion = () => version;
let identities = new Map<string, string>();
let conflicts = new Set<string>();

/** Resolve only saved cross-checker links or a unique approved label overlap.
 * Existing General identities take precedence over broad legacy vaccine aliases. */
export function generalVaccineCounterpart(vaccine:CatalogProduct,products:readonly CatalogProduct[]):CatalogProduct|undefined {
  const general=products.filter(product=>product.scope==='general');
  const approvedNames=(product:CatalogProduct)=>catalogProductNames(product).filter(label=>!product.contextualAliases.some(alias=>catalogKey(alias)===catalogKey(label)));
  const linked=general.filter(product=>product.id===vaccine.linkedProductId || product.linkedProductId===vaccine.id);
  if(linked.length)return linked.length===1?linked[0]:undefined;
  const direct=general.filter(product=>catalogProductNames(product).some(label=>catalogKey(label)===catalogKey(vaccine.name)) &&
    (product.category==='vaccine' || product.category==='companion' || approvedNames(product).some(label=>catalogKey(label)===catalogKey(vaccine.name))));
  const choose=(matches:CatalogProduct[])=>{
    const vaccines=matches.filter(product=>product.category==='vaccine' || product.category==='companion');
    return matches.length===1?matches[0]:vaccines.length===1?vaccines[0]:undefined;
  };
  if(direct.length)return choose(direct);
  const labels=new Set(approvedNames(vaccine).map(catalogKey));
  const shared=general.filter(product=>approvedNames(product).some(label=>labels.has(catalogKey(label))));
  return choose(shared);
}

/** Bring vaccine catalog labels into General without merging its distinct identities. */
export function setGeneralVaccineCatalog(products: CatalogProduct[]) {
  const signature = JSON.stringify(products);
  if (signature === configuration) return;
  configuration = signature;
  version++;
  const general = products.filter(product => product.scope === 'general');
  const labels = new Map<string, CatalogProduct[]>();
  const contextual = new Set<string>();
  for (const product of general) {
    for (const label of catalogProductNames(product)) {
      const key = catalogKey(label);
      labels.set(key, [...(labels.get(key) || []), product]);
    }
    product.contextualAliases.forEach(label => contextual.add(catalogKey(label)));
  }
  const candidates = new Map<string, Set<string>>();
  conflicts = new Set();
  for (const product of products.filter(product => product.scope === 'vaccine')) {
    const counterpart=generalVaccineCounterpart(product,products);
    if(!counterpart && (labels.get(catalogKey(product.name)) || []).length>1){catalogProductNames(product).forEach(label=>conflicts.add(catalogKey(label)));continue;}
    const canonical = counterpart?.name || product.name;
    for (const label of catalogProductNames(product)) {
      const key = catalogKey(label);
      if (contextual.has(key) || product.contextualAliases.some(alias => catalogKey(alias) === key) ||
        (labels.get(key) || []).some(other => other.name !== canonical)) {
        conflicts.add(key); continue;
      }
      const targets = candidates.get(key) || new Set<string>();
      targets.add(canonical); candidates.set(key, targets);
    }
  }
  for (const [key, targets] of candidates) if (targets.size > 1) conflicts.add(key);
  identities = new Map([...candidates].filter(([key, targets]) => targets.size === 1 && !conflicts.has(key))
    .map(([key, targets]) => [key, [...targets][0]]));
}

export const resolveCatalogVaccineName = (name: string) => identities.get(catalogKey(name));
export const isConflictingVaccineAlias = (name: string) => conflicts.has(catalogKey(name));
