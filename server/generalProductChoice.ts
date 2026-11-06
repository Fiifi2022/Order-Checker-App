import {applySourceProductConfirmation} from './generalSourceProductConfirmation';
import {generalFsSuggestionSources} from './generalFsSuggestions';
import type {ProductCatalog} from '../shared/productCatalog';

/** A General Auditor confirmation need not create a permanent catalogue alias. */
export function confirmGeneralProductForAudit(record:any,alias:string,productId:string,catalog:ProductCatalog,actor:{id:string;name:string}){
 const group=record.generalAudit.catalogueSuggestions?.find((g:any)=>g.alias===alias);
 const option=group?.options.find((o:any)=>o.productId===productId&&!group.rejectedProductIds?.includes(o.productId));
 if(!option)throw Object.assign(Error('This product suggestion is no longer available.'),{status:409});
 const sources=generalFsSuggestionSources(record);
 const customer=sources.requested.find(p=>p.name===alias)||sources.requested.find(p=>p.name===group.customerValue);
 const fs=sources.supplied.find(p=>p.name===(option.sourceName||option.name));
 if(!customer||!fs)throw Object.assign(Error('Confirm a product stated in each original message.'),{status:409});
 const projected={...record,generalAudit:{...record.generalAudit,catalogueSuggestions:record.generalAudit.catalogueSuggestions.map((g:any)=>g===group?{...g,alias:customer.name,options:[{...option,kind:'source',sourceName:fs.name}]}:g)}};
 return applySourceProductConfirmation(projected,customer.name,fs.name,catalog,actor);
}
