export interface GeneralFieldResult {
  whatsappValue: string;
  fulfillmentValue: string;
  status: 'match' | 'mismatch' | 'not available in system entry' | 'missing from customer request';
}
export interface GeneralAuditCheckSummary {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  discrepancyCount: number;
  confidence: number;
}
export interface GeneralSemanticReview {
  originalText: string;
  source: 'customer_request' | 'fulfillment_confirmation';
  possibleMatches: string[];
  reason: string;
}
export interface GeneralAuditDetails {
  semanticReviews?: GeneralSemanticReview[];
  auditSummary?: GeneralAuditCheckSummary;
  facility: GeneralFieldResult;
  orderer: GeneralFieldResult;
  phone: GeneralFieldResult;
  counts: { fullySupplied: number; outOfStock: number; orderLimited: number; pendingOrderLimits: number };
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

export type GeneralFulfillmentStatus = 'fully supplied' | 'out of stock' | 'pending order limit' | 'order limit applied' | 'discrepancy';
export interface GeneralProductResult {
  key: string;
  name: string;
  requested: number;
  supplied: number;
  difference: number;
  fulfillmentStatus: GeneralFulfillmentStatus;
  orderLimitEligible: boolean;
  orderLimitDecision?: boolean;
  requestedUnit: string;
  suppliedUnit: string;
  discrepancyKind: 'missing' | 'extra' | 'quantity';
  registeredOutOfStock: boolean;
  conversion?: { requested: number; supplied: number; unit: string; factor: number; description: string };
}
