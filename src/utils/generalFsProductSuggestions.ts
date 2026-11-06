import type {ProductResearchOption} from '../../shared/productResearch';
import {directProductNameKey} from '../../shared/generalDirectProduct';

export interface GeneralFsProductSource {name:string;canonicalId?:string}

/** Presentation only: intersect supported suggestions with actual FS product
 * evidence. Preserve decision IDs; never use the full confirmation as a label. */
export function generalFsProductSuggestionOptions(options:ProductResearchOption[],products?:GeneralFsProductSource[]) {
  if(!products)return options;
  return options.flatMap(option=>{
    const matching=products.filter(product=>option.kind==='source'
      ? !!option.sourceName&&directProductNameKey(product.name)===directProductNameKey(option.sourceName)
      : product.canonicalId===option.productId||directProductNameKey(product.name)===directProductNameKey(option.name));
    const names=[...new Set(matching.map(product=>product.name))];
    return names.length?[{...option,name:names.join('; ')}]:[];
  });
}
