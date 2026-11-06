import type {RequestHandler} from 'express';
import type {ProductCatalog} from '../shared/productCatalog';
import type {GeneralFacilityContext} from '../src/utils/generalFacility';
import {extractGeneralStructuredPreview} from './generalStructuredExtraction';
export function generalExtractionPreviewHandler(deps:{catalog:()=>Promise<ProductCatalog>;context:()=>Promise<GeneralFacilityContext>;apply:(catalog:ProductCatalog)=>void}):RequestHandler{
 return async(req,res)=>{
  if(!res.locals.authUser?.id){res.status(401).json({error:'Sign in before extracting an order.'});return;}
  const body=req.body||{};
  if(body.auditScope!=='general_auditor'||body.auditMode||![body.whatsappMessage,body.fulfillmentConfirmation].every(text=>typeof text==='string'&&text.trim()&&text.length<=50000)){
   res.status(400).json({error:'Provide both General Auditor messages (up to 50,000 characters each).'});return;
  }
  try{
   const [catalog,context]=await Promise.all([deps.catalog(),deps.context()]);deps.apply(catalog);
   res.setHeader('Cache-Control','no-store');res.json(extractGeneralStructuredPreview(body.whatsappMessage,body.fulfillmentConfirmation,catalog,context));
  }catch{res.status(503).json({error:'Extraction references are unavailable. Your messages are retained; retry extraction.'});}
 };
}
