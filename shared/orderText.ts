import {normalizeSyringeOrderLine} from './syringeIdentity';
/** Literal language normalization only: never convert strengths, stock balances or
 * a named course into a quantity. Product identity remains catalogue-authoritative. */
const personTitleWords='(?:Physician\\s+Assistant|Midwife|Nurse|Officer|Doctor|Prof|Miss|Mrs|Mr|Ms|Dr|PA)';
export const ORDER_PERSON_TITLE_SOURCE=`${personTitleWords}\\.?`;
export const stripOrderPersonTitle=(value:string)=>value.trim().replace(new RegExp(`^(?:${personTitleWords}(?:\\.\\s*|\\s+))+`,'i'),'');
export const ORDER_NUMBER_WORDS:Record<string,number>=Object.fromEntries('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ').map((word,index)=>[word,index]));
const words=Object.keys(ORDER_NUMBER_WORDS).join('|');
export function normalizeOrderCountText(text:string,units:string){
 return text.replace(/\b(?:vails?|vialls?|vilas?)\b/gi,'vials')
  .replace(/\b(?:boxs|boxe|boex|bxs)\b/gi,'boxes').replace(/\b(?:paks?|pakcs|pacsk)\b/gi,'packs').replace(/\b(?:dozes|dosses|dosess)\b/gi,'doses')
  .replace(new RegExp(`\\b(${words})\\s+(?=${units}\\b)`,'gi'),word=>`${ORDER_NUMBER_WORDS[word.trim().toLowerCase()]} `)
  .replace(new RegExp(`\\b(quantity|qty|amount)\\s*[:=]?\\s*(${words})\\b`,'gi'),(_,field,word)=>`${field}: ${ORDER_NUMBER_WORDS[word.toLowerCase()]}`);
}
export function cleanOrderRequest(line:string){
 const cleaned=normalizeSyringeOrderLine(line).replace(/^[,;.!\s]+/,'').replace(/^and\s+(?=(?:we|i|please|pls|send|supply)\b)/i,'').replace(/^(?:(?:hi|hello)(?:\s+zipline)?[,.! ]*\s*)/i,'')
 .replace(/^(?:can|could|would)\s+you\s+(?:(?:please|kindly)\s+)?(?:help\s+(?:us|me)\s+with\s+|(?=send|supply|give))/i,'')
 .replace(/^(?:(?:please|pls|kindly)[, ]*\s*)?(?:(?:we|i)\s+(?:also\s+)?(?:urgently\s+)?(?:need|want|require|request|are requesting|would like(?:\s+to\s+(?:order|request))?)|(?:need|needs|want|wants|require|requires|request|requests)|(?:send|give|supply|provide|pack)(?:\s+(?:us|me))?)\s+/i,'')
 .replace(/^(?:products?|items?|vaccines?|medicines?|drugs?)\s*[:=]\s*/i,'')
 .replace(/\s+(?:for\s+(?:continuous\s+)?(?:case\s+management|a\s+patient|the\s+patient)|because\b).*$/i,'')
 .replace(/\s+(?:please|thanks|thank you)[.!]?$/i,'').replace(/[.!?]+$/i,'').trim();
 return normalizeSyringeOrderLine(cleaned);
}
/** Word-only counts and postfix multiplication require a catalogue-backed clause. */
export function normalizeCatalogueCountText(text:string,isQuantifiedProduct:(value:string)=>boolean,isNamedIdentity:(value:string)=>boolean=()=>false){
 if(isNamedIdentity(text))return text;
 const postfix=text.replace(/\s+(\d+(?:\.\d+)?)\s*[x×]\s*$/i,' - $1');
 if(postfix!==text&&isQuantifiedProduct(postfix))return postfix;
 const word=text.match(new RegExp(`^(.*?)\\s+(${words})\\s*$`,'i'));
 if(word){const value=`${word[1]} - ${ORDER_NUMBER_WORDS[word[2].toLowerCase()]}`;if(isQuantifiedProduct(value))return value;}
 return text;
}

export function hasExplicitNegativeOrderCount(text:string){
 return /(?:[:=]\s*-\s*\d|(?<![\p{L}\p{N}])[-–—]\s+-\s*\d|(?<![\p{L}\p{N}])--\s*\d)\s*(?:[a-z]+)?\s*[.!]?$/iu.test(text) || /\b(?:balance|inventory|carryovers?|remaining stock)\b[^\n]*-\s*\d/i.test(text);
}
