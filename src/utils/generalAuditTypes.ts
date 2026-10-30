export type GeneralProductReviewState = 'product identification review' | 'quantity review' | 'dosage/formulation confirmation required' | 'product match' | 'product discrepancy';
import type { GeneralProductCategory } from './generalProductCategory';

export interface GeneralNameEvidence {
  customer: string;
  fulfillment: string;
  decision: 'match' | 'mismatch';
  confidence: number;
  reason: string;
}
export interface GeneralFieldResult {
  reason?: string;
  nameMatchMethod?: 'deterministic' | 'fuzzy' | 'gemini';
  nameEvidence?: GeneralNameEvidence;
  whatsappValue: string;
  fulfillmentValue: string;
  status: 'match' | 'mismatch' | 'not available in system entry' | 'missing from customer request' | 'review required' | 'optional not provided' | 'informational';
}
export interface GeneralAuditCheckSummary {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  discrepancyCount: number;
  reviewRequiredCount?: number;
  missingRequiredCount?: number;
  confidence: number;
}
export interface GeneralSemanticReview {
  reviewState?: GeneralProductReviewState;
  dosageFormKey?: string;
  kind?: 'product' | 'unparsed_text';
  field?: import('./generalAuditReviews').GeneralEssentialField;
  originalText: string;
  source: 'customer_request' | 'fulfillment_confirmation';
  possibleMatches: string[];
  reason: string;
}
export interface GeneralProductVerification {
  reviewState?: GeneralProductReviewState;
  key: string;
  productName: string;
  reason?: string;
  originalText: string;
  requestedQuantity: number;
  suggestedProduct?: string;
  suppliedQuantity: number;
  options: { key: string; name: string; fromFulfillment: boolean; reason?: string }[];
  status: 'customer confirmation required' | 'customer verified' | 'review required';
  requestedProducts: import('./generalAuditor').GeneralProductEvidence[];
  fulfillmentProducts: import('./generalAuditor').GeneralProductEvidence[];
  confirmationHistory?: NonNullable<GeneralProductVerification['confirmation']>[];
  confirmation?: {
    productName: string;
    productKey: string;
    inputFingerprint?: string;
    formulation: string;
    customerContactConfirmed: true;
    confirmedAt: string;
    confirmedBy?: { id: string; name: string };
  };
}
export interface GeneralOrderExtractionSnapshot {
  customer: GeneralExtractedMessage;
  fulfillment: GeneralExtractedMessage;
}
export interface GeneralExtractedMessage {
  facilityName: string | null;
  ordererName: string | null;
  products: {name: string; quantity: number | null; unit: string | null}[];
  unresolvedFields: string[];
}
export interface GeneralAuditDetails {
  extraction?: GeneralOrderExtractionSnapshot;
  productComparisonMode?: 'names_only' | 'names_and_quantities';
  productVerifications?: GeneralProductVerification[];
  dispatchReadiness?: { canDispatchAutomatically: boolean; requiresFacilityConfirmation: boolean };
  semanticReviews?: GeneralSemanticReview[];
  auditSummary?: GeneralAuditCheckSummary;
  facility: import('./generalFacility').GeneralFacilityResult;
  orderer: GeneralFieldResult;
  phone: GeneralFieldResult;
  dropArea?: GeneralFieldResult;
  district?: GeneralFieldResult;
  counts: { fullySupplied: number; outOfStock: number; orderLimited: number; pendingOrderLimits: number };
  productTotals?: { requested:number; matched:number; physicallyFulfilled:number; outOfStock:number; physicallySuppliedUnits?:number; missing?:number; quantityReview?:number; discrepancies?:number };
  productCount: { requested: number; found: number; status: 'match' | 'mismatch' };
  discrepancies: string[];
  products: GeneralProductResult[];
  orderLimitDecisions: Record<string, boolean>;
  pendingOrderLimitCount: number;
  stockStatus: 'in stock' | 'partially out of stock' | 'out of stock';
  finalStatus: string;
  message?: string;
  warnings?: string[];
}

export type GeneralFulfillmentStatus = 'fully supplied' | 'quantity review' | 'out of stock' | 'pending order limit' | 'order limit applied' | 'discrepancy';
export interface GeneralProductResult {
  productStatus?: GeneralProductReviewState;
  matchingStage?: import('./generalProductMatching').GeneralMatchingStage;
  clinicalAttributes?: import('./generalProductMatching').GeneralClinicalAttributes;
  category?: GeneralProductCategory;
  vaccineCompanionFor?: string;
  vaccinePairingError?: string;
  key: string;
  name: string;
  requested: number;
  supplied: number;
  confirmationRequested?: number;
  quantityReviewRequired?: boolean;
  stockStatus?: 'partially out of stock' | 'out of stock';
  outOfStockQuantity?: number;
  difference: number;
  fulfillmentStatus: GeneralFulfillmentStatus;
  orderLimitEligible: boolean;
  orderLimitDecision?: boolean;
  requestedUnit: string;
  suppliedUnit: string;
  quantityError?: string;
  requestedQuantityMissing?: boolean;
  suppliedQuantityMissing?: boolean;
  discrepancyKind: 'missing' | 'extra' | 'quantity' | 'identity';
  identityError?: string;
  registeredOutOfStock: boolean;
  conversion?: { requested: number; supplied: number; unit: string; factor: number; description: string };
}
