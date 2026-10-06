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

export const DEFAULT_DOSES_PER_VIAL: Record<string, number> = {
  'BCG': 20,
  'OPV': 20,
  'Penta': 10,
  'PENTA': 10,
  'PCV': 2,
  'Rota': 1,
  'ROTA': 1,
  'MR': 10,
  'Yellow Fever': 10,
  'YF': 10,
  'Men A': 10,
  'MEN A': 10,
  'HPV': 1,
  'IPV': 10,
  'Td': 10,
  'TD': 10,
  'DT': 10,
  'R21': 10,
  'COVID-19': 10
};

export const SYRINGE_CONSUMABLE_PRODUCTS = [
  'Soloshot 0.05ml',
  'Soloshot 0.5ml',
  'Syringes and needles 2ml',
  'Syringes and needles 5ml'
] as const;

/**
 * On the Vaccine Dashboard:
 * The syringes (consumables) are:
 * 1. Soloshot 0.05ml
 * 2. Soloshot 0.5ml
 * 3. syringes and needles 2ml (or Syringe and needle 2ml)
 * 4. syringes and needles 5ml (or Syringe and needle 5ml)
 * And the rest are vaccine antigens.
 */
export function isDeviceProduct(productName: string): boolean {
  if (!productName) return false;
  const p = productName.toLowerCase().trim();

  // 1. Soloshot 0.05ml
  if (p.includes('soloshot') && (p.includes('0.05') || p.includes('0.05ml'))) {
    return true;
  }
  // 2. Soloshot 0.5ml
  if (p.includes('soloshot') && (p.includes('0.5') || p.includes('0.5ml'))) {
    return true;
  }
  if (p.startsWith('soloshot') || p.includes('soloshot')) {
    return true;
  }
  // 3. syringes and needles 2ml (or Syringe and needle 2ml)
  if ((p.includes('syringe') || p.includes('needle')) && (p.includes('2ml') || p.includes('2 ml') || p.includes('2.0ml'))) {
    return true;
  }
  // 4. syringes and needles 5ml (or Syringe and needle 5ml)
  if ((p.includes('syringe') || p.includes('needle')) && (p.includes('5ml') || p.includes('5 ml') || p.includes('5.0ml'))) {
    return true;
  }
  // Fallback for general syringe or needle naming
  if (p.includes('syringe') || p.includes('needle')) {
    return true;
  }

  // All other commodities are vaccine antigens
  return false;
}

export function isSyringeConsumable(productName: string): boolean {
  return isDeviceProduct(productName);
}

export function isVaccineAntigen(productName: string): boolean {
  return !isDeviceProduct(productName);
}

export function getProductCategory(productName: string): 'vaccine' | 'device' {
  return isDeviceProduct(productName) ? 'device' : 'vaccine';
}

export function getProductUnit(productName: string): 'vials' | 'pcs' {
  return isDeviceProduct(productName) ? 'pcs' : 'vials';
}

export function getVaccineDosesPerVial(vaccineName: string): number {
  if (!vaccineName) return 10;
  if (isDeviceProduct(vaccineName)) return 0;
  const upper = vaccineName.toUpperCase().trim();
  for (const [key, val] of Object.entries(DEFAULT_DOSES_PER_VIAL)) {
    if (upper === key.toUpperCase() || upper.includes(key.toUpperCase())) {
      return val;
    }
  }
  return 10;
}

export interface VaccineAllocationItem {
  carryOver?: number;           // in vials
  carryOverDoses?: number;      // in doses
  original: number;             // in vials
  originalDoses?: number;       // in doses
  topUp?: number;               // in vials
  topUpDoses?: number;          // in doses
  taken: number;                // in vials
  takenDoses?: number;          // in doses
  remaining: number;            // in vials
  remainingDoses?: number;      // in doses
  dosesPerVial?: number;        // e.g. 20 for BCG, 10 for Penta
  adjustment?: number;
  adjustmentDoses?: number;
  takenHistory?: string;
  takenHistoryDoses?: string;
}

export interface FacilityAllocation {
  id: string;
  sourceSheetId?: string;
  sourceRowId?: string;
  facilityName: string;
  deliverySite?: string;
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
    requestedDoses?: number;
    previousTaken: number;
    previousTakenDoses?: number;
    currentOrder: number;
    currentOrderDoses?: number;
    remainingAfter: number;
    remainingAfterDoses?: number;
    dosesPerVial?: number;
    unit?: 'vials' | 'doses' | 'both';
  }>;
  timestamp: string;
  ccaUser: string;
  orderId?: string;
  auditCheckId?: string;
  rawOrderText?: string;
  rawFsText?: string;
}

export interface ParsedAllocationRow {
  facility: string;
  vaccine: string;
  allocation: number;
  allocationDoses?: number;
  carryOver?: number;
  carryOverDoses?: number;
  topUp?: number;
  topUpDoses?: number;
  taken?: number;
  takenDoses?: number;
  remaining?: number;
  remainingDoses?: number;
  dosesPerVial?: number;
  takenHistory?: string;
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
  originalAllocation: number;       // vials
  originalDoses?: number;          // doses
  originalAllocationDoses?: number; // alias for doses
  previouslyTaken: number;         // vials
  previouslyTakenDoses?: number;   // doses
  takenHistory?: string;
  remainingBefore: number;         // vials
  remainingBeforeDoses?: number;   // doses
  requestedQty: number;            // vials
  requestedDoses?: number;         // doses
  fsQty: number;                   // vials
  fsDoses?: number;                // doses
  remainingAfter: number;          // vials
  remainingAfterDoses?: number;    // doses
  dosesPerVial?: number;           // doses per vial conversion
  unit?: 'vials' | 'doses' | 'both';
  status:
    | 'valid'
    | 'excess_quantity'
    | 'product_mismatch'
    | 'not_allocated'
    | 'missing_product'
    | 'out_of_stock'
    | 'unexpected_product'
    | 'exhausted'
    | 'quantity_mismatch'
    | 'not_in_order'
    | 'missing_diluent_dropper';
  fsPresent?: boolean;
  fulfillmentStatus?: 'out_of_stock' | 'missing_product' | 'partial' | 'quantity_mismatch';
  companionDiscrepancy?: { type: 'MISSING_COMPANION_PRODUCT' | 'COMPANION_QUANTITY_MISMATCH'; product: string; companion: string; productQuantity?: number; companionQuantity?: number };
  errorDetail?: string;
  warningDetail?: string;
  errors?: string[];
  isNotAllocated?: boolean;
  isExcess?: boolean;
  isQuantityMismatch?: boolean;
  isMissing?: boolean;
  isUnexpected?: boolean;
  isExhausted?: boolean;
}

export interface VaccineValidationResult {
  facilityId?: string;
  isValid: boolean;
  orderSource: 'whatsapp' | 'fs_only';
  facilitySelected: string;
  allocationSource?: string;
  district?: string;
  subDistrict?: string;
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
  auditLogId?: string;
}

export interface VaccineAuditLogRecord {
  id: string;
  timestamp: string;
  facilityId: string;
  facilityName: string;
  district?: string;
  subDistrict?: string;
  allocationSheet?: string;
  ccaUser: string;
  orderSource: 'whatsapp' | 'fs_only';
  productsChecked: Array<{
    vaccine: string;
    requestedQty: number;
    fsQty: number;
    availableRemaining: number;
    remainingAfter: number;
    status: string;
    errors?: string[];
  }>;
  auditResult: 'GREEN_LIGHT' | 'DO_NOT_PROCESS';
  errorsDetected: string[];
  confirmed: boolean;
  confirmedTransactionId?: string;
}

export interface BlueprintDistrictSummary {
  id: string;
  district: string;
  month: string;
  facilitiesCount: number;
  completedCount: number;
  inProgressCount: number;
  pendingCount: number;
  totalCarryOver: number;
  totalAllocation: number;
  totalDistributed: number;
  totalBalance: number;
  updatedAt?: string;
}

export interface VaccineDashboardMetrics {
  totalFacilities: number;
  facilitiesWithRemaining: number;
  facilitiesExhausted: number;
  // Vaccines-specific (Antigens - Vials & Doses)
  vaccineAllocated?: number;
  vaccineAllocatedDoses?: number;
  vaccineOrdered?: number;
  vaccineOrderedDoses?: number;
  vaccineRemaining?: number;
  vaccineRemainingDoses?: number;
  vaccineCarryOver?: number;
  vaccineCarryOverDoses?: number;
  vaccineNewAllocation?: number;
  vaccineNewAllocationDoses?: number;
  // Devices-specific (Syringes & Consumables - Pieces / Units)
  deviceAllocated?: number;
  deviceOrdered?: number;
  deviceRemaining?: number;
  deviceCarryOver?: number;
  deviceNewAllocation?: number;
  // Consolidated / Total Commodities
  totalAllocated: number;           // vials/pieces
  totalAllocatedDoses?: number;      // doses (antigens only)
  totalOrdered: number;             // vials/pieces
  totalOrderedDoses?: number;       // doses (antigens only)
  totalRemaining: number;           // vials/pieces
  totalRemainingDoses?: number;     // doses (antigens only)
  totalCarryOver?: number;          // vials/pieces
  totalCarryOverDoses?: number;     // doses (antigens only)
  totalNewAllocation?: number;      // vials/pieces
  totalNewAllocationDoses?: number; // doses (antigens only)
  errorsPrevented: number;
  duplicateAlerts: number;
  blueprintSyncInfo?: {
    totalDistricts: number;
    districts: BlueprintDistrictSummary[];
    activeDistrictId?: string;
    totalBlueprintFacilities: number;
    completedFacilities: number;
    inProgressFacilities: number;
    pendingFacilities: number;
    lastSyncedAt: string;
  };
}

export interface OrderItemDraft {
  id: string;
  vaccine: string;
  quantity: number;
  unit: 'vials' | 'doses';
  requestedQty?: number;
  requestedDoses?: number;
  fsQty?: number;
  fsDoses?: number;
  dosesPerVial?: number;
  notes?: string;
}

export type FacilityAllocationRecord = FacilityAllocation;

export interface DistrictSheetData {
  id: string;
  district: string;
  month: string;
  updatedAt?: string;
  products?: string[];
  rows: any[];
}

export type AppRole = 'admin' | 'warehouse' | 'cca' | 'auditor' | 'dco';

export interface UserRoleRecord {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  district?: string;
  avatar?: string;
  createdAt: string;
  updatedAt?: string;
  addedBy?: string;
}

export type ActivityModule =
  | 'vaccine_blueprint'
  | 'vaccine_checker'
  | 'vaccine_dashboard'
  | 'general_auditor'
  | 'app_system';

export type ActivityActionType =
  | 'blueprint_cell_edit'
  | 'blueprint_status_change'
  | 'blueprint_row_added'
  | 'blueprint_row_deleted'
  | 'blueprint_cycle_created'
  | 'blueprint_district_renamed'
  | 'blueprint_sheet_reset'
  | 'checker_order_verified'
  | 'checker_order_confirmed'
  | 'checker_quota_adjusted'
  | 'page_view'
  | 'role_switched';

export interface ActivityActor {
  id?: string;
  name: string;
  email: string;
  role: AppRole | string;
  district?: string;
  avatar?: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  module: ActivityModule;
  actionType: ActivityActionType;
  title: string;
  summary: string;
  actor: ActivityActor;
  facility?: string;
  district?: string;
  cycle?: string;
  badgeType?: 'info' | 'success' | 'warning' | 'error' | 'purple';
  details?: {
    product?: string;
    field?: string;
    oldValue?: any;
    newValue?: any;
    diff?: string;
    verdict?: 'GREEN_LIGHT' | 'DO_NOT_PROCESS' | 'SUCCESS' | string;
    errorsDetected?: string[];
    items?: Array<{
      vaccine: string;
      requestedQty?: number;
      requestedDoses?: number;
      fsQty?: number;
      fsDoses?: number;
      availableRemaining?: number;
      previousTaken?: number;
      currentOrder?: number;
      remainingAfter?: number;
      dosesPerVial?: number;
      status?: string;
      unit?: string;
    }>;
    transactionId?: string;
    auditCheckId?: string;
    facilityId?: string;
    orderId?: string;
    verificationStartedAt?: string;
    verificationCompletedAt?: string;
    durationSec?: number;
    orderSource?: string;
    clientSource?: string;
    metadata?: Record<string, any>;
  };
}

export interface AppUsageMetrics {
  totalActivities: number;
  todayActivities: number;
  byModule: Record<string, number>;
  byActionType: Record<string, number>;
  byActor: Array<{
    id?: string;
    name: string;
    email: string;
    role: string;
    district?: string;
    totalActions: number;
    cellEditsCount: number;
    ordersCheckedCount: number;
    ordersConfirmedCount: number;
    lastActive: string;
  }>;
  recentEditsCount: number;
  ordersVerifiedCount: number;
  ordersConfirmedCount: number;
  errorsPreventedCount: number;
  statusChangesCount: number;
}


