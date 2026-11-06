export type ResearchConfidence='HIGH'|'MEDIUM'|'LOW';
export interface ResearchSource {title:string;url:string}
export interface ProductResearchOption {kind?:'catalogue'|'source';sourceName?:string;productId:string;name:string;confidence?:number;clinicalUncertainty?:boolean;confidenceCategory?:ResearchConfidence;reason:string;evidenceSource?:'catalogue'|'gemini'|'source';sources?:ResearchSource[]}
export interface ProductResearchSuggestion {
 customerValue?:string;fulfillmentValue?:string;alias:string;options:ProductResearchOption[];status:'suggested'|'unavailable';
 confidenceCategory?:ResearchConfidence;researchStatus?:'deferred'|'catalogue'|'analysed'|'rate_limited'|'unavailable'|'timed_out';
 terminology?:{name:string;reason:string}[];nextSteps?:string[];sources?:ResearchSource[];searchStatus?:'disabled'|'not_searched'|'grounded'|'no_sources'|'unavailable';searchEntryPoint?:string;
 rejectedProductIds?:string[];researchRevision?:number;retainedDiscrepancy?:boolean;
 history?:{action:'research'|'reject'|'keep';productId?:string;actor:{id:string;name:string};at:string}[];
}
export function productResearchNextSteps(hasCandidates:boolean){return hasCandidates?
 ['Compare the original packaging, ingredient, strength, formulation and size with the suggested product description.','Confirm only after verifying the identity; otherwise reject the suggestion or search again.']:
 ['Check the spelling or provide the generic name from the product packaging.','Clarify the ingredient, strength, formulation and container or device size.','Ask a catalogue editor to create a verified entry if the requested product is not listed.'];}
