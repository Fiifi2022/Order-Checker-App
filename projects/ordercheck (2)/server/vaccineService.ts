/**
 * Vaccine Allocation Validation & Tracking Service
 * Authoritative transactional service for DCO vaccine allocations,
 * WhatsApp/FS cross-validation, concurrency protection, and audit logs.
 */

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

export function isDeviceProduct(productName: string): boolean {
  if (!productName) return false;
  const upper = productName.toUpperCase().trim();
  return (
    upper.includes('SOLOSHOT') ||
    upper.includes('SYRINGE') ||
    upper.includes('NEEDLE') ||
    upper.includes('SAFETY BOX')
  );
}

export function getDosesPerVial(vaccineName: string): number {
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

export interface VaccineAllocationDetail {
  original: number;            // vials
  originalDoses?: number;       // doses
  taken: number;               // vials
  takenDoses?: number;         // doses
  remaining: number;           // vials
  remainingDoses?: number;     // doses
  adjustment?: number;
  adjustmentDoses?: number;
  carryOver?: number;
  carryOverDoses?: number;
  topUp?: number;
  topUpDoses?: number;
  dosesPerVial?: number;
  takenHistory?: string;
  takenHistoryDoses?: string;
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
    requestedDoses?: number;
    fsQty: number;
    fsDoses?: number;
    availableRemaining: number;
    availableRemainingDoses?: number;
    remainingAfter: number;
    remainingAfterDoses?: number;
    dosesPerVial?: number;
    status: string;
    errors?: string[];
  }>;
  auditResult: 'GREEN_LIGHT' | 'DO_NOT_PROCESS';
  errorsDetected: string[];
  confirmed: boolean;
  confirmedTransactionId?: string;
}

export interface FacilityAllocationRecord {
  id: string;
  facilityName: string;
  tabName?: string;
  district: string;
  subDistrict?: string;
  nest: string;
  cycle: string;
  vaccines: Record<string, VaccineAllocationDetail>;
  updatedAt: string;
  updatedBy: string;
}

export interface AllocationTransactionRecord {
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
  rawOrderText?: string;
  rawFsText?: string;
  status: 'confirmed';
}

export interface AllocationAdjustmentRecord {
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

// Canonical vaccine alias mapping
const DEFAULT_ALIASES: Record<string, string[]> = {
  // Specific Diluents & Droppers first to prevent substring collisions
  'BCG Diluent': ['bcg diluent', 'diluent for bcg', 'bcg vaccine diluent', 'diluent bcg', 'bacille calmette guerin vaccine diluent'],
  'MR Diluent': ['mr diluent', 'measles diluent', 'diluent for mr', 'measles-rubella diluent', 'diluent mr', 'measles rubella vaccine diluent'],
  'Yellow Fever Diluent': ['yf diluent', 'yellow fever diluent', 'diluent for yellow fever', 'diluent yf', 'yellow fever vaccine diluent'],
  'Men A Diluent': ['men a diluent', 'mena diluent', 'meningococcal diluent', 'diluent for men a', 'meningitis a vaccine diluent'],
  'OPV Dropper': ['opv dropper', 'opv droppers', 'dropper for opv', 'polio dropper', 'polio droppers', 'oral polio vaccine dropper'],
  'Rota Dropper': ['rota dropper', 'rota droppers', 'rotavirus dropper', 'rotavirus droppers', 'rotavirus vaccine dropper'],

  // Core Vaccines
  'BCG': ['bcg', 'bcg vaccine', 'bcg inj', 'bacillus calmette-guerin', 'bacille calmette-guerin vaccine', 'bcg injection'],
  'OPV': ['opv', 'bopv', 'oral polio', 'oral polio vaccine', 'oral polio vaccine (1&3)', 'opv vaccine', 'bopv vaccine', 'polio oral', 'oral polio drops'],
  'Penta': ['penta', 'pentavalent', 'penta vaccine', 'pentavalent vaccine', 'pentavalent (5-in-1) vaccine', 'dtp-hep b-hib', 'dtp-hepb-hib', 'pentavalent (dtp-hepb-hib)'],
  'PCV': ['pcv', 'pcv13', 'pneumococcal', 'pneumococcal vaccine', 'pcv vaccine', 'pneumococcal conjugate', 'pneumococcal conjugate vaccine'],
  'Rota': ['rota', 'rotavirus', 'rotavirus vaccine', 'rota vaccine', 'rotasiil', 'rotarix'],
  'MR': ['mr', 'measles rubella', 'measles-rubella', 'mr vaccine', 'measles rubella vaccine', 'measles-rubella vaccine', 'measles and rubella', 'measles vaccine', 'measles'],
  'Yellow Fever': ['yellow fever', 'yf', 'yf vaccine', 'yellow fever vaccine', 'stamaril'],
  'Men A': ['men a', 'mena', 'men-a', 'men a vaccine', 'menafrivac', 'meningococcal a', 'meningococcal a conjugate', 'meningitis a', 'meningitis a vaccine'],
  'HPV': ['hpv', 'human papillomavirus', 'human papillomavirus vaccine', 'gardasil', 'hpv vaccine'],
  'IPV': ['ipv', 'inactivated polio', 'inactivated polio vaccine'],
  'DT': ['dt', 'td', 'tetanus diphtheria', 'tetanus-diphtheria', 'tetanus diphtheria vaccine', 'diphtheria and tetanus vaccine', 'diphtheria & tetanus vaccine', 'tt', 'tetanus toxoid'],
  'COVID-19': ['covid', 'covid-19', 'pfizer', 'moderna', 'johnson & johnson', 'astrazeneca']
};

let customAliases: Record<string, string[]> = { ...DEFAULT_ALIASES };

// In-memory collections with fast locking
const facilitiesStore: Map<string, FacilityAllocationRecord> = new Map();
const transactionsStore: AllocationTransactionRecord[] = [];
const adjustmentsStore: AllocationAdjustmentRecord[] = [];
const auditLogsStore: VaccineAuditLogRecord[] = [];
let errorsPreventedCount = 0;
let duplicateAlertsCount = 0;

export function getAuditLogs(): VaccineAuditLogRecord[] {
  return auditLogsStore;
}

export function clearAuditLogs(): void {
  auditLogsStore.length = 0;
}

// Mutex lock map to ensure true atomicity per facility during multi-CCA orders
const facilityLocks: Map<string, boolean> = new Map();

export function getAliases() {
  return customAliases;
}

export function updateAliases(updated: Record<string, string[]>) {
  customAliases = { ...DEFAULT_ALIASES, ...updated };
  return customAliases;
}

// Normalize names consistently while preserving the distinction between vaccines and accessories.
function normalizeProductName(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchVaccineName(rawName: string): { canonical: string; confidence: 'high' | 'medium' | 'none' } {
  if (!rawName?.trim()) return { canonical: rawName, confidence: 'none' };
  const normalized = normalizeProductName(rawName);
  const aliasEntries = Object.entries(customAliases)
    .flatMap(([canonical, aliases]) => [canonical, ...aliases].map(alias => ({
      canonical,
      alias: normalizeProductName(alias),
      isAccessory: /\b(diluent|dropper)\b/i.test(canonical)
    })))
    .sort((a, b) => b.alias.length - a.alias.length);

  // Exact normalized names take precedence, with longest aliases first.
  const exactMatch = aliasEntries.find(entry => entry.alias === normalized);
  if (exactMatch) return { canonical: exactMatch.canonical, confidence: 'high' };

  // For names containing extra words, check accessories first, then vaccines.
  // Keeping the two product classes separate prevents e.g. "Rota Dropper"
  // from falling through to the broader "Rota" alias.
  const inputIsAccessory = /\b(diluent|dropper)\b/.test(normalized);
  for (const accessoryPass of [true, false]) {
    if (accessoryPass !== inputIsAccessory) continue;
    const match = aliasEntries.find(entry =>
      entry.isAccessory === accessoryPass &&
      entry.alias.length > 2 &&
      (` ${normalized} `).includes(` ${entry.alias} `)
    );
    if (match) return { canonical: match.canonical, confidence: 'high' };
  }

  return { canonical: rawName.trim(), confidence: 'none' };
}

// Helper to build standardized audit-accurate vaccine detail with both vials and doses
export function buildVaccineDetail(vaccine: string, raw: {
  original: number;
  taken: number;
  remaining?: number;
  adjustment?: number;
  carryOver?: number;
  topUp?: number;
  takenHistory?: string;
}): VaccineAllocationDetail {
  const isDevice = isDeviceProduct(vaccine);
  const dosesPerVial = isDevice ? 0 : getDosesPerVial(vaccine);
  const carryOver = raw.carryOver || 0;
  const original = raw.original || 0;
  const topUp = raw.topUp || 0;
  const taken = raw.taken || 0;
  const adjustment = raw.adjustment || 0;
  const totalAuth = carryOver + original + topUp + adjustment;
  const remaining = raw.remaining !== undefined ? raw.remaining : Math.max(0, totalAuth - taken);

  return {
    original,
    originalDoses: isDevice ? undefined : original * dosesPerVial,
    taken,
    takenDoses: isDevice ? undefined : taken * dosesPerVial,
    remaining,
    remainingDoses: isDevice ? undefined : remaining * dosesPerVial,
    carryOver,
    carryOverDoses: isDevice ? undefined : carryOver * dosesPerVial,
    topUp,
    topUpDoses: isDevice ? undefined : topUp * dosesPerVial,
    adjustment,
    adjustmentDoses: isDevice ? undefined : adjustment * dosesPerVial,
    dosesPerVial: isDevice ? 0 : dosesPerVial,
    takenHistory: raw.takenHistory
  };
}

// Helper to build standardized audit-accurate demo facility records
function makeDemoFac(
  id: string,
  facilityName: string,
  tabName: string,
  district: string,
  subDistrict: string,
  baseAlloc: number,
  scale: number = 1
): FacilityAllocationRecord {
  const round = (val: number) => Math.max(0, Math.round(val));
  const s = scale;
  return {
    id,
    facilityName,
    tabName,
    district,
    subDistrict,
    nest: 'Northern Nest',
    cycle: 'September 2026',
    vaccines: {
      'BCG': buildVaccineDetail('BCG', { carryOver: round(15 * s), original: round(baseAlloc * 1.0 * s), topUp: 0, taken: round(baseAlloc * 0.3 * s), remaining: round((15 * s) + (baseAlloc * 0.7 * s)) }),
      'OPV': buildVaccineDetail('OPV', { carryOver: round(25 * s), original: round(baseAlloc * 1.6 * s), topUp: 0, taken: round(baseAlloc * 0.5 * s), remaining: round((25 * s) + (baseAlloc * 1.1 * s)) }),
      'Penta': buildVaccineDetail('Penta', { carryOver: round(20 * s), original: round(baseAlloc * 1.2 * s), topUp: 0, taken: round(baseAlloc * 0.4 * s), remaining: round((20 * s) + (baseAlloc * 0.8 * s)) }),
      'PCV': buildVaccineDetail('PCV', { carryOver: round(15 * s), original: round(baseAlloc * 0.9 * s), topUp: 0, taken: round(baseAlloc * 0.3 * s), remaining: round((15 * s) + (baseAlloc * 0.6 * s)) }),
      'Rota': buildVaccineDetail('Rota', { carryOver: round(12 * s), original: round(baseAlloc * 0.8 * s), topUp: 0, taken: round(baseAlloc * 0.25 * s), remaining: round((12 * s) + (baseAlloc * 0.55 * s)) }),
      'MR': buildVaccineDetail('MR', { carryOver: round(10 * s), original: round(baseAlloc * 0.65 * s), topUp: 0, taken: round(baseAlloc * 0.2 * s), remaining: round((10 * s) + (baseAlloc * 0.45 * s)) }),
      'Yellow Fever': buildVaccineDetail('Yellow Fever', { carryOver: round(8 * s), original: round(baseAlloc * 0.5 * s), topUp: 0, taken: round(baseAlloc * 0.15 * s), remaining: round((8 * s) + (baseAlloc * 0.35 * s)) })
    },
    updatedAt: new Date().toISOString(),
    updatedBy: 'DCO Central Depot'
  };
}

// Default Seed Data according to operational tabs:
// Karaga (26 facilities, 8 sub-districts), West Mamprusi (28 facilities), MMD (18 facilities), East Mamprusi (21 facilities), Bunkpurugu (1 facility)
export function getInitialDemoFacilities(): FacilityAllocationRecord[] {
  return [
    // -----------------------------------------------------------------------------------------
    // TAB 1: Karaga September allocation (District: Karaga) - 26 facilities across 8 sub-districts
    // -----------------------------------------------------------------------------------------
    // Sub-district 1: Karaga Central
    {
      id: 'konkoma_sda_clinic',
      facilityName: 'Konkoma SDA Clinic',
      tabName: 'Karaga September allocation',
      district: 'Karaga',
      subDistrict: 'Karaga Central',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      vaccines: {
        'BCG': buildVaccineDetail('BCG', { original: 50, taken: 20, remaining: 30, carryOver: 0, topUp: 0, takenHistory: '10 + 10' }),
        'OPV': buildVaccineDetail('OPV', { original: 100, taken: 70, remaining: 30, carryOver: 0, topUp: 0, takenHistory: '50 + 20' }),
        'Penta': buildVaccineDetail('Penta', { original: 60, taken: 40, remaining: 20, carryOver: 0, topUp: 0, takenHistory: '30 + 10' }),
        'PCV': buildVaccineDetail('PCV', { original: 40, taken: 25, remaining: 15, carryOver: 0, topUp: 0 }),
        'Rota': buildVaccineDetail('Rota', { original: 30, taken: 15, remaining: 15, carryOver: 0, topUp: 0 }),
        'MR': buildVaccineDetail('MR', { original: 30, taken: 30, remaining: 0, carryOver: 0, topUp: 0, takenHistory: '15 + 15' }),
        'Yellow Fever': buildVaccineDetail('Yellow Fever', { original: 20, taken: 10, remaining: 10, carryOver: 0, topUp: 0 })
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    makeDemoFac('karaga_district_hospital', 'Karaga District Hospital', 'Karaga September allocation', 'Karaga', 'Karaga Central', 100, 1.3),
    makeDemoFac('karaga_health_centre', 'Karaga Health Centre', 'Karaga September allocation', 'Karaga', 'Karaga Central', 70, 1.0),
    makeDemoFac('karaga_youth_centre_chps', 'Karaga Youth Centre CHPS', 'Karaga September allocation', 'Karaga', 'Karaga Central', 40, 0.7),
    makeDemoFac('yamokaraga_chps', 'Yamokaraga CHPS', 'Karaga September allocation', 'Karaga', 'Karaga Central', 35, 0.6),

    // Sub-district 2: Pigu Sub-district (3 facilities)
    makeDemoFac('pigu_health_centre', 'Pigu Health Centre', 'Karaga September allocation', 'Karaga', 'Pigu Sub-district', 65, 1.0),
    makeDemoFac('nyabilsi_chps', 'Nyabilsi CHPS', 'Karaga September allocation', 'Karaga', 'Pigu Sub-district', 35, 0.6),
    makeDemoFac('gaa_chps', 'Gaa CHPS', 'Karaga September allocation', 'Karaga', 'Pigu Sub-district', 30, 0.6),

    // Sub-district 3: Nyong Sub-district (3 facilities)
    makeDemoFac('nyong_chps', 'Nyong CHPS Compound', 'Karaga September allocation', 'Karaga', 'Nyong Sub-district', 45, 0.7),
    makeDemoFac('nyong_gbungbaliga_chps', 'Nyong Gbungbaliga CHPS', 'Karaga September allocation', 'Karaga', 'Nyong Sub-district', 30, 0.5),
    makeDemoFac('kpali_chps', 'Kpali CHPS', 'Karaga September allocation', 'Karaga', 'Nyong Sub-district', 30, 0.5),

    // Sub-district 4: Tong Sub-district (3 facilities)
    makeDemoFac('tong_health_centre', 'Tong Health Centre', 'Karaga September allocation', 'Karaga', 'Tong Sub-district', 60, 0.9),
    makeDemoFac('zong_chps', 'Zong CHPS', 'Karaga September allocation', 'Karaga', 'Tong Sub-district', 30, 0.5),
    makeDemoFac('shebo_chps', 'Shebo CHPS', 'Karaga September allocation', 'Karaga', 'Tong Sub-district', 25, 0.5),

    // Sub-district 5: Zandua Sub-district (3 facilities)
    makeDemoFac('zandua_health_centre', 'Zandua Health Centre', 'Karaga September allocation', 'Karaga', 'Zandua Sub-district', 60, 0.9),
    makeDemoFac('tuunayili_chps', 'Tuunayili CHPS', 'Karaga September allocation', 'Karaga', 'Zandua Sub-district', 30, 0.5),
    makeDemoFac('namburugu_chps', 'Namburugu CHPS', 'Karaga September allocation', 'Karaga', 'Zandua Sub-district', 25, 0.5),

    // Sub-district 6: Sakulo Sub-district (3 facilities)
    makeDemoFac('sakulo_health_centre', 'Sakulo Health Centre', 'Karaga September allocation', 'Karaga', 'Sakulo Sub-district', 60, 0.9),
    makeDemoFac('gunayili_chps', 'Gunayili CHPS', 'Karaga September allocation', 'Karaga', 'Sakulo Sub-district', 30, 0.5),
    makeDemoFac('tampio_chps', 'Tampio CHPS', 'Karaga September allocation', 'Karaga', 'Sakulo Sub-district', 25, 0.5),

    // Sub-district 7: Badenga Sub-district (4 facilities)
    makeDemoFac('badenga_health_centre', 'Badenga Health Centre', 'Karaga September allocation', 'Karaga', 'Badenga Sub-district', 65, 0.9),
    makeDemoFac('kpatinga_chps', 'Kpatinga CHPS', 'Karaga September allocation', 'Karaga', 'Badenga Sub-district', 30, 0.5),
    makeDemoFac('nandua_chps', 'Nandua CHPS', 'Karaga September allocation', 'Karaga', 'Badenga Sub-district', 25, 0.5),
    makeDemoFac('bagurugu_chps', 'Bagurugu CHPS', 'Karaga September allocation', 'Karaga', 'Badenga Sub-district', 25, 0.5),

    // Sub-district 8: Kudani Sub-district (3 facilities)
    makeDemoFac('kudani_health_centre', 'Kudani Health Centre', 'Karaga September allocation', 'Karaga', 'Kudani Sub-district', 60, 0.9),
    makeDemoFac('demong_chps', 'Demong CHPS', 'Karaga September allocation', 'Karaga', 'Kudani Sub-district', 30, 0.5),
    makeDemoFac('gushie_chps', 'Gushie CHPS', 'Karaga September allocation', 'Karaga', 'Kudani Sub-district', 25, 0.5),

    // -----------------------------------------------------------------------------------------
    // TAB 2: West Mamprusi Sep (District: West Mamprusi) - 28 facilities
    // -----------------------------------------------------------------------------------------
    makeDemoFac('walewale_municipal_hospital', 'Walewale Municipal Hospital', 'West Mamprusi Sep', 'West Mamprusi', 'Walewale Central', 120, 1.4),
    makeDemoFac('walewale_health_centre', 'Walewale Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Walewale Central', 75, 1.0),
    makeDemoFac('walewale_urban_chps', 'Walewale Urban CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Walewale Central', 40, 0.6),
    makeDemoFac('wulugu_health_centre', 'Wulugu Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Wulugu Sub-district', 70, 1.0),
    makeDemoFac('wulugu_west_chps', 'Wulugu West CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Wulugu Sub-district', 35, 0.6),
    makeDemoFac('kparigu_health_centre', 'Kparigu Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Kparigu Sub-district', 65, 0.9),
    makeDemoFac('kparigu_north_chps', 'Kparigu North CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Kparigu Sub-district', 30, 0.5),
    makeDemoFac('kparigu_west_chps', 'Kparigu West CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Kparigu Sub-district', 30, 0.5),
    makeDemoFac('janga_health_centre', 'Janga Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Janga Sub-district', 70, 1.0),
    makeDemoFac('janga_chps', 'Janga CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Janga Sub-district', 35, 0.6),
    makeDemoFac('nasia_health_centre', 'Nasia Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Nasia Sub-district', 65, 0.9),
    makeDemoFac('nasia_south_chps', 'Nasia South CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Nasia Sub-district', 30, 0.5),
    makeDemoFac('gbimsi_health_centre', 'Gbimsi Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Gbimsi Sub-district', 65, 0.9),
    makeDemoFac('gbimsi_east_chps', 'Gbimsi East CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Gbimsi Sub-district', 30, 0.5),
    makeDemoFac('guabuliga_chps', 'Guabuliga CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Walewale Central', 35, 0.6),
    makeDemoFac('loagri_no_1_chps', 'Loagri No 1 CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Wulugu Sub-district', 30, 0.5),
    makeDemoFac('duu_chps', 'Duu CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Wulugu Sub-district', 25, 0.5),
    makeDemoFac('kpasenkpe_health_centre', 'Kpasenkpe Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Wungu Sub-district', 60, 0.9),
    makeDemoFac('kpasenkpe_chps', 'Kpasenkpe CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Wungu Sub-district', 30, 0.5),
    makeDemoFac('arigu_chps', 'Arigu CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Janga Sub-district', 30, 0.5),
    makeDemoFac('fongni_chps', 'Fongni CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Janga Sub-district', 25, 0.5),
    makeDemoFac('nayorku_chps', 'Nayorku CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Walewale Central', 30, 0.5),
    makeDemoFac('tinguri_chps', 'Tinguri CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Gbimsi Sub-district', 30, 0.5),
    makeDemoFac('zua_chps', 'Zua CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Kparigu Sub-district', 30, 0.5),
    makeDemoFac('wungu_health_centre', 'Wungu Health Centre', 'West Mamprusi Sep', 'West Mamprusi', 'Wungu Sub-district', 65, 0.9),
    makeDemoFac('wungu_east_chps', 'Wungu East CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Wungu Sub-district', 30, 0.5),
    makeDemoFac('banawa_chps', 'Banawa CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Nasia Sub-district', 25, 0.5),
    makeDemoFac('bugya_chps', 'Bugya CHPS', 'West Mamprusi Sep', 'West Mamprusi', 'Wungu Sub-district', 25, 0.5),

    // -----------------------------------------------------------------------------------------
    // TAB 3: MMD Sep (Mamprugu Moagduri) - 18 facilities
    // -----------------------------------------------------------------------------------------
    makeDemoFac('yagaba_health_centre', 'Yagaba Health Centre', 'MMD Sep', 'MMD', 'Yagaba Sub-district', 75, 1.0),
    makeDemoFac('yagaba_central_chps', 'Yagaba Central CHPS', 'MMD Sep', 'MMD', 'Yagaba Sub-district', 35, 0.6),
    makeDemoFac('kubori_health_centre', 'Kubori Health Centre', 'MMD Sep', 'MMD', 'Kubori Sub-district', 70, 1.0),
    makeDemoFac('kubori_east_chps', 'Kubori East CHPS', 'MMD Sep', 'MMD', 'Kubori Sub-district', 30, 0.5),
    makeDemoFac('soo_chps_compound', 'Soo CHPS Compound', 'MMD Sep', 'MMD', 'Soo Sub-district', 35, 0.6),
    makeDemoFac('soo_north_chps', 'Soo North CHPS', 'MMD Sep', 'MMD', 'Soo Sub-district', 25, 0.5),
    makeDemoFac('kunkua_health_centre', 'Kunkua Health Centre', 'MMD Sep', 'MMD', 'Kunkua Sub-district', 65, 0.9),
    makeDemoFac('kunkua_west_chps', 'Kunkua West CHPS', 'MMD Sep', 'MMD', 'Kunkua Sub-district', 30, 0.5),
    makeDemoFac('mankarigu_health_centre', 'Mankarigu Health Centre', 'MMD Sep', 'MMD', 'Mankarigu Sub-district', 65, 0.9),
    makeDemoFac('mankarigu_chps', 'Mankarigu CHPS', 'MMD Sep', 'MMD', 'Mankarigu Sub-district', 30, 0.5),
    makeDemoFac('katigri_chps', 'Katigri CHPS', 'MMD Sep', 'MMD', 'Yagaba Sub-district', 25, 0.5),
    makeDemoFac('zanwara_chps', 'Zanwara CHPS', 'MMD Sep', 'MMD', 'Kubori Sub-district', 30, 0.5),
    makeDemoFac('jadema_chps', 'Jadema CHPS', 'MMD Sep', 'MMD', 'Soo Sub-district', 25, 0.5),
    makeDemoFac('sakpaba_chps', 'Sakpaba CHPS', 'MMD Sep', 'MMD', 'Kunkua Sub-district', 25, 0.5),
    makeDemoFac('yizesi_health_centre', 'Yizesi Health Centre', 'MMD Sep', 'MMD', 'Yizesi Sub-district', 65, 0.9),
    makeDemoFac('yizesi_south_chps', 'Yizesi South CHPS', 'MMD Sep', 'MMD', 'Yizesi Sub-district', 30, 0.5),
    makeDemoFac('primisi_chps', 'Primisi CHPS', 'MMD Sep', 'MMD', 'Yizesi Sub-district', 25, 0.5),
    makeDemoFac('tuvuu_chps', 'Tuvuu CHPS', 'MMD Sep', 'MMD', 'Mankarigu Sub-district', 25, 0.5),

    // -----------------------------------------------------------------------------------------
    // TAB 4: East Mamprusi Sept (District: East Mamprusi) - 21 facilities
    // -----------------------------------------------------------------------------------------
    makeDemoFac('gambaga_health_centre', 'Gambaga Health Centre', 'East Mamprusi Sept', 'East Mamprusi', 'Gambaga Central', 85, 1.1),
    makeDemoFac('gambaga_east_chps', 'Gambaga East CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Gambaga Central', 35, 0.6),
    makeDemoFac('gambaga_west_chps', 'Gambaga West CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Gambaga Central', 30, 0.5),
    makeDemoFac('nalerigu_baptist_medical_centre', 'Nalerigu Baptist Medical Centre', 'East Mamprusi Sept', 'East Mamprusi', 'Nalerigu Sub-district', 150, 1.6),
    makeDemoFac('nalerigu_health_centre', 'Nalerigu Health Centre', 'East Mamprusi Sept', 'East Mamprusi', 'Nalerigu Sub-district', 80, 1.0),
    makeDemoFac('nalerigu_urban_chps', 'Nalerigu Urban CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Nalerigu Sub-district', 35, 0.6),
    makeDemoFac('langbinsi_health_centre', 'Langbinsi Health Centre', 'East Mamprusi Sept', 'East Mamprusi', 'Langbinsi Sub-district', 70, 1.0),
    makeDemoFac('langbinsi_central_chps', 'Langbinsi Central CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Langbinsi Sub-district', 35, 0.6),
    makeDemoFac('sakogu_health_centre', 'Sakogu Health Centre', 'East Mamprusi Sept', 'East Mamprusi', 'Sakogu Sub-district', 70, 1.0),
    makeDemoFac('sakogu_chps', 'Sakogu CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Sakogu Sub-district', 30, 0.5),
    makeDemoFac('bongbini_chps', 'Bongbini CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Gambaga Central', 30, 0.5),
    makeDemoFac('dagbiriboari_chps', 'Dagbiriboari CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Langbinsi Sub-district', 30, 0.5),
    makeDemoFac('gbandaa_chps', 'Gbandaa CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Sakogu Sub-district', 25, 0.5),
    makeDemoFac('jawani_chps', 'Jawani CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Nalerigu Sub-district', 30, 0.5),
    makeDemoFac('kolinvai_chps', 'Kolinvai CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Gambaga Central', 25, 0.5),
    makeDemoFac('nagboo_chps', 'Nagboo CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Nalerigu Sub-district', 30, 0.5),
    makeDemoFac('namasim_chps', 'Namasim CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Langbinsi Sub-district', 25, 0.5),
    makeDemoFac('samini_chps', 'Samini CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Gambaga Central', 25, 0.5),
    makeDemoFac('wundua_chps', 'Wundua CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Sakogu Sub-district', 25, 0.5),
    makeDemoFac('zandua_east_chps', 'Zandua East CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Langbinsi Sub-district', 25, 0.5),
    makeDemoFac('binde_chps', 'Binde CHPS', 'East Mamprusi Sept', 'East Mamprusi', 'Sakogu Sub-district', 30, 0.5),

    // -----------------------------------------------------------------------------------------
    // TAB 5: Bunkpurugu Sept (District: Bunkpurugu) - 1 facility
    // -----------------------------------------------------------------------------------------
    makeDemoFac('bunkpurugu_district_hospital', 'Bunkpurugu District Hospital', 'Bunkpurugu Sept', 'Bunkpurugu', 'Bunkpurugu Central', 120, 1.3)
  ];
}

let hasBeenExplicitlyCleared = true;

// Service starts blank by default until an allocation file is uploaded
export function initializeService() {
  if (facilitiesStore.size === 0 && !hasBeenExplicitlyCleared) {
    const demo = getInitialDemoFacilities();
    for (const f of demo) {
      facilitiesStore.set(f.id, f);
    }
  }
}
initializeService();

export function getAllFacilities(): FacilityAllocationRecord[] {
  return Array.from(facilitiesStore.values());
}

export function getFacilityById(id: string): FacilityAllocationRecord | undefined {
  return facilitiesStore.get(id);
}

export function getFacilityByName(name: string): FacilityAllocationRecord | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase().trim();
  for (const f of facilitiesStore.values()) {
    if (f.facilityName.toLowerCase().trim() === lower) {
      return f;
    }
  }
  // Loose matching for slight variations (e.g. "Konkoma SDA", "Konkoma Clinic")
  for (const f of facilitiesStore.values()) {
    const fLower = f.facilityName.toLowerCase();
    if (fLower.includes(lower) || lower.includes(fLower)) {
      return f;
    }
  }
  return undefined;
}

export function getFacilityByNameAndTab(name: string, tabName?: string): FacilityAllocationRecord | undefined {
  if (!name) return undefined;
  const lowerName = name.toLowerCase().trim();
  const lowerTab = tabName ? tabName.toLowerCase().trim() : '';

  if (lowerTab) {
    for (const f of facilitiesStore.values()) {
      if (
        f.facilityName.toLowerCase().trim() === lowerName &&
        f.tabName &&
        f.tabName.toLowerCase().trim() === lowerTab
      ) {
        return f;
      }
    }
  }
  return undefined;
}

export function resetDemoAllocations(): FacilityAllocationRecord[] {
  hasBeenExplicitlyCleared = false;
  facilitiesStore.clear();
  const demo = getInitialDemoFacilities();
  for (const f of demo) {
    facilitiesStore.set(f.id, f);
  }
  return getAllFacilities();
}

/**
 * Clears previous allocation records to pave the way for a new cycle.
 * Prepares system for live operational use.
 */
export function clearAllAllocations(options?: { clearHistory?: boolean; newCycleName?: string }) {
  facilitiesStore.clear();
  hasBeenExplicitlyCleared = true;
  transactionsStore.length = 0;
  adjustmentsStore.length = 0;
  auditLogsStore.length = 0;
  errorsPreventedCount = 0;
  duplicateAlertsCount = 0;
  facilityLocks.clear();

  return {
    success: true,
    message: 'All allocation records, transactions, adjustments, and audit logs cleared. Ready for new cycle upload.',
    facilitiesCount: 0
  };
}

export type FsProductType = 'PRIMARY_VACCINE' | 'DILUENT' | 'DROPPER' | 'OTHER_ACCESSORY';

export interface ParsedVaccineLine {
  rawName: string;
  canonical: string;
  productType: FsProductType;
  quantity: number;
  quantityDoses: number;
  dosesPerVial: number;
  unit: 'vials' | 'doses' | 'unspecified';
  confidence: string;
  isPairingItem?: boolean;
  pairingFor?: string;
}

export interface ParsedVaccineLinesResult {
  items: ParsedVaccineLine[];
  errors: string[];
}

const FS_METADATA_LINE = /^(?:(?:facility|hospital|clinic|district|order|phone|contact|date|delivered|received|status|dr|cca|to|for|recipient|dispatch)\s*[:=–—].*|(?:packing slip|items loaded|order verified))$/i;
const PRODUCT_LINE_HINT = /\b(vaccine|bcg|opv|penta|pentavalent|pcv|pneumococcal|rota|rotavirus|mr|measles|rubella|yellow fever|\byf\b|men\s*a|mena|meningitis|hpv|papilloma|ipv|polio|tetanus|\btd\b|diluent|dropper|syringe|needle|soloshot|r21|malaria)\b/i;

export function parseVaccineLinesDetailed(text: string): ParsedVaccineLinesResult {
  if (!text?.trim()) return { items: [], errors: [] };
  const items: ParsedVaccineLine[] = [];
  const errors: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim().replace(/^[\s•*#>–—-]+/, '').replace(/^\d+[.)-]\s*/, '').trim();
    if (!line || FS_METADATA_LINE.test(line)) continue;
    line = line.replace(/(\d),(\d{3})/g, '$1$2');

    let rawName = '';
    let quantityToken: string | undefined;
    let bracketMatch = line.match(/^(.+?)\s*\[\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:\/\s*(-?\d[\d,]*(?:\.\d+)?)\s*)?\]\s*[.!]?$/);
    if (bracketMatch) {
      rawName = bracketMatch[1].trim();
      // FS bracket values are a single confirmation line. The first value is
      // the confirmed quantity; the second is contextual and is never added.
      quantityToken = bracketMatch[2];
    } else {
      const leadingQuantity = line.match(/^(-?\d[\d,]*(?:\.\d+)?)\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?)?\s*[-:=–—]?\s*(.+)$/i);
      const trailingQuantity = line.match(/^(.+?)\s*(?:[:=–—-]|\s)\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?)?\s*[.!]?$/i);
      if (leadingQuantity) {
        quantityToken = leadingQuantity[1];
        rawName = leadingQuantity[2].trim();
      } else if (trailingQuantity) {
        rawName = trailingQuantity[1].trim();
        quantityToken = trailingQuantity[2];
      }
    }

    if (!rawName || quantityToken === undefined) {
      const nameOnly = line.replace(/\s*\[[^\]]*\].*$/, '').replace(/(?:[:=–—-]\s*|\s+)-?\d[\d,.]*(?:\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?))?\s*$/i, '').trim();
      const nameMatch = nameOnly ? matchVaccineName(nameOnly) : { canonical: '', confidence: 'none' as const };
      if (nameMatch.confidence !== 'none') {
        errors.push(`MISSING_QUANTITY: "${nameMatch.canonical}" is a known FS product, but its quantity is missing or unreadable.`);
      } else if (PRODUCT_LINE_HINT.test(line)) {
        errors.push(`UNKNOWN_PRODUCT: "${nameOnly || rawLine.trim()}" is not a recognized FS product name.`);
      } else if (/\[[^\]]*\]/.test(line)) {
        errors.push(`INVALID_QUANTITY: Could not parse a valid quantity from FS line: "${rawLine.trim()}".`);
      }
      continue;
    }

    const rawQuantity = Number(quantityToken.replace(/,/g, ''));
    if (!Number.isFinite(rawQuantity) || !Number.isInteger(rawQuantity) || rawQuantity <= 0) {
      errors.push(`INVALID_QUANTITY: FS line has an invalid, negative, or non-integer quantity: "${rawLine.trim()}".`);
      continue;
    }

    const matched = matchVaccineName(rawName);
    const canonical = matched.canonical || rawName;
    const dosesPerVial = getDosesPerVial(canonical);
    const detectedUnit: ParsedVaccineLine['unit'] = /\bdoses?\b/i.test(line)
      ? 'doses'
      : /\bvials?\b/i.test(line)
      ? 'vials'
      : 'unspecified';
    const quantityDoses = detectedUnit === 'doses' ? rawQuantity : rawQuantity * dosesPerVial;
    const quantity = detectedUnit === 'doses' && dosesPerVial > 0
      ? Math.ceil(rawQuantity / dosesPerVial)
      : rawQuantity;
    const accessoryPair = Object.entries(CLINICAL_PAIRINGS).find(([, pairing]) => pairing.accessoryCanonical === canonical);

    items.push({
      rawName,
      canonical,
      productType: getFsProductType(canonical),
      quantity,
      quantityDoses,
      dosesPerVial,
      unit: detectedUnit,
      confidence: matched.confidence,
      isPairingItem: Boolean(accessoryPair),
      pairingFor: accessoryPair?.[0]
    });
  }

  const consolidated = new Map<string, ParsedVaccineLine>();
  for (const item of items) {
    const existing = consolidated.get(item.canonical);
    if (existing) {
      existing.quantity += item.quantity;
      existing.quantityDoses += item.quantityDoses;
    } else {
      consolidated.set(item.canonical, { ...item });
    }
  }
  return { items: Array.from(consolidated.values()), errors };
}

// Backwards-compatible item-only parser for callers that do not need diagnostics.
export function parseVaccineLines(text: string): ParsedVaccineLine[] {
  return parseVaccineLinesDetailed(text).items;
}

// Clinical Diluent & Dropper Pairings for Cold Chain Vaccines
const CLINICAL_PAIRINGS: Record<string, { type: 'diluent' | 'dropper'; name: string; accessoryCanonical: string }> = {
  'BCG': { type: 'diluent', name: 'BCG Diluent', accessoryCanonical: 'BCG Diluent' },
  'MR': { type: 'diluent', name: 'MR Diluent', accessoryCanonical: 'MR Diluent' },
  'Yellow Fever': { type: 'diluent', name: 'Yellow Fever Diluent', accessoryCanonical: 'Yellow Fever Diluent' },
  'Men A': { type: 'diluent', name: 'Men A Diluent', accessoryCanonical: 'Men A Diluent' },
  'OPV': { type: 'dropper', name: 'OPV Dropper', accessoryCanonical: 'OPV Dropper' },
  'Rota': { type: 'dropper', name: 'Rota Dropper', accessoryCanonical: 'Rota Dropper' }
};

function getFsProductType(canonical: string): FsProductType {
  const pairing = Object.values(CLINICAL_PAIRINGS).find(item => item.accessoryCanonical === canonical);
  if (pairing?.type === 'diluent') return 'DILUENT';
  if (pairing?.type === 'dropper') return 'DROPPER';
  if (isDeviceProduct(canonical)) return 'OTHER_ACCESSORY';
  return matchVaccineName(canonical).confidence === 'none' ? 'OTHER_ACCESSORY' : 'PRIMARY_VACCINE';
}

// Extract facility name from text if present
export function extractFacilityFromText(text: string): string | null {
  if (!text) return null;

  // 1. Check explicit label pattern (e.g. 'Facility: ...', 'Health Centre: ...', 'Hospital: ...', 'Clinic: ...', 'CHPS: ...', 'Delivered to: ...', 'To: ...', etc.)
  const match = text.match(/(?:facility|hospital|clinic|health\s*cent(?:er|re)|chps|polyclinic|dispensary|delivered\s*to|ordering\s*facility|destination|location|site|recipient|to|for)\s*[:=–—]\s*([^\n\r,]+)/i);
  if (match) {
    const candidate = match[1].trim().replace(/^['"]|['"]$/g, '').replace(/[-–—.,]+$/, '').trim();
    if (candidate.length > 2) {
      return candidate;
    }
  }

  // 2. Direct match against all known facilities in facilitiesStore
  const lowerText = text.toLowerCase();
  for (const fac of facilitiesStore.values()) {
    const facLower = fac.facilityName.toLowerCase();
    if (lowerText.includes(facLower)) {
      return fac.facilityName;
    }
  }

  // 3. Scan first few lines for standard health facility naming patterns
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4);
  for (const line of lines) {
    if (/(?:hospital|clinic|health\s*cent(?:er|re)|chps|polyclinic)/i.test(line)) {
      const cleaned = line.replace(/^(?:order\s*for|dispatch\s*to|delivery\s*to|to|facility)\s*[:=–—]?\s*/i, '').trim();
      if (cleaned.length > 3) {
        return cleaned;
      }
    }
  }

  return null;
}

export interface DirectOrderItemInput {
  vaccine: string;
  quantity?: number;
  unit?: 'vials' | 'doses';
  requestedQty?: number;
  requestedDoses?: number;
  fsQty?: number;
  fsDoses?: number;
}

// Comprehensive Vaccine Allocation Validation Logic
export function validateVaccineOrder(params: {
  facilityId: string;
  orderSource: 'whatsapp' | 'fs_only';
  whatsappMessage?: string;
  fulfillmentConfirmation?: string;
  directItems?: DirectOrderItemInput[];
}): {
  isValid: boolean;
  orderSource: 'whatsapp' | 'fs_only';
  facilitySelected: string;
  allocationSheet?: string;
  district?: string;
  subDistrict?: string;
  facilityFoundInFs?: string;
  facilityMismatch: boolean;
  errors: string[];
  warnings: string[];
  items: any[];
  duplicateWarning?: {
    isDuplicate: boolean;
    message: string;
    recentTransactionId?: string;
    timeAgo?: string;
  };
  validatedAt: string;
  auditLogId?: string;
} {
  const { facilityId, orderSource, whatsappMessage = '', fulfillmentConfirmation = '', directItems } = params;
  const facility = getFacilityById(facilityId);

  const errors: string[] = [];
  const warnings: string[] = [];
  let facilityMismatch = false;
  let facilityFoundInFs: string | undefined = undefined;

  if (!facility) {
    return {
      isValid: false,
      orderSource,
      facilitySelected: 'Unknown Facility',
      facilityMismatch: false,
      errors: ['Selected facility was not found in the DCO allocation tracker.'],
      warnings: [],
      items: [],
      validatedAt: new Date().toISOString()
    };
  }

  // 1. Check Facility Mismatch if FS or WhatsApp specifies a facility name
  const extractedFsFacility = extractFacilityFromText(fulfillmentConfirmation);
  if (orderSource === 'fs_only' && !extractedFsFacility) {
    errors.push('🔴 FACILITY ERROR: The FS confirmation does not identify a facility, so it cannot be matched to the selected Allocation Blueprint.');
    facilityMismatch = true;
  }
  if (extractedFsFacility) {
    facilityFoundInFs = extractedFsFacility;
    const fsFacMatch = getFacilityByName(extractedFsFacility);
    if (fsFacMatch && fsFacMatch.id !== facility.id) {
      facilityMismatch = true;
      errors.push(`🔴 FACILITY MISMATCH: The active Allocation Blueprint is set to "${facility.facilityName}", but the FS Confirmation specifies "${extractedFsFacility}".`);
    } else if (!fsFacMatch && !extractedFsFacility.toLowerCase().includes(facility.facilityName.toLowerCase()) && !facility.facilityName.toLowerCase().includes(extractedFsFacility.toLowerCase())) {
      facilityMismatch = true;
      errors.push(`🔴 UNKNOWN FACILITY: Facility "${extractedFsFacility}" specified in the FS Confirmation was not found in the Allocation Blueprint sheets.`);
    }
  }

  // Never audit product allocations against a facility other than the one named
  // by the FS. A facility mismatch is the only actionable discrepancy here.
  if (facilityMismatch) {
    const timestamp = new Date().toISOString();
    const auditId = `AUD-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    errorsPreventedCount++;
    auditLogsStore.unshift({
      id: auditId,
      timestamp,
      facilityId: facility.id,
      facilityName: facility.facilityName,
      district: facility.district,
      subDistrict: facility.subDistrict,
      allocationSheet: facility.tabName || facility.cycle,
      ccaUser: 'CCA Operator',
      orderSource,
      productsChecked: [],
      auditResult: 'DO_NOT_PROCESS',
      errorsDetected: [...errors],
      confirmed: false
    });

    return {
      isValid: false,
      orderSource,
      facilitySelected: facility.facilityName,
      allocationSheet: facility.tabName || facility.cycle,
      district: facility.district,
      subDistrict: facility.subDistrict,
      facilityFoundInFs,
      facilityMismatch: true,
      errors: [...errors],
      warnings: [],
      items: [],
      duplicateWarning: undefined,
      validatedAt: timestamp,
      auditLogId: auditId
    };
  }

  const comparisonMap = new Map<string, {
    vaccine: string;
    productType?: FsProductType;
    dosesPerVial: number;
    requestedQty: number;       // vials
    requestedDoses: number;     // doses
    fsQty: number;              // vials
    fsDoses: number;            // doses
    originalAllocation: number; // vials
    originalDoses: number;      // doses
    previouslyTaken: number;    // vials
    previouslyTakenDoses: number; // doses
    remainingBefore: number;    // vials
    remainingBeforeDoses: number; // doses
    remainingAfter: number;     // vials
    remainingAfterDoses: number; // doses
    status: string;
    errors: string[];
    isNotAllocated?: boolean;
    isExhausted?: boolean;
    isExcess?: boolean;
    isMissing?: boolean;
    isUnexpected?: boolean;
    isQuantityMismatch?: boolean;
    takenHistory?: string;
    takenHistoryDoses?: string;
    errorDetail?: string;
    warningDetail?: string;
  }>();

  // Track diluents and droppers provided in the FS confirmation text

  // If structured directItems are passed (e.g. from the step-by-step wizard), validate them directly
  if (directItems && directItems.length > 0) {
    for (const d of directItems) {
      const rawName = (d.vaccine || '').trim();
      if (!rawName) continue;
      const matched = matchVaccineName(rawName);
      const canonical = matched.canonical || rawName;
      if (matched.confidence === 'none') {
        errors.push(`🔴 UNKNOWN_PRODUCT: "${rawName}" is not a recognized vaccine or companion product.`);
      }
      const alloc = findFacilityVaccineAlloc(facility, canonical)?.alloc;
      const dosesPerVial = alloc?.dosesPerVial || getDosesPerVial(canonical);

      let vials = d.quantity !== undefined ? Number(d.quantity) : (d.fsQty !== undefined ? Number(d.fsQty) : Number(d.requestedQty || 0));
      let doses = vials * dosesPerVial;
      if (d.unit === 'doses') {
        doses = d.quantity !== undefined ? Number(d.quantity) : (d.fsDoses !== undefined ? Number(d.fsDoses) : doses);
        vials = Math.ceil(doses / dosesPerVial);
      }
      const fsQty = d.fsQty !== undefined ? Number(d.fsQty) : vials;
      const fsDoses = d.fsDoses !== undefined ? Number(d.fsDoses) : doses;
      const reqQty = d.requestedQty !== undefined ? Number(d.requestedQty) : (orderSource === 'whatsapp' ? vials : 0);
      const reqDoses = d.requestedDoses !== undefined ? Number(d.requestedDoses) : (orderSource === 'whatsapp' ? doses : 0);
      if (![vials, doses, fsQty, fsDoses, reqQty, reqDoses].every(value => Number.isFinite(value) && Number.isInteger(value) && value >= 0) || fsQty <= 0) {
        errors.push(`🔴 INVALID QUANTITY: ${rawName || 'An FS product'} has a missing, invalid, or non-positive quantity.`);
      }

      const orig = alloc ? (alloc.carryOver || 0) + alloc.original + (alloc.topUp || 0) + (alloc.adjustment || 0) : 0;
      const origDoses = orig * dosesPerVial;
      const taken = alloc ? alloc.taken : 0;
      const takenDoses = alloc?.takenDoses !== undefined ? alloc.takenDoses : taken * dosesPerVial;
      const remBefore = alloc ? alloc.remaining : 0;
      const remBeforeDoses = alloc?.remainingDoses !== undefined ? alloc.remainingDoses : remBefore * dosesPerVial;

      comparisonMap.set(canonical, {
        vaccine: canonical,
        productType: getFsProductType(canonical),
        dosesPerVial,
        requestedQty: reqQty,
        requestedDoses: reqDoses,
        fsQty: fsQty,
        fsDoses: fsDoses,
        originalAllocation: orig,
        originalDoses: origDoses,
        previouslyTaken: taken,
        previouslyTakenDoses: takenDoses,
        remainingBefore: remBefore,
        remainingBeforeDoses: remBeforeDoses,
        remainingAfter: remBefore - fsQty,
        remainingAfterDoses: remBeforeDoses - fsDoses,
        status: 'valid',
        errors: [],
        takenHistory: alloc?.takenHistory,
        takenHistoryDoses: alloc?.takenHistoryDoses
      });
    }
  } else {
    // 2. Parse Order Sources from text
    const waParse = orderSource === 'whatsapp' ? parseVaccineLinesDetailed(whatsappMessage) : { items: [], errors: [] };
    const fsParse = parseVaccineLinesDetailed(fulfillmentConfirmation);
    const waItems = waParse.items;
    const fsItems = fsParse.items;

    if (orderSource === 'whatsapp' && (!whatsappMessage || whatsappMessage.trim().length === 0)) {
      errors.push('🔴 ORDER SOURCE ERROR: WhatsApp Request is selected as Order Source, but no WhatsApp order message was provided.');
    }
    if (orderSource === 'whatsapp' && waParse.errors.length > 0) {
      errors.push(...waParse.errors.map(message => `🔴 WHATSAPP PARSER ERROR: ${message}`));
    }
    if (fsParse.errors.length > 0) {
      errors.push(...fsParse.errors.map(message => `🔴 FS PARSER ERROR: ${message}`));
    }
    for (const item of fsItems) {
      if (item.confidence === 'none') {
        errors.push(`🔴 UNKNOWN_PRODUCT: "${item.rawName}" is not a recognized FS product name.`);
      }
    }
    if (fsItems.length === 0) {
      errors.push('🔴 Unable to verify FS confirmation — no vaccine items were parsed.');
    }

    // Populate comparison map based on order source
    if (orderSource === 'whatsapp') {
      for (const w of waItems) {
        const alloc = findFacilityVaccineAlloc(facility, w.canonical)?.alloc;
        const dosesPerVial = alloc?.dosesPerVial || getDosesPerVial(w.canonical);
        const orig = alloc ? (alloc.carryOver || 0) + alloc.original + (alloc.topUp || 0) + (alloc.adjustment || 0) : 0;
        const origDoses = orig * dosesPerVial;
        const taken = alloc ? alloc.taken : 0;
        const takenDoses = alloc?.takenDoses !== undefined ? alloc.takenDoses : taken * dosesPerVial;
        const remBefore = alloc ? alloc.remaining : 0;
        const remBeforeDoses = alloc?.remainingDoses !== undefined ? alloc.remainingDoses : remBefore * dosesPerVial;

        comparisonMap.set(w.canonical, {
          vaccine: w.canonical,
          productType: getFsProductType(w.canonical),
          dosesPerVial,
          requestedQty: w.quantity,
          requestedDoses: w.quantityDoses,
          fsQty: 0,
          fsDoses: 0,
          originalAllocation: orig,
          originalDoses: origDoses,
          previouslyTaken: taken,
          previouslyTakenDoses: takenDoses,
          remainingBefore: remBefore,
          remainingBeforeDoses: remBeforeDoses,
          remainingAfter: remBefore - w.quantity,
          remainingAfterDoses: remBeforeDoses - w.quantityDoses,
          status: 'valid',
          errors: [],
          takenHistory: alloc?.takenHistory,
          takenHistoryDoses: alloc?.takenHistoryDoses
        });
      }

      // Merge with FS items in WhatsApp mode
      for (const f of fsItems) {
        if (comparisonMap.has(f.canonical)) {
          const existing = comparisonMap.get(f.canonical)!;
          existing.fsQty = f.quantity;
          existing.fsDoses = f.quantityDoses;
          existing.remainingAfter = existing.remainingBefore - f.quantity;
          existing.remainingAfterDoses = existing.remainingBeforeDoses - f.quantityDoses;
        } else {
          const alloc = findFacilityVaccineAlloc(facility, f.canonical)?.alloc;
          const dosesPerVial = alloc?.dosesPerVial || getDosesPerVial(f.canonical);
          const orig = alloc ? (alloc.carryOver || 0) + alloc.original + (alloc.topUp || 0) + (alloc.adjustment || 0) : 0;
          const origDoses = orig * dosesPerVial;
          const taken = alloc ? alloc.taken : 0;
          const takenDoses = alloc?.takenDoses !== undefined ? alloc.takenDoses : taken * dosesPerVial;
          const remBefore = alloc ? alloc.remaining : 0;
          const remBeforeDoses = alloc?.remainingDoses !== undefined ? alloc.remainingDoses : remBefore * dosesPerVial;

          comparisonMap.set(f.canonical, {
            vaccine: f.canonical,
            productType: f.productType,
            dosesPerVial,
            requestedQty: 0,
            requestedDoses: 0,
            fsQty: f.quantity,
            fsDoses: f.quantityDoses,
            originalAllocation: orig,
            originalDoses: origDoses,
            previouslyTaken: taken,
            previouslyTakenDoses: takenDoses,
            remainingBefore: remBefore,
            remainingBeforeDoses: remBeforeDoses,
            remainingAfter: remBefore - f.quantity,
            remainingAfterDoses: remBeforeDoses - f.quantityDoses,
            status: 'valid',
            errors: [],
            takenHistory: alloc?.takenHistory,
            takenHistoryDoses: alloc?.takenHistoryDoses
          });
        }
      }
    } else {
      // -------------------------------------------------------------
      // FS ONLY MODE: Comprehensive Blueprint <-> FS Confirmation Comparison
      // -------------------------------------------------------------
      // 1. Populate comparisonMap with ALL vaccines allocated in this facility's Blueprint
      for (const [blueprintKey, alloc] of Object.entries(facility.vaccines)) {
        const canonical = matchVaccineName(blueprintKey).canonical;
        const dosesPerVial = alloc?.dosesPerVial || getDosesPerVial(canonical);
        const orig = alloc ? (alloc.carryOver || 0) + alloc.original + (alloc.topUp || 0) + (alloc.adjustment || 0) : 0;
        const origDoses = orig * dosesPerVial;
        const taken = alloc ? alloc.taken : 0;
        const takenDoses = alloc?.takenDoses !== undefined ? alloc.takenDoses : taken * dosesPerVial;
        const remBefore = alloc ? alloc.remaining : 0;
        const remBeforeDoses = alloc?.remainingDoses !== undefined ? alloc.remainingDoses : remBefore * dosesPerVial;

        comparisonMap.set(canonical, {
          vaccine: canonical,
          productType: getFsProductType(canonical),
          dosesPerVial,
          requestedQty: 0,
          requestedDoses: 0,
          fsQty: 0,
          fsDoses: 0,
          originalAllocation: orig,
          originalDoses: origDoses,
          previouslyTaken: taken,
          previouslyTakenDoses: takenDoses,
          remainingBefore: remBefore,
          remainingBeforeDoses: remBeforeDoses,
          remainingAfter: remBefore,
          remainingAfterDoses: remBeforeDoses,
          status: 'not_in_order',
          errors: [],
          takenHistory: alloc?.takenHistory,
          takenHistoryDoses: alloc?.takenHistoryDoses
        });
      }

      // 2. Overlay / Merge with items found in the FS Confirmation Message
      for (const f of fsItems) {
        if (comparisonMap.has(f.canonical)) {
          const existing = comparisonMap.get(f.canonical)!;
          existing.fsQty = f.quantity;
          existing.fsDoses = f.quantityDoses;
          existing.remainingAfter = existing.remainingBefore - f.quantity;
          existing.remainingAfterDoses = existing.remainingBeforeDoses - f.quantityDoses;
          existing.status = 'valid'; // Candidate, will be validated in step 3
        } else {
          // Present in FS confirmation message, but NOT in this facility's Blueprint!
          const dosesPerVial = getDosesPerVial(f.canonical);
          comparisonMap.set(f.canonical, {
            vaccine: f.canonical,
            productType: f.productType,
            dosesPerVial,
            requestedQty: 0,
            requestedDoses: 0,
            fsQty: f.quantity,
            fsDoses: f.quantityDoses,
            originalAllocation: 0,
            originalDoses: 0,
            previouslyTaken: 0,
            previouslyTakenDoses: 0,
            remainingBefore: 0,
            remainingBeforeDoses: 0,
            remainingAfter: -f.quantity,
            remainingAfterDoses: -f.quantityDoses,
            status: 'not_allocated',
            isNotAllocated: true,
            errors: [],
            takenHistory: undefined,
            takenHistoryDoses: undefined
          });
        }
      }
    }
  }

  // Ensure every present configured vaccine/accessory has a row for its pair,
  // even when the counterpart is absent from both the FS text and blueprint.
  for (const [primaryCanonical, pairing] of Object.entries(CLINICAL_PAIRINGS)) {
    const primary = comparisonMap.get(primaryCanonical);
    const accessory = comparisonMap.get(pairing.accessoryCanonical);
    if (!primary && !accessory) continue;

    for (const canonical of [primaryCanonical, pairing.accessoryCanonical]) {
      if (comparisonMap.has(canonical)) continue;
      const allocation = findFacilityVaccineAlloc(facility, canonical)?.alloc;
      const dosesPerVial = allocation?.dosesPerVial || getDosesPerVial(canonical);
      const remaining = allocation?.remaining || 0;
      comparisonMap.set(canonical, {
        vaccine: canonical,
        productType: getFsProductType(canonical),
        dosesPerVial,
        requestedQty: 0,
        requestedDoses: 0,
        fsQty: 0,
        fsDoses: 0,
        originalAllocation: allocation ? (allocation.carryOver || 0) + allocation.original + (allocation.topUp || 0) + (allocation.adjustment || 0) : 0,
        originalDoses: 0,
        previouslyTaken: allocation?.taken || 0,
        previouslyTakenDoses: allocation?.takenDoses || 0,
        remainingBefore: remaining,
        remainingBeforeDoses: allocation?.remainingDoses || 0,
        remainingAfter: remaining,
        remainingAfterDoses: allocation?.remainingDoses || 0,
        status: 'not_in_order',
        errors: []
      });
    }
  }

  const validationItems: any[] = [];

  // 3. Perform exhaustive checks for each product and pinpoint discrepancies
  for (const [canonicalName, comp] of comparisonMap.entries()) {
    const isAllocated = !!findFacilityVaccineAlloc(facility, canonicalName);
    const productType = comp.productType || getFsProductType(canonicalName);
    const isOptionalAccessory = productType === 'DILUENT' || productType === 'DROPPER';
    const requiresBlueprintAllocation = productType === 'PRIMARY_VACCINE';
    const checksBlueprintBalance = requiresBlueprintAllocation;
    if (isOptionalAccessory && !isAllocated) {
      // Accessories may be omitted from the allocation blueprint entirely.
      comp.isNotAllocated = false;
      comp.remainingBefore = 0;
      comp.remainingBeforeDoses = 0;
      comp.remainingAfter = 0;
      comp.remainingAfterDoses = 0;
    }
    const effectiveQtyToDeduct = comp.fsQty;

    // Check low confidence product alias
    const matchingAlias = matchVaccineName(canonicalName);
    if (matchingAlias.confidence === 'medium') {
      comp.warningDetail = `PRODUCT MATCH REQUIRES CONFIRMATION: "${canonicalName}" was mapped using fuzzy match. Please confirm product.`;
      warnings.push(comp.warningDetail);
    }

    // Check A: WhatsApp vs FS cross-checks
    if (orderSource === 'whatsapp') {
      // Check Missing Product: Customer requested in WhatsApp but missing from FS
      if (!isOptionalAccessory && comp.requestedQty > 0 && comp.fsQty === 0) {
        comp.isMissing = true;
        const err = `🔴 ${comp.vaccine} MISSING: Requested: ${comp.requestedQty} vials (${comp.requestedDoses} doses), FS: Not found`;
        comp.errors.push(err);
        errors.push(err);
        comp.status = 'missing_product';
      }

      // Check Unexpected Product: Present in FS but was NOT in WhatsApp request
      if (!isOptionalAccessory && comp.requestedQty === 0 && comp.fsQty > 0) {
        comp.isUnexpected = true;
        const err = `🔴 UNEXPECTED PRODUCT: Product entered in FS: ${comp.vaccine} ${comp.fsQty} vials (${comp.fsDoses} doses). Product was not found in the customer request.`;
        comp.errors.push(err);
        errors.push(err);
        comp.status = 'unexpected_product';
      }

      // Check Quantity Mismatch between WhatsApp and FS
      if (!isOptionalAccessory && comp.requestedQty > 0 && comp.fsQty > 0 && comp.requestedQty !== comp.fsQty) {
        comp.isQuantityMismatch = true;
        const err = `🔴 FS QUANTITY MISMATCH: Customer requested: ${comp.requestedQty} vials (${comp.requestedDoses} doses), FS entered: ${comp.fsQty} vials (${comp.fsDoses} doses)`;
        comp.errors.push(err);
        errors.push(err);
        comp.status = 'quantity_mismatch';
      }

      // Allocation checks for WhatsApp mode
      if (!isAllocated && requiresBlueprintAllocation) {
        comp.isNotAllocated = true;
        const err = `🔴 ${comp.vaccine} NOT ALLOCATED: ${comp.vaccine} has no available allocation for this facility. Do not give the order a Green Light.`;
        comp.errors.push(err);
        errors.push(err);
        comp.status = 'not_allocated';
      } else if (isAllocated && checksBlueprintBalance) {
        if (!Number.isFinite(comp.remainingBefore) || comp.remainingBefore < 0) {
          const err = `🔴 INVALID ALLOCATION: ${comp.vaccine} has no valid remaining-balance value in the Allocation Blueprint.`;
          comp.errors.push(err);
          errors.push(err);
          comp.status = 'invalid_allocation';
        } else if (comp.remainingBefore <= 0) {
          comp.isExhausted = true;
          const err = `🔴 ALLOCATION EXHAUSTED: ${comp.vaccine} has 0 vials remaining in the Allocation Blueprint for ${facility.facilityName}. (Allocated: ${comp.originalAllocation}, Previously Distributed: ${comp.previouslyTaken}). Cannot dispatch.`;
          comp.errors.push(err);
          errors.push(err);
          comp.status = 'exhausted';
        } else if (Math.max(comp.requestedQty, comp.fsQty) > 0 && Math.max(comp.requestedQty, comp.fsQty) > comp.remainingBefore) {
          comp.isExcess = true;
          const excessTested = Math.max(comp.requestedQty, comp.fsQty);
          const excessVials = excessTested - comp.remainingBefore;
          const excessDoses = excessVials * comp.dosesPerVial;
          const qtyDesc = comp.fsQty > comp.remainingBefore 
            ? `FS quantity (${comp.fsQty} vials)`
            : `Customer requested quantity (${comp.requestedQty} vials)`;
          const errExceeded = `🔴 ALLOCATION EXCEEDED: ${comp.vaccine} – ${qtyDesc} exceeds available balance in Allocation Blueprint (${comp.remainingBefore} vials). Excess: ${excessVials} vials (${excessDoses} doses). (Blueprint Allocated: ${comp.originalAllocation}, Previously Distributed: ${comp.previouslyTaken}).`;
          comp.errors.push(errExceeded);
          errors.push(errExceeded);
          comp.status = 'excess_quantity';
        }
      }
    } else {
      // -------------------------------------------------------------
      // Check B: FS ONLY Discrepancy Pinpointing
      // -------------------------------------------------------------
      if (comp.fsQty > 0) {
        // Discrepancy 1: Not in Blueprint
        if (!isAllocated && requiresBlueprintAllocation) {
          comp.isNotAllocated = true;
          const err = `🔴 PRODUCT NOT ALLOCATED: "${comp.vaccine}" is specified in FS confirmation (${comp.fsQty} vials), but ${facility.facilityName} has NO allocation record in the Blueprint.`;
          comp.errors.push(err);
          errors.push(err);
          comp.status = 'not_allocated';
        } else if (isAllocated && checksBlueprintBalance) {
          // Discrepancy 2: Allocation Exhausted (0 balance remaining in Blueprint)
          if (!Number.isFinite(comp.remainingBefore) || comp.remainingBefore < 0) {
            const err = `🔴 INVALID ALLOCATION: ${comp.vaccine} has no valid remaining-balance value in the Allocation Blueprint.`;
            comp.errors.push(err);
            errors.push(err);
            comp.status = 'invalid_allocation';
          } else if (comp.remainingBefore <= 0) {
            comp.isExhausted = true;
            const err = `🔴 ALLOCATION EXHAUSTED: "${comp.vaccine}" has 0 vials remaining in the Blueprint for ${facility.facilityName} (Allocated: ${comp.originalAllocation}, Distributed: ${comp.previouslyTaken}). Cannot fulfill FS confirmation of ${comp.fsQty} vials.`;
            comp.errors.push(err);
            errors.push(err);
            comp.status = 'exhausted';
          }
          // Discrepancy 3: Allocation Exceeded (FS quantity > remaining balance)
          else if (comp.fsQty > comp.remainingBefore) {
            comp.isExcess = true;
            const excessVials = comp.fsQty - comp.remainingBefore;
            const excessDoses = excessVials * comp.dosesPerVial;
            const errExceeded = `🔴 ALLOCATION EXCEEDED: "${comp.vaccine}" – FS quantity (${comp.fsQty} vials) exceeds Blueprint available balance (${comp.remainingBefore} vials). Excess: ${excessVials} vials (${excessDoses} doses). (Blueprint Total: ${comp.originalAllocation}, Previously Distributed: ${comp.previouslyTaken}).`;
            comp.errors.push(errExceeded);
            errors.push(errExceeded);
            comp.status = 'excess_quantity';
          }

        }
        if (comp.errors.length === 0) {
          comp.status = 'valid';
        }
      } else if (comp.errors.length === 0) {
        // Preserve a pairing error assigned by the parent product earlier in the pass.
        comp.status = 'not_in_order';
      }
    }

    // Required diluent/dropper relationships are checked independently from
    // blueprint allocation rows. Companion allocations, when present, were
    // already validated against their own remaining balance above.
    const configuredPairing = CLINICAL_PAIRINGS[canonicalName];
    if (configuredPairing) {
      const companion = comparisonMap.get(configuredPairing.accessoryCanonical);
      if (comp.fsQty > 0 && companion && companion.fsQty <= 0) {
        const label = configuredPairing.type === 'diluent' ? 'REQUIRED DILUENT MISSING' : 'REQUIRED ACCESSORY MISSING';
        const error = `🔴 ${label}: ${configuredPairing.name} is required when ${comp.vaccine} quantity is ${comp.fsQty}.`;
        comp.errors.push(error);
        errors.push(error);
        comp.status = 'missing_diluent_dropper';
        companion.errors.push(error);
        companion.errorDetail = error;
        companion.status = 'missing_diluent_dropper';
      } else if (comp.fsQty > 0 && companion && companion.fsQty > 0 && companion.fsQty !== comp.fsQty) {
        const difference = Math.abs(companion.fsQty - comp.fsQty);
        const label = configuredPairing.type === 'diluent' ? 'DILUENT QUANTITY MISMATCH' : 'ACCESSORY QUANTITY MISMATCH';
        const error = `🔴 ${label}: ${comp.vaccine} quantity is ${comp.fsQty}, but ${configuredPairing.name} quantity is ${companion.fsQty}. Difference: ${difference}.`;
        comp.errors.push(error);
        errors.push(error);
        comp.status = 'missing_diluent_dropper';
        companion.errors.push(error);
        companion.errorDetail = error;
        companion.status = 'missing_diluent_dropper';
      } else if (comp.fsQty <= 0 && companion && companion.fsQty > 0) {
        const label = configuredPairing.type === 'diluent' ? 'ORPHAN DILUENT' : 'ORPHAN ACCESSORY';
        const error = `🔴 ${label}: ${configuredPairing.name} is present (${companion.fsQty}) without ${comp.vaccine}.`;
        comp.errors.push(error);
        errors.push(error);
        comp.status = 'missing_diluent_dropper';
        companion.errors.push(error);
        companion.errorDetail = error;
        companion.status = 'missing_diluent_dropper';
      }
    }

    if (comp.errors.length > 0) {
      comp.errorDetail = comp.errors.join(' | ');
    } else if (comp.status !== 'not_in_order') {
      comp.status = 'valid';
    }

    validationItems.push(comp);
  }

  // 4. Duplicate Order Protection Check
  // Check if an identical or near-identical order was confirmed for this facility within the last 30 minutes
  let duplicateWarning: any = undefined;
  const now = Date.now();
  const recentMinutesThreshold = 30 * 60 * 1000;

  for (const tx of transactionsStore) {
    if (tx.facilityName.toLowerCase() === facility.facilityName.toLowerCase()) {
      const txTime = new Date(tx.timestamp).getTime();
      if (now - txTime < recentMinutesThreshold) {
        // Compare items
        const isMatch = Array.from(comparisonMap.values()).some(f => 
          tx.items.some(txi => txi.vaccine === f.vaccine && txi.currentOrder === f.fsQty)
        );
        if (isMatch) {
          const diffMinutes = Math.max(1, Math.round((now - txTime) / 60000));
          duplicateAlertsCount++;
          duplicateWarning = {
            isDuplicate: true,
            message: `POSSIBLE DUPLICATE ORDER: An identical order for ${facility.facilityName} was processed ${diffMinutes} minute(s) ago (TX: ${tx.id}). Please verify with CCA/customer before confirming.`,
            recentTransactionId: tx.id,
            timeAgo: `${diffMinutes}m ago`
          };
          warnings.push(duplicateWarning.message);
          break;
        }
      }
    }
  }

  const isValid = errors.length === 0;
  if (!isValid) {
    errorsPreventedCount++;
  }

  // Save audit log record to history
  const auditId = `AUD-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
  const auditRecord: VaccineAuditLogRecord = {
    id: auditId,
    timestamp: new Date().toISOString(),
    facilityId: facility.id,
    facilityName: facility.facilityName,
    district: facility.district,
    subDistrict: facility.subDistrict,
    allocationSheet: facility.tabName || facility.cycle,
    ccaUser: 'CCA Operator',
    orderSource,
    productsChecked: validationItems.map(item => ({
      vaccine: item.vaccine,
      requestedQty: item.requestedQty,
      requestedDoses: item.requestedDoses,
      fsQty: item.fsQty,
      fsDoses: item.fsDoses,
      availableRemaining: item.remainingBefore,
      availableRemainingDoses: item.remainingBeforeDoses,
      remainingAfter: item.remainingAfter,
      remainingAfterDoses: item.remainingAfterDoses,
      dosesPerVial: item.dosesPerVial,
      status: item.status,
      errors: item.errors
    })),
    auditResult: isValid ? 'GREEN_LIGHT' : 'DO_NOT_PROCESS',
    errorsDetected: [...errors],
    confirmed: false
  };
  auditLogsStore.unshift(auditRecord);

  return {
    isValid,
    orderSource,
    facilitySelected: facility.facilityName,
    allocationSheet: facility.tabName || facility.cycle,
    district: facility.district,
    subDistrict: facility.subDistrict,
    facilityFoundInFs,
    facilityMismatch,
    errors,
    warnings,
    items: validationItems,
    duplicateWarning,
    validatedAt: new Date().toISOString(),
    auditLogId: auditId
  };
}

// Helper to find vaccine allocation in a facility (canonical, alias, or case-insensitive)
export function findFacilityVaccineAlloc(
  facility: FacilityAllocationRecord,
  vaccineName: string
): { key: string; alloc: VaccineAllocationDetail } | undefined {
  if (!facility || !facility.vaccines) return undefined;
  
  // 1. Direct key match
  if (facility.vaccines[vaccineName]) {
    return { key: vaccineName, alloc: facility.vaccines[vaccineName] };
  }

  // 2. Canonical name match
  const matched = matchVaccineName(vaccineName);
  if (facility.vaccines[matched.canonical]) {
    return { key: matched.canonical, alloc: facility.vaccines[matched.canonical] };
  }

  // 3. Case-insensitive key match
  const lower = vaccineName.toLowerCase().trim();
  for (const [k, v] of Object.entries(facility.vaccines)) {
    if (k.toLowerCase().trim() === lower) {
      return { key: k, alloc: v };
    }
  }

  // 4. Any key whose canonical matches matched.canonical
  const canonicalLower = matched.canonical.toLowerCase();
  for (const [k, v] of Object.entries(facility.vaccines)) {
    if (matchVaccineName(k).canonical.toLowerCase() === canonicalLower) {
      return { key: k, alloc: v };
    }
  }

  return undefined;
}

// Concurrency-Safe Atomic Order Confirmation
export async function confirmVaccineOrder(params: {
  facilityId: string;
  orderSource: 'whatsapp' | 'fs_only';
  items: Array<{ vaccine: string; currentOrder: number }>;
  ccaUser: string;
  orderId?: string;
  rawOrderText?: string;
  rawFsText?: string;
}): Promise<{
  success: boolean;
  error?: string;
  transaction?: AllocationTransactionRecord;
  updatedFacility?: FacilityAllocationRecord;
}> {
  const { facilityId, orderSource, items, ccaUser, orderId, rawOrderText, rawFsText } = params;

  // Concurrency lock per facility to prevent race conditions across multiple CCAs
  const lockKey = facilityId;
  if (facilityLocks.get(lockKey)) {
    return {
      success: false,
      error: 'Facility allocation is currently being updated by another advocate. Please retry in a few seconds.'
    };
  }

  try {
    facilityLocks.set(lockKey, true);

    const facility = getFacilityById(facilityId);
    if (!facility) {
      return { success: false, error: 'Facility not found.' };
    }

    // Idempotency: retries for the same approved audit return its transaction
    // without applying the allocation deduction a second time.
    if (orderId) {
      const existingTransaction = transactionsStore.find(tx => tx.id === orderId || tx.orderId === orderId);
      if (existingTransaction) {
        return { success: true, transaction: existingTransaction, updatedFacility: facility };
      }
    }

    // Step 1: Real-time Re-validation against current live balance
    // Ensure sufficient allocation still exists right now!
    for (const item of items) {
      const found = findFacilityVaccineAlloc(facility, item.vaccine);
      if (!found) {
        if (getFsProductType(item.vaccine) === 'DILUENT' || getFsProductType(item.vaccine) === 'DROPPER') {
          // Pairing accessories are valid FS confirmation items even when the
          // facility blueprint has no separate accessory allocation row.
          continue;
        }
        return {
          success: false,
          error: `ALLOCATION ERROR: ${item.vaccine} has no allocation configured for this facility.`
        };
      }
      const productType = getFsProductType(item.vaccine);
      if (item.currentOrder > found.alloc.remaining && productType !== 'DILUENT' && productType !== 'DROPPER') {
        return {
          success: false,
          error: `ALLOCATION CHANGED: The available allocation for ${found.key} has changed since your last check. Current remaining: ${found.alloc.remaining}, Requested: ${item.currentOrder}. Please review the order.`
        };
      }
    }

    // Step 2: Deduct quantities and build transaction record
    const transactionItems: Array<{
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
    }> = [];

    for (const item of items) {
      const found = findFacilityVaccineAlloc(facility, item.vaccine);
      if (!found) continue;
      const allocKey = found.key;
      const alloc = found.alloc;
      const dosesPerVial = alloc.dosesPerVial || getDosesPerVial(allocKey);

      const prevTaken = alloc.taken || 0;
      const prevTakenDoses = alloc.takenDoses !== undefined ? alloc.takenDoses : prevTaken * dosesPerVial;
      const orderVials = item.currentOrder;
      const orderDoses = orderVials * dosesPerVial;

      // Exact deduction directly from current remaining balance
      const prevRemaining = alloc.remaining;
      const prevRemainingDoses = alloc.remainingDoses !== undefined ? alloc.remainingDoses : prevRemaining * dosesPerVial;
      const newRemaining = Math.max(0, prevRemaining - orderVials);
      const newRemainingDoses = Math.max(0, prevRemainingDoses - orderDoses);

      const newTaken = prevTaken + orderVials;
      const newTakenDoses = prevTakenDoses + orderDoses;

      const carryOver = alloc.carryOver || 0;
      const topUp = alloc.topUp || 0;
      const adjustment = alloc.adjustment || 0;

      // Ensure total authorized consistency (never allow original to be zeroed or collapsed)
      if ((alloc.original || 0) + carryOver + topUp + adjustment < newRemaining + newTaken) {
        alloc.original = Math.max(0, newRemaining + newTaken - carryOver - topUp - adjustment);
      }

      // Mutate facility allocation (atomic update)
      alloc.taken = newTaken;
      alloc.takenDoses = newTakenDoses;
      alloc.remaining = newRemaining;
      alloc.remainingDoses = newRemainingDoses;
      alloc.dosesPerVial = dosesPerVial;

      // Update takenHistory arithmetic string
      if (alloc.takenHistory) {
        alloc.takenHistory = `${alloc.takenHistory} + ${orderVials}`;
      } else if (prevTaken > 0) {
        alloc.takenHistory = `${prevTaken} + ${orderVials}`;
      } else {
        alloc.takenHistory = `${orderVials}`;
      }

      if (alloc.takenHistoryDoses) {
        alloc.takenHistoryDoses = `${alloc.takenHistoryDoses} + ${orderDoses}`;
      } else if (prevTakenDoses > 0) {
        alloc.takenHistoryDoses = `${prevTakenDoses} + ${orderDoses}`;
      } else {
        alloc.takenHistoryDoses = `${orderDoses}`;
      }

      transactionItems.push({
        vaccine: allocKey,
        requestedQty: orderVials,
        requestedDoses: orderDoses,
        previousTaken: prevTaken,
        previousTakenDoses: prevTakenDoses,
        currentOrder: orderVials,
        currentOrderDoses: orderDoses,
        remainingAfter: newRemaining,
        remainingAfterDoses: newRemainingDoses,
        dosesPerVial,
        unit: 'both'
      });
    }

    facility.updatedAt = new Date().toISOString();
    facility.updatedBy = ccaUser || 'CCA Operations';

    // Step 3: Create immutable transaction log
    const txId = orderId || `TX-VAC-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newTx: AllocationTransactionRecord = {
      id: txId,
      facilityName: facility.facilityName,
      district: facility.district,
      subDistrict: facility.subDistrict,
      nest: facility.nest,
      cycle: facility.cycle,
      source: orderSource,
      items: transactionItems,
      timestamp: new Date().toISOString(),
      ccaUser: ccaUser || 'Customer Care Advocate',
      orderId: txId,
      rawOrderText,
      rawFsText,
      status: 'confirmed'
    };

    transactionsStore.unshift(newTx);

    // Update unconfirmed audit log for this facility to confirmed
    const unconfirmedAudit = auditLogsStore.find(a => a.facilityId === facility.id && !a.confirmed);
    if (unconfirmedAudit) {
      unconfirmedAudit.confirmed = true;
      unconfirmedAudit.confirmedTransactionId = txId;
    }

    return {
      success: true,
      transaction: newTx,
      updatedFacility: facility
    };
  } finally {
    facilityLocks.delete(lockKey);
  }
}

// Record DCO Quota Adjustment
export function recordAllocationAdjustment(params: {
  facilityId: string;
  vaccine: string;
  adjustment: number;
  unit?: 'vials' | 'doses';
  reason: string;
  user: string;
}): { success: boolean; error?: string; updatedFacility?: FacilityAllocationRecord } {
  const { facilityId, vaccine, reason, user } = params;
  const facility = getFacilityById(facilityId);
  if (!facility) return { success: false, error: 'Facility not found.' };

  const matched = matchVaccineName(vaccine);
  const canonical = matched.canonical;
  const dosesPerVial = getDosesPerVial(canonical);

  let adjVials = params.adjustment;
  if (params.unit === 'doses') {
    adjVials = Math.round(params.adjustment / dosesPerVial);
  }

  let alloc = facility.vaccines[canonical];
  if (!alloc) {
    // Create new vaccine slot if DCO is allocating a new product
    alloc = buildVaccineDetail(canonical, {
      original: 0,
      taken: 0,
      remaining: 0,
      adjustment: 0
    });
    facility.vaccines[canonical] = alloc;
  }

  const prevAlloc = alloc.original + (alloc.adjustment || 0);
  alloc.adjustment = (alloc.adjustment || 0) + adjVials;
  alloc.adjustmentDoses = (alloc.adjustment || 0) * dosesPerVial;
  const newTotalAuthorized = (alloc.carryOver || 0) + alloc.original + (alloc.topUp || 0) + alloc.adjustment;
  alloc.remaining = Math.max(0, newTotalAuthorized - alloc.taken);
  alloc.remainingDoses = alloc.remaining * dosesPerVial;
  alloc.dosesPerVial = dosesPerVial;

  const adjId = `ADJ-${Date.now().toString(36).toUpperCase()}`;
  const adjRecord: AllocationAdjustmentRecord = {
    id: adjId,
    facilityName: facility.facilityName,
    vaccine: canonical,
    previousAllocation: prevAlloc,
    adjustment: adjVials,
    newAllocation: newTotalAuthorized,
    reason,
    user: user || 'Warehouse Team',
    timestamp: new Date().toISOString()
  };

  adjustmentsStore.unshift(adjRecord);
  facility.updatedAt = new Date().toISOString();
  facility.updatedBy = user || 'Warehouse Team';

  return {
    success: true,
    updatedFacility: facility
  };
}

// Sync all districts from blueprint into facilities store (clears old facilities so deleted rows disappear, keeping transactions/audits intact)
export function syncAllDistrictsToFacilities(rows: Array<{
  facility: string;
  vaccine: string;
  allocation: number;
  carryOver?: number;
  topUp?: number;
  taken?: number;
  remaining?: number;
  takenHistory?: string;
  tabName?: string;
  district?: string;
  subDistrict?: string;
  nest?: string;
  cycle?: string;
}>, updatedBy: string = 'Blueprint 67-Col'): { importedCount: number; facilitiesCount: number } {
  facilitiesStore.clear();
  return importAllocationsFromRows(rows, updatedBy);
}

// Bulk Upload & Merge from parsed Excel / CSV rows
export function importAllocationsFromRows(rows: Array<{
  facility: string;
  vaccine: string;
  allocation: number;
  carryOver?: number;
  topUp?: number;
  taken?: number;
  remaining?: number;
  takenHistory?: string;
  tabName?: string;
  district?: string;
  subDistrict?: string;
  nest?: string;
  cycle?: string;
}>, updatedBy: string = 'DCO Bulk Upload'): { importedCount: number; facilitiesCount: number } {
  const currentCycle = 'September 2026';
  let importedCount = 0;

  for (const row of rows) {
    if (!row.facility || !row.vaccine || isNaN(row.allocation)) continue;

    const facName = row.facility.trim();

    // Infer canonical tabName if not directly provided
    const districtClean = (row.district || '').trim();
    let inferredTabName = row.tabName?.trim();
    if (!inferredTabName) {
      if (/karaga/i.test(districtClean) || /karaga/i.test(facName)) {
        inferredTabName = 'Karaga September allocation';
      } else if (/west\s*mamprusi/i.test(districtClean) || /walewale|wulugu|kparigu/i.test(facName)) {
        inferredTabName = 'West Mamprusi Sep';
      } else if (/mmd|mamprugu\s*moagduri/i.test(districtClean) || /yagaba|kubori|soo/i.test(facName)) {
        inferredTabName = 'MMD Sep';
      } else if (/east\s*mamprusi/i.test(districtClean) || /gambaga|nalerigu|langbinsi/i.test(facName)) {
        inferredTabName = 'East Mamprusi Sept';
      } else if (/bunkpurugu/i.test(districtClean) || /bunkpurugu|nakpanduri|bimbagu/i.test(facName)) {
        inferredTabName = 'Bunkpurugu Sept';
      } else if (districtClean) {
        inferredTabName = `${districtClean} Allocation`;
      }
    }

    // Partition facility by name AND worksheet tab (Requirement #8)
    let facility = getFacilityByNameAndTab(facName, inferredTabName) || getFacilityByName(facName);

    if (!facility) {
      const facKey = inferredTabName ? `${facName}_${inferredTabName}` : facName;
      const id = facKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      facility = {
        id: id || `fac_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        facilityName: facName,
        tabName: inferredTabName,
        district: row.district?.trim() || 'General District',
        subDistrict: row.subDistrict?.trim() || undefined,
        nest: row.nest?.trim() || 'Northern Nest',
        cycle: row.cycle?.trim() || currentCycle,
        vaccines: {},
        updatedAt: new Date().toISOString(),
        updatedBy
      };
      facilitiesStore.set(facility.id, facility);
    } else {
      if (inferredTabName && !facility.tabName) {
        facility.tabName = inferredTabName;
      }
      if (row.subDistrict && !facility.subDistrict) {
        facility.subDistrict = row.subDistrict.trim();
      }
      if (row.district && (!facility.district || facility.district === 'General District')) {
        facility.district = row.district.trim();
      }
    }

    const matched = matchVaccineName(row.vaccine);
    const canonical = matched.canonical;

    const orig = Number(row.allocation);
    const prevTaken = !isNaN(Number(row.taken)) ? Number(row.taken) : 0;
    const carryOver = !isNaN(Number(row.carryOver)) ? Number(row.carryOver) : undefined;
    const topUp = !isNaN(Number(row.topUp)) ? Number(row.topUp) : 0;
    const rem = !isNaN(Number(row.remaining)) ? Number(row.remaining) : undefined;

    facility.vaccines[canonical] = buildVaccineDetail(canonical, {
      original: orig,
      taken: prevTaken,
      remaining: rem,
      carryOver,
      topUp,
      takenHistory: row.takenHistory
    });

    facility.updatedAt = new Date().toISOString();
    facility.updatedBy = updatedBy;
    importedCount++;
  }

  return {
    importedCount,
    facilitiesCount: facilitiesStore.size
  };
}

export function getTransactions(): AllocationTransactionRecord[] {
  return transactionsStore;
}

export function getAdjustments(): AllocationAdjustmentRecord[] {
  return adjustmentsStore;
}

export function getDashboardMetrics() {
  const allFacilities = getAllFacilities();
  let totalAllocated = 0;
  let totalCarryOver = 0;
  let totalNewAllocation = 0;
  let totalOrdered = 0;
  let totalRemaining = 0;

  // Vaccines-specific (Antigens)
  let vaccineAllocated = 0;
  let vaccineAllocatedDoses = 0;
  let vaccineCarryOver = 0;
  let vaccineCarryOverDoses = 0;
  let vaccineNewAllocation = 0;
  let vaccineNewAllocationDoses = 0;
  let vaccineOrdered = 0;
  let vaccineOrderedDoses = 0;
  let vaccineRemaining = 0;
  let vaccineRemainingDoses = 0;

  // Devices-specific (Syringes & Consumables in pieces/units)
  let deviceAllocated = 0;
  let deviceCarryOver = 0;
  let deviceNewAllocation = 0;
  let deviceOrdered = 0;
  let deviceRemaining = 0;

  let facilitiesWithRemaining = 0;
  let facilitiesExhausted = 0;

  for (const f of allFacilities) {
    let facHasRemaining = false;
    let facHasExhausted = false;

    for (const [vName, v] of Object.entries(f.vaccines)) {
      const isDevice = isDeviceProduct(vName);
      const dosesPerVial = isDevice ? 0 : (v.dosesPerVial || getDosesPerVial(vName));
      const carryOver = v.carryOver || 0;
      const carryOverDoses = isDevice ? 0 : (v.carryOverDoses !== undefined ? v.carryOverDoses : carryOver * dosesPerVial);
      const newAlloc = v.original || 0;
      const newAllocDoses = isDevice ? 0 : (v.originalDoses !== undefined ? v.originalDoses : newAlloc * dosesPerVial);

      const totalAuth = carryOver + newAlloc + (v.topUp || 0) + (v.adjustment || 0);
      const totalAuthDoses = isDevice ? 0 : (v.originalDoses !== undefined 
        ? ((v.carryOverDoses || 0) + (v.originalDoses || 0) + (v.topUpDoses || 0) + (v.adjustmentDoses || 0))
        : totalAuth * dosesPerVial);

      const takenDoses = isDevice ? 0 : (v.takenDoses !== undefined ? v.takenDoses : v.taken * dosesPerVial);
      const remainingDoses = isDevice ? 0 : (v.remainingDoses !== undefined ? v.remainingDoses : v.remaining * dosesPerVial);

      totalCarryOver += carryOver;
      totalNewAllocation += newAlloc;
      totalAllocated += totalAuth;
      totalOrdered += v.taken;
      totalRemaining += v.remaining;

      if (isDevice) {
        deviceCarryOver += carryOver;
        deviceNewAllocation += newAlloc;
        deviceAllocated += totalAuth;
        deviceOrdered += v.taken;
        deviceRemaining += v.remaining;
      } else {
        vaccineCarryOver += carryOver;
        vaccineCarryOverDoses += carryOverDoses;
        vaccineNewAllocation += newAlloc;
        vaccineNewAllocationDoses += newAllocDoses;
        vaccineAllocated += totalAuth;
        vaccineAllocatedDoses += totalAuthDoses;
        vaccineOrdered += v.taken;
        vaccineOrderedDoses += takenDoses;
        vaccineRemaining += v.remaining;
        vaccineRemainingDoses += remainingDoses;
      }

      if (v.remaining > 0) facHasRemaining = true;
      if (v.remaining === 0 && totalAuth > 0) facHasExhausted = true;
    }

    if (facHasRemaining) facilitiesWithRemaining++;
    if (!facHasRemaining && facHasExhausted) facilitiesExhausted++;
  }

  return {
    totalFacilities: allFacilities.length,
    facilitiesWithRemaining,
    facilitiesExhausted,
    // Pure Vaccines (Antigens)
    vaccineAllocated,
    vaccineAllocatedDoses,
    vaccineCarryOver,
    vaccineCarryOverDoses,
    vaccineNewAllocation,
    vaccineNewAllocationDoses,
    vaccineOrdered,
    vaccineOrderedDoses,
    vaccineRemaining,
    vaccineRemainingDoses,
    // Pure Injection Devices (Syringes / Needles in pcs)
    deviceAllocated,
    deviceCarryOver,
    deviceNewAllocation,
    deviceOrdered,
    deviceRemaining,
    // Consolidated / Legacy (Doses only count biological vaccines!)
    totalCarryOver,
    totalCarryOverDoses: vaccineCarryOverDoses,
    totalNewAllocation,
    totalNewAllocationDoses: vaccineNewAllocationDoses,
    totalAllocated,
    totalAllocatedDoses: vaccineAllocatedDoses,
    totalOrdered,
    totalOrderedDoses: vaccineOrderedDoses,
    totalRemaining,
    totalRemainingDoses: vaccineRemainingDoses,
    errorsPrevented: errorsPreventedCount,
    duplicateAlerts: duplicateAlertsCount
  };
}

export function updateVaccineTopUp(
  facilityId: string,
  vaccine: string,
  topUp: number,
  user: string = 'Warehouse Team',
  unit: 'vials' | 'doses' = 'vials'
): { success: boolean; updatedFacility?: FacilityAllocationRecord; error?: string } {
  const facility = facilitiesStore.get(facilityId);
  if (!facility) return { success: false, error: 'Facility not found' };

  const matched = matchVaccineName(vaccine);
  const canonical = matched.canonical;
  const dosesPerVial = getDosesPerVial(canonical);

  let topUpVials = topUp;
  if (unit === 'doses') {
    topUpVials = Math.ceil(topUp / dosesPerVial);
  }

  if (!facility.vaccines[canonical]) {
    facility.vaccines[canonical] = buildVaccineDetail(canonical, {
      original: 0,
      taken: 0,
      remaining: Math.max(0, topUpVials),
      adjustment: 0,
      carryOver: 0,
      topUp: Math.max(0, topUpVials)
    });
  } else {
    const v = facility.vaccines[canonical];
    const prevTopUp = v.topUp || 0;
    v.topUp = Math.max(0, topUpVials);
    v.topUpDoses = v.topUp * dosesPerVial;
    v.dosesPerVial = dosesPerVial;
    const totalAvailable = (v.carryOver || 0) + v.original + (v.topUp || 0) + (v.adjustment || 0);
    v.remaining = Math.max(0, totalAvailable - v.taken);
    v.remainingDoses = v.remaining * dosesPerVial;

    adjustmentsStore.unshift({
      id: `topup_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      facilityName: facility.facilityName,
      vaccine: canonical,
      previousAllocation: prevTopUp,
      adjustment: topUpVials - prevTopUp,
      newAllocation: topUpVials,
      reason: `Unrelieved Top-up updated to ${topUpVials} vials (${topUpVials * dosesPerVial} doses) for ${canonical}`,
      user,
      timestamp: new Date().toISOString()
    });
  }

  facility.updatedAt = new Date().toISOString();
  facility.updatedBy = `${user} (Top-up updated)`;

  return { success: true, updatedFacility: facility };
}

/**
 * Update facility name, district, sub-district, or tab metadata
 */
export function updateFacilityDetails(
  facilityId: string,
  updates: {
    facilityName?: string;
    district?: string;
    subDistrict?: string;
    tabName?: string;
    nest?: string;
  }
): { success: boolean; facility?: FacilityAllocationRecord; error?: string } {
  const facility = facilitiesStore.get(facilityId);
  if (!facility) return { success: false, error: 'Facility not found' };
  
  if (updates.facilityName && updates.facilityName.trim()) {
    facility.facilityName = updates.facilityName.trim();
  }
  if (updates.district !== undefined) facility.district = updates.district.trim();
  if (updates.subDistrict !== undefined) facility.subDistrict = updates.subDistrict.trim();
  if (updates.tabName !== undefined) facility.tabName = updates.tabName.trim();
  if (updates.nest !== undefined) facility.nest = updates.nest.trim();
  
  facility.updatedAt = new Date().toISOString();
  facility.updatedBy = 'CCA / Operator Update';
  return { success: true, facility };
}

/**
 * Add or initialize a new vaccine product for a facility
 */
export function addVaccineProductToFacility(
  facilityId: string,
  vaccineName: string,
  options?: {
    original?: number;
    carryOver?: number;
    topUp?: number;
    dosesPerVial?: number;
    unit?: 'vials' | 'doses';
  }
): { success: boolean; facility?: FacilityAllocationRecord; error?: string } {
  const facility = facilitiesStore.get(facilityId);
  if (!facility) return { success: false, error: 'Facility not found' };
  if (!vaccineName || !vaccineName.trim()) return { success: false, error: 'Vaccine name is required' };

  const matched = matchVaccineName(vaccineName.trim());
  const canonical = matched.canonical || vaccineName.trim();
  const dpv = options?.dosesPerVial || getDosesPerVial(canonical);

  let origVials = options?.original || 0;
  if (options?.unit === 'doses' && origVials > 0) {
    origVials = Math.ceil(origVials / dpv);
  }
  let carryOverVials = options?.carryOver || 0;
  if (options?.unit === 'doses' && carryOverVials > 0) {
    carryOverVials = Math.ceil(carryOverVials / dpv);
  }
  let topUpVials = options?.topUp || 0;
  if (options?.unit === 'doses' && topUpVials > 0) {
    topUpVials = Math.ceil(topUpVials / dpv);
  }

  facility.vaccines[canonical] = buildVaccineDetail(canonical, {
    original: origVials,
    carryOver: carryOverVials,
    topUp: topUpVials,
    taken: 0,
    remaining: origVials + carryOverVials + topUpVials
  });

  // Ensure alias entry exists
  if (!customAliases[canonical]) {
    customAliases[canonical] = [canonical.toLowerCase()];
  }

  facility.updatedAt = new Date().toISOString();
  facility.updatedBy = 'CCA Added Product';
  return { success: true, facility };
}
