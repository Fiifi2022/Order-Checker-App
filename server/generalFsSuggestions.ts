import type {ProductCatalog} from '../shared/productCatalog';
import type {ProductResearchOption,ProductResearchSuggestion} from '../shared/productResearch';
import {directProductNameKey} from '../shared/generalDirectProduct';
import {createGeneralCatalogResolver,generalCatalogAttributeConflict,generalCatalogIngredientWords,relatedGeneralCatalogDescriptions,sameGeneralCatalogIngredient} from '../src/utils/generalProductLog';
import {generalAccessoryIdentity,type GeneralAccessoryCatalog} from '../shared/generalAccessoryCatalog';

interface ParsedProduct {name:string}
/** Bind a General Auditor suggestion to products already parsed from each
 * source. Never use a confirmation script or the entire order as a candidate.
 * This also runs after background research, before saving its response. */
export function scopeGeneralFsSuggestion(group:ProductResearchSuggestion,requested:ParsedProduct[],supplied:ParsedProduct[],catalog:ProductCatalog,accessoryContext?:GeneralAccessoryCatalog):ProductResearchSuggestion {
  const resolve=createGeneralCatalogResolver(catalog.products);
  const key=directProductNameKey;
  const requests=[...new Map(requested.map(p=>[key(p.name),p])).values()];
  const entries=[...new Map(supplied.map(p=>[key(p.name),p])).values()];
  const isRequest=requests.some(p=>key(p.name)===key(group.alias));
  const fsAlias=entries.find(p=>key(p.name)===key(group.alias));
  const accessoryHint=accessoryContext&&fsAlias&&generalAccessoryIdentity(accessoryContext,fsAlias.name);
  if(accessoryHint?.role==='accessory'&&!isRequest){
    const options=group.options.filter(option=>{
      const product=catalog.products.find(p=>p.id===option.productId),hint=product&&generalAccessoryIdentity(accessoryContext!,product.name);
      return hint?.role==='accessory'&&hint.family===accessoryHint.family&&!generalCatalogAttributeConflict(fsAlias!.name,product!.name);
    });
    return {...group,options,fulfillmentValue:fsAlias!.name,status:options.length?'suggested':'unavailable'};
  }
  const distinguishing=(name:string)=>generalCatalogIngredientWords(name).filter(word=>word.length>=3&&!['new','medicine','medicines','product','products','unknown','acid','hydrochloride','hydroxide','the','and','for'].includes(word));
  const relevant=(customer:string,fs:string,option:ProductResearchOption)=>{
    if(generalCatalogAttributeConflict(customer,fs))return false;
    const a=resolve(customer).product,b=resolve(fs).product;
    if(accessoryContext){
      const hint=generalAccessoryIdentity(accessoryContext,customer),target=generalAccessoryIdentity(accessoryContext,fs,b?.id);
      if(hint?.role==='vaccine'&&target?.role==='vaccine'&&hint.family===target.family&&option.kind==='source')return true;
    }
    if(a&&b)return a.id===b.id||sameGeneralCatalogIngredient(a.name,b.name);
    return key(customer)===key(fs)||relatedGeneralCatalogDescriptions(customer,fs)||
      distinguishing(customer).some(word=>distinguishing(fs).includes(word))||option.evidenceSource==='gemini';
  };
  const options:ProductResearchOption[]=[],customers=new Set<string>();
  for(const option of group.options){
    if(group.rejectedProductIds?.includes(option.productId))continue;
    const customerMatches=isRequest?requests.filter(p=>key(p.name)===key(group.alias)):requests.filter(p=>
      resolve(p.name).product?.id===option.productId||key(p.name)===key(option.name)||
      option.kind==='source'&&!!option.sourceName&&key(p.name)===key(option.sourceName));
    const fsMatches=isRequest?entries.filter(p=>option.kind==='source'
      ? !!option.sourceName&&key(p.name)===key(option.sourceName)
      : resolve(p.name).product?.id===option.productId||key(p.name)===key(option.name)):fsAlias?[fsAlias]:[];
    const matched=fsMatches.filter(p=>customerMatches.some(customer=>relevant(customer.name,p.name,option)));
    if(!matched.length)continue;
    customerMatches.filter(customer=>matched.some(p=>relevant(customer.name,p.name,option))).forEach(p=>customers.add(p.name));
    for(const entry of matched){
      // Multiple FS presentations need independent choices, even if a broad
      // catalogue ID owns them all. Source confirmations retain quantity checks.
      const identity=matched.length>1&&isRequest
        ? {kind:'source' as const,sourceName:entry.name,productId:`source:${key(entry.name)}`}
        : {};
      const candidate={...option,...identity,name:entry.name,
        reason:option.evidenceSource==='gemini'?'AI suggests this FS product; CCA confirmation is required.':'Possible product match in this FS order; confirm the presentation.'};
      if(!options.some(o=>o.productId===candidate.productId))options.push(candidate);
    }
  }
  const {terminology:_unscopedTerms,...scoped}=group;
  const terminology=group.terminology?.filter(term=>options.some(option=>!generalCatalogAttributeConflict(term.name,option.name)&&
    (key(term.name)===key(option.name)||!!resolve(term.name).product&&resolve(term.name).product?.id===resolve(option.name).product?.id)));
  return {...scoped,...(terminology?.length?{terminology}:{}),options,customerValue:isRequest?requests.find(p=>key(p.name)===key(group.alias))!.name:[...customers].join('; '),
    fulfillmentValue:[...new Set(options.map(o=>o.name))].join('; '),status:options.length?'suggested':'unavailable',
    nextSteps:options.length?['Confirm the matching FS product or mark it as a discrepancy.']:['No supported FS product candidate was found. Check the product wording or mark a discrepancy.']};
}

/** Saved audit provenance is the parsed source, not generated display names. */
export function generalFsSuggestionSources(record:{items?:any[]}) {
  const rows=(record.items||[]).flatMap(item=>item.provenance||[]);
  return {requested:rows.filter(p=>p.source==='customer_request'),supplied:rows.filter(p=>p.source==='fulfillment_confirmation')};
}
