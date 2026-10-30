import { createHash, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { assignedRoles } from '../shared/roles';
import { canManageCatalog, catalogAliasKey, catalogMatchLabelKey, catalogProductNames, type CatalogAliasRecord, type CatalogAliasEvent, type ProductCatalog } from '../shared/productCatalog';
import { resolveGeneralCatalogIdentity, canAutomaticallyLearnGeneralAlias } from '../src/utils/generalProductLog';

const aliasId = (productId: string, text: string) => createHash('sha256').update(`${productId}:${catalogAliasKey(text)}`).digest('hex');
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
export function catalogueAliasRecords(catalog: ProductCatalog): CatalogAliasRecord[] {
  const records = [...(catalog.aliasRecords || [])];
  for (const product of catalog.products.filter(p=>p.scope==='general')) for (const text of product.aliases) {
    if(catalogAliasKey(text)===catalogAliasKey(product.name)) continue;
    if (records.some(record=>record.productId===product.id && record.normalizedText===catalogAliasKey(text))) continue;
    records.push({ id:aliasId(product.id,text),productId:product.id,text,normalizedText:catalogAliasKey(text),source:'catalogue',status:'approved',active:true,requiresContext:product.contextualAliases.some(alias=>catalogAliasKey(alias)===catalogAliasKey(text)),
      createdAt:null,approvedAt:null,approvedBy:'Existing catalogue',updatedAt:catalog.updatedAt || null });
  }
  return records;
}
export function changeCatalogueAlias(catalog: ProductCatalog, input: any, actor: string, automatic = false): {catalog:ProductCatalog;events:CatalogAliasEvent[]} {
  if (!automatic && input?.revision!==catalog.revision) fail('The catalogue changed. Reload before saving.',409);
  const now=new Date().toISOString();
  let records=catalogueAliasRecords(catalog);
  const previous=input?.id ? records.find(record=>record.id===input.id) : undefined;
  const action=input?.action;
  if (!['propose','approve','reject','deactivate','correct'].includes(action)) fail('Choose a valid alias action.');
  if(action==='propose' && input.id) fail('New proposals cannot overwrite an existing alias record.');
  if(action!=='propose' && !previous) fail('Alias not found. Reload the catalogue.',404);
  const text=String(input.text ?? previous?.text ?? '').trim();
  const productId=String(input.productId ?? previous?.productId ?? '');
  const product=catalog.products.find(p=>p.id===productId && p.scope==='general');
  if(!product || !text || text.length>160 || /[\r\n]/.test(text)) fail('Choose an existing General product and a one-line alias of at most 160 characters.');
  const normalizedText=catalogAliasKey(text);
  if(action==='propose' && normalizedText===catalogAliasKey(product.name)) fail('The canonical product name is already recognized. Enter an alternative description.');
  if(!normalizedText) fail('Enter an alias containing letters or numbers.');
  const duplicate=records.find(record=>record.id!==previous?.id && record.productId===productId && record.normalizedText===normalizedText);
  if(action==='propose' && duplicate) return {catalog,events:[]};
  if(duplicate) fail('This alias already has a record for that product.');
  if(previous && !['propose','correct'].includes(action) && (productId!==previous.productId || normalizedText!==previous.normalizedText)) fail('Use a verified correction to change an alias mapping.');
  const approving=action==='approve' || action==='correct';
  if(approving && input.identityConfirmed!==true) fail('Confirm that you verified the product identity before approving.');
  if(automatic && action!=='propose') fail('Automatic suggestions cannot approve aliases.');
  if(action==='propose' && records.filter(record=>record.productId===productId && record.status==='pending').length>=150) fail('Review existing pending aliases for this product before adding more.');
  if(approving && product.aliases.filter(alias=>catalogAliasKey(alias)!==previous?.normalizedText).length>=150) fail('This product has reached its approved alias limit.');
  if(approving) {
    const conflicts=catalog.products.filter(p=>p.scope==='general' && p.id!==productId && !(previous?.status==='approved' && previous.active && p.id===previous.productId && previous.normalizedText===normalizedText) && catalogProductNames(p).some(name=>catalogMatchLabelKey(name)===catalogMatchLabelKey(text)));
    if(conflicts.length) fail('This alias belongs to another product. Correct or deactivate that mapping first.',409);
    if(records.some(record=>record.id!==previous?.id && record.productId!==productId && catalogMatchLabelKey(record.text)===catalogMatchLabelKey(text) && record.status==='approved' && record.active)) fail('Another approved mapping already uses this alias.',409);
  }
  if(action==='approve' && previous?.status==='rejected') fail('Correct the rejected suggestion before approving it.');
  if(action==='deactivate' && previous?.status!=='approved') fail('Only approved aliases can be deactivated.');
  if(action==='reject' && previous?.status==='approved') fail('Deactivate an approved alias rather than rejecting it.');
  const record:CatalogAliasRecord={
    ...(previous || {id:randomUUID(),createdAt:now,approvedAt:null,approvedBy:null}),productId,text,normalizedText,
    source:previous?.source || (automatic ? input.source==='deterministic' ? 'deterministic' : 'gemini' : 'manual'),
    ...(automatic ? {requiresContext:input.requiresContext===true}:{}),
    status:approving ? 'approved' : action==='reject' ? 'rejected' : action==='deactivate' ? 'approved' : 'pending',
    active:approving,updatedAt:now,
    ...(approving ? {approvedAt:now,approvedBy:actor} : {}),
    ...(automatic && typeof input.confidence==='number' ? {confidence:input.confidence,clinicalUncertainty:input.clinicalUncertainty!==false,reason:typeof input.reason==='string'?input.reason.slice(0,500):''} : {}),
  };
  let products=catalog.products;
  if(previous?.status==='approved' && previous.active) {
    const old=products.find(p=>p.id===previous.productId)!;
    if(catalogAliasKey(old.name)===previous.normalizedText) fail('Canonical product names cannot be deactivated as aliases.');
    products=products.map(p=>p.id===old.id ? {...p,aliases:p.aliases.filter(alias=>catalogAliasKey(alias)!==previous.normalizedText),
      ...(p.fulfillmentSystemName && catalogAliasKey(p.fulfillmentSystemName)===previous.normalizedText ? {fulfillmentSystemName:''}:{}),
      ...(p.displayName && catalogAliasKey(p.displayName)===previous.normalizedText ? {displayName:p.name}:{}),
      contextualAliases:p.contextualAliases.filter(alias=>catalogAliasKey(alias)!==previous.normalizedText)} : p);
  }
  if(record.status==='approved' && record.active) products=products.map(p=>p.id===productId ? {...p,aliases:[...p.aliases.filter(alias=>catalogAliasKey(alias)!==normalizedText),text],
      contextualAliases:record.requiresContext ? [...p.contextualAliases.filter(alias=>catalogAliasKey(alias)!==normalizedText),text] : p.contextualAliases} : p);
  records=records.filter(row=>row.id!==record.id);records.push(record);
  const event:CatalogAliasEvent={id:randomUUID(),aliasId:record.id,action,actor,at:now,before:previous || null,after:record};
  return {catalog:{...catalog,products,aliasRecords:[...(catalog.aliasRecords || []).filter(row=>row.id!==record.id),record],revision:catalog.revision+1,updatedAt:now,updatedBy:actor},events:[event]};
}
/** Backend-only learning: revalidate against the latest transactional catalogue.
 * An AI candidate ID or confidence never authorizes an alias approval. */
export function learnVerifiedCatalogueAliases(catalog:ProductCatalog,aliases:{alias:string;productId:string}[],actor:string) {
 let current=catalog;const events:CatalogAliasEvent[]=[];
 for(const {alias,productId} of aliases.slice(0,48)) {
  if(typeof alias!=='string' || !alias.trim() || alias.length>160 || /[\r\n]/.test(alias))continue;
  const key=catalogAliasKey(alias);
  if(catalogueAliasRecords(current).some(record=>record.normalizedText===key))continue;
  const match=resolveGeneralCatalogIdentity(alias,current.products);
  if(match.product?.id!==productId || match.product.scope!=='general' || match.source!=='Normalized')continue;
  if(!canAutomaticallyLearnGeneralAlias(alias,match.product))continue;
  if(current.products.some(product=>product.scope==='general' && catalogProductNames(product).some(name=>catalogAliasKey(name)===key)))continue;
  try {
   const proposed=changeCatalogueAlias(current,{action:'propose',text:alias,productId,source:'deterministic',confidence:1,clinicalUncertainty:false,reason:'Unique compatible product verified against the current catalogue.'},actor,true);
   const record=proposed.events[0]?.after;if(!record)continue;
   current=proposed.catalog;events.push(...proposed.events);
  }catch { /* Conflicts or capacity limits cannot invalidate the actual audit. */ }
 }
 return {catalog:current,events};
}
/** Capture alias edits made through the existing product form too. */
export function trackCatalogueAliasEdits(before:ProductCatalog,after:ProductCatalog,actor:string) {
  const now=new Date().toISOString(),records=catalogueAliasRecords(before),events:CatalogAliasEvent[]=[];
  for(const product of after.products.filter(p=>p.scope==='general')) {
    const old=before.products.find(p=>p.id===product.id);
    for(const text of new Set([...(old?.aliases || []),...product.aliases])) {
      const key=catalogAliasKey(text),was=old?.aliases.some(alias=>catalogAliasKey(alias)===key),is=product.aliases.some(alias=>catalogAliasKey(alias)===key);
      const oldText=old?.aliases.find(alias=>catalogAliasKey(alias)===key),newText=product.aliases.find(alias=>catalogAliasKey(alias)===key);
      const oldContext=old?.contextualAliases.some(alias=>catalogAliasKey(alias)===key),requiresContext=product.contextualAliases.some(alias=>catalogAliasKey(alias)===key);
      if(oldText===newText && !!oldContext===requiresContext) continue;
      if(events.some(event=>event.after.productId===product.id && event.after.normalizedText===key)) continue;
      const index=records.findIndex(record=>record.productId===product.id && record.normalizedText===key);
      const previous=index>=0 ? records[index] : null;
      const record:CatalogAliasRecord={...(previous || {id:randomUUID(),createdAt:now}),productId:product.id,text:newText || oldText || text,normalizedText:key,requiresContext,source:previous?.source || 'manual',
        status:'approved',active:!!is,approvedAt:is ? now : previous?.approvedAt || null,approvedBy:is ? actor : previous?.approvedBy || null,updatedAt:now};
      if(index>=0) records[index]=record;else records.push(record);
      events.push({id:randomUUID(),aliasId:record.id,action:is&&was?'correct':is?'approve':'deactivate',actor,at:now,before:previous,after:record});
    }
  }
  const managed=new Map((before.aliasRecords || []).map(record=>[record.id,record]));
  const retainedProducts = new Set(after.products.map(product => product.id));
  for (const previous of records.filter(record => !retainedProducts.has(record.productId) && record.active)) {
    const record = { ...previous, active: false, updatedAt: now };
    events.push({ id: randomUUID(), aliasId: record.id, action: 'deactivate', actor, at: now, before: previous, after: record });
  }
  for(const event of events) managed.set(event.after.id,event.after);
  return {catalog:events.length ? {...after,aliasRecords:[...managed.values()]}:after,events};
}
export function catalogueAliasHandlers(deps:{read:()=>Promise<ProductCatalog>;change:(input:any,actor:string)=>Promise<ProductCatalog>;history:(cursor?:string)=>Promise<{events:CatalogAliasEvent[];nextCursor:string}>}) {
  const list:RequestHandler=async(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {const catalog=await deps.read();const records=catalogueAliasRecords(catalog);
      res.json({revision:catalog.revision,canEdit:canManageCatalog(assignedRoles(res.locals.authUser)),products:catalog.products.filter(p=>p.scope==='general').map(p=>({id:p.id,name:p.displayName || p.name})),
        records:records.map(record=>({...record,ambiguous:records.some(other=>other.productId!==record.productId && other.normalizedText===record.normalizedText && other.status!=='rejected')}))});
    } catch {res.status(503).json({error:'Alias catalogue unavailable. Please retry.'});}
  };
  const change:RequestHandler=async(req,res)=>{
    if(!canManageCatalog(assignedRoles(res.locals.authUser))) {res.status(403).json({error:'Catalogue editing permission is required.'});return;}
    try {const catalog=await deps.change(req.body,res.locals.authUser.email || res.locals.authUser.id);res.json({revision:catalog.revision});}
    catch(error:any){res.status(error.status || 503).json({error:error.status ? error.message : 'Alias changes could not be saved. Please retry.'});}
  };
  const history:RequestHandler=async(req,res)=>{
    if(!canManageCatalog(assignedRoles(res.locals.authUser))) {res.status(403).json({error:'Catalogue editing permission is required.'});return;}
    try {const cursor=typeof req.query.cursor==='string' ? req.query.cursor : undefined;if(cursor && !/^[a-zA-Z0-9-]{1,100}$/.test(cursor)) fail('Invalid history cursor.');res.json(await deps.history(cursor));}
    catch(error:any){res.status(error.status || 503).json({error:error.status ? error.message : 'Alias history unavailable. Please retry.'});}
  };
  return {list,change,history};
}
