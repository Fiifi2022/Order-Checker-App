/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface VerificationItem {
  name: string;
  requested: string;
  found: string;
  status: 'match' | 'quantity mismatch' | 'missing item' | 'extra item' | 'out of stock';
  action?: string;
  category?: string;
}

export interface MetaField {
  whatsappValue: string;
  fulfillmentValue: string;
  status: 'match' | 'mismatch';
}

export interface OrderCheckResult {
  confidence: number;
  verdict: string;
  allMatch: boolean;
  issueCount: number;
  items: VerificationItem[];
  meta: {
    customerName: MetaField;
    phone: MetaField;
    facility: MetaField;
    date: MetaField;
    ordererName: MetaField;
    facilityName: MetaField;
    dropArea: MetaField;
    district: MetaField;
    deliveryTime: MetaField;
  };
  insights: string[];
}

export interface AuditRecord extends OrderCheckResult {
  id: string;
  timestamp: string;
  whatsappMessage: string;
  fulfillmentConfirmation: string;
  status: 'pending' | 'resolved' | 'ignored';
  resolutionNotes?: string;
  resolvedAt?: string;
}

export interface AuditAnalytics {
  totalChecked: number;
  perfectMatches: number;
  totalWithIssues: number;
  resolvedCount: number;
  mismatchTypeCounts: {
    quantityMismatch: number;
    missingItem: number;
    extraItem: number;
    metadataMismatch: number;
  };
  commonErrorsList: { item: string; occurrences: number; type: string }[];
}

export interface VerificationRequest {
  whatsappMessage: string;
  fulfillmentConfirmation: string;
}

export interface VaccineAllocationItem {
  carryOver?: number;
  original: number;
  taken: number;
  remaining: number;
  adjustment?: number;
}

export interface FacilityAllocation {
  id: string;
  facilityName: string;
  tabName?: string;
  district?: string;
  subDistrict?: string;
  nest?: string;
  cycle: string;
  vaccines: Record<string, VaccineAllocationItem>;
  updatedAt: string;
  updatedBy?: string;
}

export interface AllocationTransaction {
  id: string;
  facilityName: string;
  district?: string;
  subDistrict?: string;
  nest?: string;
  cycle: string;
  source: 'whatsapp' | 'fs_only';
  items: Array<{
    vaccine: string;
    requestedQty: number;
    previousTaken: number;
    currentOrder: number;
    remainingAfter: number;
  }>;
  timestamp: string;
  ccaUser: string;
  orderId?: string;
  rawOrderText?: string;
  rawFsText?: string;
}

export interface ParsedAllocationRow {
  facility: string;
  vaccine: string;
  allocation: number;
  carryOver?: number;
  taken?: number;
  remaining?: number;
  tabName?: string;
  district?: string;
  subDistrict?: string;
  nest?: string;
  cycle?: string;
}

export interface ScannedSheetTab {
  sheetName: string;
  isSubDistrictTab: boolean;
  detectedDistrict: string;
  detectedSubDistrict: string;
  subDistrictsFound: string[];
  isMatrixLayout: boolean;
  antigensFound: string[];
  facilityCount: number;
  rows: ParsedAllocationRow[];
  selectedForImport: boolean;
  rawPreviewRows: any[][];
}

export interface AllocationAdjustment {
  id: string;
  facilityName: string;
  vaccine: string;
  previousAllocation: number;
  adjustment: number;
  newAllocation: number;
  reason: string;
  user: string;
  timestamp: string;
}

export interface VaccineValidationItem {
  vaccine: string;
  originalAllocation: number;
  previouslyTaken: number;
  remainingBefore: number;
  requestedQty: number;
  fsQty: number;
  remainingAfter: number;
  status: 'valid' | 'excess_quantity' | 'product_mismatch' | 'not_allocated' | 'missing_product' | 'unexpected_product' | 'exhausted';
  errorDetail?: string;
  warningDetail?: string;
}

export interface VaccineValidationResult {
  isValid: boolean;
  orderSource: 'whatsapp' | 'fs_only';
  facilitySelected: string;
  facilityFoundInFs?: string;
  facilityMismatch: boolean;
  errors: string[];
  warnings: string[];
  items: VaccineValidationItem[];
  duplicateWarning?: {
    isDuplicate: boolean;
    message: string;
    recentTransactionId?: string;
    timeAgo?: string;
  };
  validatedAt: string;
}

export interface VaccineDashboardMetrics {
  totalFacilities: number;
  facilitiesWithRemaining: number;
  facilitiesExhausted: number;
  totalAllocated: number;
  totalOrdered: number;
  totalRemaining: number;
  errorsPrevented: number;
  duplicateAlerts: number;
}

