import {catalogAliasKey,catalogProductNames,type ProductCatalog} from '../shared/productCatalog';
import type {ProductResearchSuggestion} from '../shared/productResearch';
import {sourceProductOptions} from './generalSourceProductConfirmation';
import {createGeneralCatalogResolver,generalCatalogAttributeConflict,sameGeneralCatalogIngredient} from '../src/utils/generalProductLog';
import {directProductNameKey} from '../shared/generalDirectProduct';

/** A shared, ambiguous alias is evidence for a suggestion, never an identity.
 * Compare the two actual source descriptions; do not force catalogue registration
 * or select an arbitrary catalogue variant. Confirmation remains audit-specific.
 */
export function localSourceComparisonSuggestions(aliases:string[],fulfillmentNames:string[],catalog:ProductCatalog) {
  const resolve=createGeneralCatalogResolver(catalog.products);
  const cachedIds=new Map<string,Set<string>>();
  const matchingIds=(name:string)=>{
    const cached=cachedIds.get(name);if(cached)return cached;
    const ids=new Set(catalog.products.filter(product=>
    product.scope==='general'&&!generalCatalogAttributeConflict(name,product.name)&&
    catalogProductNames(product).some(label=>catalogAliasKey(label)===catalogAliasKey(name))&&
    !catalog.aliasRecords?.some(row=>row.productId===product.id&&row.normalizedText===catalogAliasKey(name)&&
      (row.status==='rejected'||row.status==='approved'&&!row.active)))
    .map(product=>product.id));
    cachedIds.set(name,ids);return ids;
  };
  const groups=new Map<string,ProductResearchSuggestion>();
  for(const alias of aliases){
    const requested=resolve(alias).product;
    // Both labels may already have distinct saved IDs (generic ingredient versus
    // a specific presentation). Catalogue membership must not suppress a choice.
    // Keep this confirmation audit-specific: never repoint the generic alias.
    const knownOptions=requested?.scope==='general'&&requested.category!=='companion'&&
      !fulfillmentNames.some(name=>resolve(name).product?.id===requested.id)
      ? [...new Set(fulfillmentNames)].flatMap(name=>{
        const supplied=resolve(name).product;
        if(!supplied||supplied.scope!=='general'||supplied.category==='companion'||supplied.id===requested.id||
          aliases.some(other=>other!==alias&&resolve(other).product?.id===supplied.id)||
          !sameGeneralCatalogIngredient(requested.name,supplied.name)||
          (!sameGeneralCatalogIngredient(alias,name)&&!catalogProductNames(requested).some(label=>catalogAliasKey(label)===catalogAliasKey(alias)))||generalCatalogAttributeConflict(alias,name)||
          generalCatalogAttributeConflict(requested.name,supplied.name)||
          catalog.aliasRecords?.some(row=>row.productId===supplied.id&&row.normalizedText===catalogAliasKey(alias)&&
            (row.status==='rejected'||row.status==='approved'&&!row.active)))return [];
        return [{productId:`source:${directProductNameKey(name)}`,kind:'source' as const,sourceName:name,name,
          confidenceCategory:'MEDIUM' as const,evidenceSource:'source' as const,
          reason:'The catalogue lists the same ingredient under separate product entries. Confirm that the FS presentation is the product requested for this order; quantities remain checked separately.'}];
      }) : [];
    if(knownOptions.length){
      groups.set(alias,{alias,options:knownOptions.slice(0,12),status:'suggested',confidenceCategory:'MEDIUM',researchStatus:'catalogue',searchStatus:'not_searched',sources:[],
        nextSteps:['Verify the FS presentation against the customer request.','Confirm only this order’s product identity; quantity differences and order-limit decisions remain separate.']});
      continue;
    }
    const ids=matchingIds(alias);if(ids.size<2)continue;
    const counterparts=fulfillmentNames.filter(name=>name!==alias&&[...matchingIds(name)].some(id=>ids.has(id)));
    const options=sourceProductOptions(alias,catalog,counterparts,true).map(option=>({...option,
      reason:'Both source descriptions occur in overlapping approved catalogue aliases, but more than one product fits. Confirm whether they identify the same product for this order.'}));
    if(!options.length)continue;
    groups.set(alias,{alias,options:options.slice(0,3),status:'suggested',confidenceCategory:'MEDIUM',researchStatus:'catalogue',searchStatus:'not_searched',sources:[],
      nextSteps:['Compare the customer and FS descriptions and any stated clinical specifications.','Confirm the naming equivalence only when verified; quantities and other discrepancies remain independently checked.']});
  }
  return groups;
}
