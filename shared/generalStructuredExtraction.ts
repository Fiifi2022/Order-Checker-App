export type GeneralExtractionStatus='extracted'|'not detected'|'ambiguous'|'parsing failure';
export interface GeneralStructuredField {value:string|null;status:GeneralExtractionStatus;reason?:string}
export interface GeneralStructuredProduct {
 entryId?:string;
 name:string;quantity:number|null;unit:string;confirmationRequested:number|null;
 originalText:string;status:GeneralExtractionStatus;reason?:string;
 stockout:boolean;orderLimit:boolean;
}
export interface GeneralStructuredSource {
 sourceText:string;orderer:GeneralStructuredField;facility:GeneralStructuredField;
 products:GeneralStructuredProduct[];unreadProducts:string[];
}
export interface GeneralStructuredPreview {
 accessoryChecks?:import('./generalAccessoryCatalog').GeneralAccessoryCheck[];
 version:1;catalogRevision:number;inputFingerprint:string;
 customer:GeneralStructuredSource;fulfillment:GeneralStructuredSource;
}
export interface GeneralExtractionEdit {
 source:'customer'|'fulfillment';field:'orderer'|'facility'|'products';value:string|GeneralStructuredProduct[]|null;
}
export interface GeneralExtractionSubmission {
 version:1;inputFingerprint:string;catalogRevision:number;edits:GeneralExtractionEdit[];
 confirmedFields:string[];reason:string;acknowledged:boolean;
}
export interface GeneralExtractionChange {
 source:GeneralExtractionEdit['source'];field:GeneralExtractionEdit['field'];before:unknown;after:unknown;
 reason:string;actor:{id:string;name:string};at:string;
}
