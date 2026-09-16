/**
 * Vaccine Allocation Validation & Tracking Service
 * Authoritative transactional service for DCO vaccine allocations,
 * WhatsApp/FS cross-validation, concurrency protection, and audit logs.
 */

export interface VaccineAllocationDetail {
  original: number;
  taken: number;
  remaining: number;
  adjustment?: number;
  carryOver?: number;
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
    previousTaken: number;
    currentOrder: number;
    remainingAfter: number;
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
  'BCG': ['bcg', 'bcg vaccine', 'bcg inj', 'bacillus calmette-guerin', 'bcg injection'],
  'OPV': ['opv', 'bopv', 'oral polio', 'oral polio vaccine', 'opv vaccine', 'bopv vaccine', 'polio oral', 'oral polio drops'],
  'Penta': ['penta', 'pentavalent', 'penta vaccine', 'pentavalent vaccine', 'dtp-hep b-hib', 'dtp-hepb-hib', 'pentavalent (dtp-hepb-hib)'],
  'PCV': ['pcv', 'pcv13', 'pneumococcal', 'pneumococcal vaccine', 'pcv vaccine', 'pneumococcal conjugate'],
  'Rota': ['rota', 'rotavirus', 'rotavirus vaccine', 'rota vaccine', 'rotasiil', 'rotarix'],
  'MR': ['mr', 'measles rubella', 'measles-rubella', 'mr vaccine', 'measles and rubella', 'measles vaccine', 'measles'],
  'Yellow Fever': ['yellow fever', 'yf', 'yf vaccine', 'yellow fever vaccine', 'stamaril'],
  'Men A': ['men a', 'mena', 'men-a', 'menafrivac', 'meningococcal a', 'meningococcal a conjugate', 'meningitis a'],
  'HPV': ['hpv', 'human papillomavirus', 'gardasil', 'hpv vaccine'],
  'IPV': ['ipv', 'inactivated polio', 'inactivated polio vaccine'],
  'Td': ['td', 'tetanus diphtheria', 'tetanus-diphtheria', 'tetanus diphtheria vaccine', 'tt', 'tetanus toxoid'],
  'COVID-19': ['covid', 'covid-19', 'pfizer', 'moderna', 'johnson & johnson', 'astrazeneca']
};

let customAliases: Record<string, string[]> = { ...DEFAULT_ALIASES };

// In-memory collections with fast locking
const facilitiesStore: Map<string, FacilityAllocationRecord> = new Map();
const transactionsStore: AllocationTransactionRecord[] = [];
const adjustmentsStore: AllocationAdjustmentRecord[] = [];
let errorsPreventedCount = 0;
let duplicateAlertsCount = 0;

// Mutex lock map to ensure true atomicity per facility during multi-CCA orders
const facilityLocks: Map<string, boolean> = new Map();

export function getAliases() {
  return customAliases;
}

export function updateAliases(updated: Record<string, string[]>) {
  customAliases = { ...DEFAULT_ALIASES, ...updated };
  return customAliases;
}

// Normalize incoming text token to canonical vaccine name
export function matchVaccineName(rawName: string): { canonical: string; confidence: 'high' | 'medium' | 'none' } {
  if (!rawName) return { canonical: rawName, confidence: 'none' };
  const lower = rawName.toLowerCase().trim();

  // 1. Direct exact canonical match
  for (const canonical of Object.keys(customAliases)) {
    if (canonical.toLowerCase() === lower) {
      return { canonical, confidence: 'high' };
    }
  }

  // 2. Exact alias match
  for (const [canonical, aliases] of Object.entries(customAliases)) {
    for (const alias of aliases) {
      if (alias.toLowerCase() === lower) {
        return { canonical, confidence: 'high' };
      }
    }
  }

  // 3. Substring / boundary matching
  for (const [canonical, aliases] of Object.entries(customAliases)) {
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp('(^|[^a-zA-Z0-9])' + escaped + '($|[^a-zA-Z0-9])', 'i');
      if (reg.test(lower)) {
        return { canonical, confidence: 'high' };
      }
    }
  }

  // 4. Fallback: capital letter token match
  for (const canonical of Object.keys(customAliases)) {
    if (lower.includes(canonical.toLowerCase())) {
      return { canonical, confidence: 'medium' };
    }
  }

  return { canonical: rawName.trim(), confidence: 'none' };
}

// Default Seed Data according to operational tabs: Karaga, West Mamprusi, MMD, East Mamprusi, Bunkpurugu
export function getInitialDemoFacilities(): FacilityAllocationRecord[] {
  return [
    // ----------------------------------------------------
    // TAB 1: Karaga September allocation (District: Karaga)
    // ----------------------------------------------------
    {
      id: 'karaga_district_hospital',
      facilityName: 'Karaga District Hospital',
      district: 'Karaga',
      subDistrict: 'Karaga Central',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'Karaga September allocation',
      vaccines: {
        'BCG': { original: 120, taken: 40, remaining: 80, adjustment: 0, carryOver: 20 },
        'OPV': { original: 200, taken: 80, remaining: 120, adjustment: 0, carryOver: 30 },
        'Penta': { original: 150, taken: 50, remaining: 100, adjustment: 0, carryOver: 20 },
        'PCV': { original: 120, taken: 30, remaining: 90, adjustment: 0, carryOver: 15 },
        'Rota': { original: 100, taken: 30, remaining: 70, adjustment: 0, carryOver: 15 },
        'MR': { original: 80, taken: 20, remaining: 60, adjustment: 0, carryOver: 10 },
        'Yellow Fever': { original: 60, taken: 10, remaining: 50, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'pigu_health_centre',
      facilityName: 'Pigu Health Centre',
      district: 'Karaga',
      subDistrict: 'Pigu Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'Karaga September allocation',
      vaccines: {
        'BCG': { original: 60, taken: 20, remaining: 40, adjustment: 0, carryOver: 10 },
        'OPV': { original: 100, taken: 40, remaining: 60, adjustment: 0, carryOver: 15 },
        'Penta': { original: 80, taken: 30, remaining: 50, adjustment: 0, carryOver: 10 },
        'PCV': { original: 60, taken: 20, remaining: 40, adjustment: 0, carryOver: 10 },
        'Rota': { original: 50, taken: 15, remaining: 35, adjustment: 0, carryOver: 5 },
        'MR': { original: 40, taken: 10, remaining: 30, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'nyong_chps',
      facilityName: 'Nyong CHPS',
      district: 'Karaga',
      subDistrict: 'Nyong Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'Karaga September allocation',
      vaccines: {
        'BCG': { original: 30, taken: 10, remaining: 20, adjustment: 0, carryOver: 5 },
        'OPV': { original: 50, taken: 20, remaining: 30, adjustment: 0, carryOver: 10 },
        'Penta': { original: 40, taken: 15, remaining: 25, adjustment: 0, carryOver: 5 },
        'PCV': { original: 30, taken: 10, remaining: 20, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },

    // ----------------------------------------------------
    // TAB 2: West Mamprusi Sep (District: West Mamprusi)
    // ----------------------------------------------------
    {
      id: 'walewale_municipal_hospital',
      facilityName: 'Walewale Municipal Hospital',
      district: 'West Mamprusi',
      subDistrict: 'Walewale Central',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'West Mamprusi Sep',
      vaccines: {
        'BCG': { original: 150, taken: 60, remaining: 90, adjustment: 0, carryOver: 25 },
        'OPV': { original: 220, taken: 90, remaining: 130, adjustment: 0, carryOver: 35 },
        'Penta': { original: 160, taken: 60, remaining: 100, adjustment: 0, carryOver: 20 },
        'PCV': { original: 140, taken: 40, remaining: 100, adjustment: 0, carryOver: 20 },
        'Rota': { original: 110, taken: 35, remaining: 75, adjustment: 0, carryOver: 15 },
        'MR': { original: 90, taken: 25, remaining: 65, adjustment: 0, carryOver: 10 },
        'Yellow Fever': { original: 70, taken: 15, remaining: 55, adjustment: 0, carryOver: 10 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'wulugu_health_centre',
      facilityName: 'Wulugu Health Centre',
      district: 'West Mamprusi',
      subDistrict: 'Wulugu Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'West Mamprusi Sep',
      vaccines: {
        'BCG': { original: 70, taken: 25, remaining: 45, adjustment: 0, carryOver: 10 },
        'OPV': { original: 110, taken: 45, remaining: 65, adjustment: 0, carryOver: 15 },
        'Penta': { original: 85, taken: 35, remaining: 50, adjustment: 0, carryOver: 10 },
        'PCV': { original: 65, taken: 20, remaining: 45, adjustment: 0, carryOver: 10 },
        'Rota': { original: 55, taken: 20, remaining: 35, adjustment: 0, carryOver: 5 },
        'MR': { original: 45, taken: 15, remaining: 30, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'kparigu_health_centre',
      facilityName: 'Kparigu Health Centre',
      district: 'West Mamprusi',
      subDistrict: 'Kparigu Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'West Mamprusi Sep',
      vaccines: {
        'BCG': { original: 40, taken: 15, remaining: 25, adjustment: 0, carryOver: 5 },
        'OPV': { original: 60, taken: 25, remaining: 35, adjustment: 0, carryOver: 10 },
        'Penta': { original: 45, taken: 20, remaining: 25, adjustment: 0, carryOver: 5 },
        'PCV': { original: 35, taken: 10, remaining: 25, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },

    // ----------------------------------------------------
    // TAB 3: MMD Sep (District: MMD / Mamprugu Moagduri)
    // ----------------------------------------------------
    {
      id: 'yagaba_health_centre',
      facilityName: 'Yagaba Health Centre',
      district: 'MMD',
      subDistrict: 'Yagaba Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'MMD Sep',
      vaccines: {
        'BCG': { original: 80, taken: 30, remaining: 50, adjustment: 0, carryOver: 15 },
        'OPV': { original: 130, taken: 50, remaining: 80, adjustment: 0, carryOver: 20 },
        'Penta': { original: 90, taken: 35, remaining: 55, adjustment: 0, carryOver: 15 },
        'PCV': { original: 75, taken: 25, remaining: 50, adjustment: 0, carryOver: 10 },
        'Rota': { original: 65, taken: 20, remaining: 45, adjustment: 0, carryOver: 10 },
        'MR': { original: 50, taken: 15, remaining: 35, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'kubori_health_centre',
      facilityName: 'Kubori Health Centre',
      district: 'MMD',
      subDistrict: 'Kubori Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'MMD Sep',
      vaccines: {
        'BCG': { original: 50, taken: 20, remaining: 30, adjustment: 0, carryOver: 10 },
        'OPV': { original: 80, taken: 30, remaining: 50, adjustment: 0, carryOver: 15 },
        'Penta': { original: 60, taken: 25, remaining: 35, adjustment: 0, carryOver: 10 },
        'PCV': { original: 50, taken: 15, remaining: 35, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'soo_chps',
      facilityName: 'Soo CHPS Compound',
      district: 'MMD',
      subDistrict: 'Soo Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'MMD Sep',
      vaccines: {
        'BCG': { original: 30, taken: 10, remaining: 20, adjustment: 0, carryOver: 5 },
        'OPV': { original: 45, taken: 15, remaining: 30, adjustment: 0, carryOver: 5 },
        'Penta': { original: 35, taken: 10, remaining: 25, adjustment: 0, carryOver: 5 },
        'PCV': { original: 30, taken: 10, remaining: 20, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },

    // ----------------------------------------------------
    // TAB 4: East Mamprusi Sept (District: East Mamprusi)
    // ----------------------------------------------------
    {
      id: 'gambaga_health_centre',
      facilityName: 'Gambaga Health Centre',
      district: 'East Mamprusi',
      subDistrict: 'Gambaga Central',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'East Mamprusi Sept',
      vaccines: {
        'BCG': { original: 100, taken: 35, remaining: 65, adjustment: 0, carryOver: 15 },
        'OPV': { original: 160, taken: 65, remaining: 95, adjustment: 0, carryOver: 25 },
        'Penta': { original: 120, taken: 45, remaining: 75, adjustment: 0, carryOver: 20 },
        'PCV': { original: 100, taken: 35, remaining: 65, adjustment: 0, carryOver: 15 },
        'Rota': { original: 80, taken: 25, remaining: 55, adjustment: 0, carryOver: 10 },
        'MR': { original: 65, taken: 20, remaining: 45, adjustment: 0, carryOver: 10 },
        'Yellow Fever': { original: 50, taken: 15, remaining: 35, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'nalerigu_bmc',
      facilityName: 'Nalerigu Baptist Medical Centre',
      district: 'East Mamprusi',
      subDistrict: 'Nalerigu Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'East Mamprusi Sept',
      vaccines: {
        'BCG': { original: 180, taken: 70, remaining: 110, adjustment: 0, carryOver: 30 },
        'OPV': { original: 260, taken: 110, remaining: 150, adjustment: 0, carryOver: 40 },
        'Penta': { original: 200, taken: 80, remaining: 120, adjustment: 0, carryOver: 30 },
        'PCV': { original: 160, taken: 60, remaining: 100, adjustment: 0, carryOver: 25 },
        'Rota': { original: 130, taken: 45, remaining: 85, adjustment: 0, carryOver: 20 },
        'MR': { original: 110, taken: 35, remaining: 75, adjustment: 0, carryOver: 15 },
        'Yellow Fever': { original: 90, taken: 25, remaining: 65, adjustment: 0, carryOver: 10 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'langbinsi_health_centre',
      facilityName: 'Langbinsi Health Centre',
      district: 'East Mamprusi',
      subDistrict: 'Langbinsi Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'East Mamprusi Sept',
      vaccines: {
        'BCG': { original: 60, taken: 20, remaining: 40, adjustment: 0, carryOver: 10 },
        'OPV': { original: 90, taken: 35, remaining: 55, adjustment: 0, carryOver: 15 },
        'Penta': { original: 70, taken: 25, remaining: 45, adjustment: 0, carryOver: 10 },
        'PCV': { original: 55, taken: 20, remaining: 35, adjustment: 0, carryOver: 10 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },

    // ----------------------------------------------------
    // TAB 5: Bunkpurugu Sept (District: Bunkpurugu)
    // ----------------------------------------------------
    {
      id: 'bunkpurugu_district_hospital',
      facilityName: 'Bunkpurugu District Hospital',
      district: 'Bunkpurugu',
      subDistrict: 'Bunkpurugu Central',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'Bunkpurugu Sept',
      vaccines: {
        'BCG': { original: 130, taken: 50, remaining: 80, adjustment: 0, carryOver: 20 },
        'OPV': { original: 190, taken: 75, remaining: 115, adjustment: 0, carryOver: 30 },
        'Penta': { original: 140, taken: 50, remaining: 90, adjustment: 0, carryOver: 20 },
        'PCV': { original: 110, taken: 35, remaining: 75, adjustment: 0, carryOver: 15 },
        'Rota': { original: 90, taken: 30, remaining: 60, adjustment: 0, carryOver: 15 },
        'MR': { original: 75, taken: 25, remaining: 50, adjustment: 0, carryOver: 10 },
        'Yellow Fever': { original: 60, taken: 15, remaining: 45, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'nakpanduri_health_centre',
      facilityName: 'Nakpanduri Health Centre',
      district: 'Bunkpurugu',
      subDistrict: 'Nakpanduri Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'Bunkpurugu Sept',
      vaccines: {
        'BCG': { original: 75, taken: 25, remaining: 50, adjustment: 0, carryOver: 10 },
        'OPV': { original: 110, taken: 40, remaining: 70, adjustment: 0, carryOver: 15 },
        'Penta': { original: 80, taken: 30, remaining: 50, adjustment: 0, carryOver: 10 },
        'PCV': { original: 65, taken: 20, remaining: 45, adjustment: 0, carryOver: 10 },
        'Rota': { original: 50, taken: 15, remaining: 35, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    },
    {
      id: 'bimbagu_health_centre',
      facilityName: 'Bimbagu Health Centre',
      district: 'Bunkpurugu',
      subDistrict: 'Bimbagu Sub-district',
      nest: 'Northern Nest',
      cycle: 'September 2026',
      tabName: 'Bunkpurugu Sept',
      vaccines: {
        'BCG': { original: 45, taken: 15, remaining: 30, adjustment: 0, carryOver: 5 },
        'OPV': { original: 65, taken: 25, remaining: 40, adjustment: 0, carryOver: 10 },
        'Penta': { original: 50, taken: 20, remaining: 30, adjustment: 0, carryOver: 5 },
        'PCV': { original: 40, taken: 15, remaining: 25, adjustment: 0, carryOver: 5 }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'DCO Central Depot'
    }
  ];
}

let hasBeenExplicitlyCleared = false;

// Seed initial memory
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

  if (options?.clearHistory) {
    transactionsStore.length = 0;
    adjustmentsStore.length = 0;
    errorsPreventedCount = 0;
    duplicateAlertsCount = 0;
  }

  return {
    success: true,
    message: 'Previous allocations successfully cleared. Ready for new cycle upload.',
    facilitiesCount: 0
  };
}

// Parse lines into vaccine & quantity pairs
export function parseVaccineLines(text: string): Array<{ rawName: string; canonical: string; quantity: number; confidence: string }> {
  if (!text) return [];
  const lines = text.split('\n');
  const items: Array<{ rawName: string; canonical: string; quantity: number; confidence: string }> = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // Skip general header/metadata lines
    if (/^(facility|hospital|clinic|district|order|phone|contact|date|delivered|received|status|dr|cca)\s*[:=]/i.test(line)) {
      continue;
    }

    // Try standard patterns:
    // 1) "BCG - 20" or "BCG: 20" or "BCG = 20" or "BCG 20"
    // 2) "20 vials BCG" or "20x OPV"
    // 3) "BCG 20 vials"
    let name = '';
    let qty = 0;

    // Pattern A: Name followed by delimiter and number
    const matchA = line.match(/^([A-Za-z0-9\s\-–\(\)\/]+?)(?:[-:=–—xX]|\s{2,})\s*(\d+)(?:\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?|drops?))?$/i);
    if (matchA) {
      name = matchA[1].trim();
      qty = parseInt(matchA[2], 10);
    } else {
      // Pattern B: Number first then name e.g. "20 BCG" or "20 vials BCG"
      const matchB = line.match(/^(\d+)\s*(?:vials?|doses?|packs?|boxes?|pieces?|pcs?|units?|drops?|x)?\s*[-:=–—]?\s*([A-Za-z0-9\s\-–\(\)\/]+)$/i);
      if (matchB) {
        qty = parseInt(matchB[1], 10);
        name = matchB[2].trim();
      } else {
        // Pattern C: "BCG 20"
        const matchC = line.match(/^([A-Za-z\s]+)\s+(\d+)$/i);
        if (matchC) {
          name = matchC[1].trim();
          qty = parseInt(matchC[2], 10);
        }
      }
    }

    if (name && qty >= 0) {
      const matched = matchVaccineName(name);
      items.push({
        rawName: name,
        canonical: matched.canonical,
        quantity: qty,
        confidence: matched.confidence
      });
    }
  }

  // Deduplicate/sum if multiple lines refer to the exact same canonical vaccine
  const consolidated = new Map<string, { rawName: string; canonical: string; quantity: number; confidence: string }>();
  for (const it of items) {
    const key = it.canonical;
    if (consolidated.has(key)) {
      const existing = consolidated.get(key)!;
      existing.quantity += it.quantity;
    } else {
      consolidated.set(key, { ...it });
    }
  }

  return Array.from(consolidated.values());
}

// Extract facility name from text if present
export function extractFacilityFromText(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(?:facility|hospital|clinic|health center|delivered to|ordering facility)\s*[:=–]\s*([^\n\r,]+)/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

// Comprehensive Vaccine Allocation Validation Logic
export function validateVaccineOrder(params: {
  facilityId: string;
  orderSource: 'whatsapp' | 'fs_only';
  whatsappMessage: string;
  fulfillmentConfirmation: string;
}): {
  isValid: boolean;
  orderSource: 'whatsapp' | 'fs_only';
  facilitySelected: string;
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
} {
  const { facilityId, orderSource, whatsappMessage, fulfillmentConfirmation } = params;
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
  if (extractedFsFacility) {
    facilityFoundInFs = extractedFsFacility;
    const fsFacMatch = getFacilityByName(extractedFsFacility);
    if (fsFacMatch && fsFacMatch.id !== facility.id) {
      facilityMismatch = true;
      errors.push(`FACILITY MISMATCH: The selected facility is "${facility.facilityName}", but the FS Confirmation specifies "${extractedFsFacility}".`);
    } else if (!fsFacMatch && !extractedFsFacility.toLowerCase().includes(facility.facilityName.toLowerCase()) && !facility.facilityName.toLowerCase().includes(extractedFsFacility.toLowerCase())) {
      facilityMismatch = true;
      errors.push(`FACILITY MISMATCH: FS entry refers to facility "${extractedFsFacility}", which does not match selected "${facility.facilityName}".`);
    }
  }

  // 2. Parse Order Sources
  const waItems = orderSource === 'whatsapp' ? parseVaccineLines(whatsappMessage) : [];
  const fsItems = parseVaccineLines(fulfillmentConfirmation);

  if (orderSource === 'whatsapp' && waItems.length === 0 && (!whatsappMessage || whatsappMessage.trim().length === 0)) {
    errors.push('WhatsApp Request is selected as Order Source, but no WhatsApp order message was provided.');
  }

  if (fsItems.length === 0 && (!fulfillmentConfirmation || fulfillmentConfirmation.trim().length === 0)) {
    errors.push('No Fulfillment System (FS) confirmation text was provided for validation.');
  }

  const comparisonMap = new Map<string, {
    vaccine: string;
    requestedQty: number;
    fsQty: number;
    originalAllocation: number;
    previouslyTaken: number;
    remainingBefore: number;
    remainingAfter: number;
    status: string;
    errorDetail?: string;
    warningDetail?: string;
  }>();

  // Populate from WhatsApp items (if WhatsApp source)
  if (orderSource === 'whatsapp') {
    for (const w of waItems) {
      const alloc = facility.vaccines[w.canonical];
      const orig = alloc ? alloc.original + (alloc.adjustment || 0) : 0;
      const taken = alloc ? alloc.taken : 0;
      const remBefore = alloc ? alloc.remaining : 0;

      comparisonMap.set(w.canonical, {
        vaccine: w.canonical,
        requestedQty: w.quantity,
        fsQty: 0, // will be matched with FS below
        originalAllocation: orig,
        previouslyTaken: taken,
        remainingBefore: remBefore,
        remainingAfter: remBefore - w.quantity,
        status: 'valid'
      });
    }
  }

  // Merge with FS items
  for (const f of fsItems) {
    if (comparisonMap.has(f.canonical)) {
      const existing = comparisonMap.get(f.canonical)!;
      existing.fsQty = f.quantity;
      existing.remainingAfter = existing.remainingBefore - f.quantity;
    } else {
      const alloc = facility.vaccines[f.canonical];
      const orig = alloc ? alloc.original + (alloc.adjustment || 0) : 0;
      const taken = alloc ? alloc.taken : 0;
      const remBefore = alloc ? alloc.remaining : 0;

      comparisonMap.set(f.canonical, {
        vaccine: f.canonical,
        requestedQty: orderSource === 'whatsapp' ? 0 : f.quantity,
        fsQty: f.quantity,
        originalAllocation: orig,
        previouslyTaken: taken,
        remainingBefore: remBefore,
        remainingAfter: remBefore - f.quantity,
        status: 'valid'
      });
    }
  }

  const validationItems: any[] = [];

  // 3. Perform exhaustive checks for each product
  for (const [canonicalName, comp] of comparisonMap.entries()) {
    const isAllocated = !!facility.vaccines[canonicalName];
    const alloc = facility.vaccines[canonicalName];
    const effectiveQtyToDeduct = orderSource === 'whatsapp' ? comp.fsQty : comp.fsQty;

    // Check low confidence product alias
    const matchingAlias = matchVaccineName(canonicalName);
    if (matchingAlias.confidence === 'medium') {
      comp.warningDetail = `PRODUCT MATCH REQUIRES CONFIRMATION: "${canonicalName}" was mapped using fuzzy match. Please confirm product.`;
      warnings.push(comp.warningDetail);
    }

    // Check A: WhatsApp vs FS cross-checks
    if (orderSource === 'whatsapp') {
      // Check Missing Product: Customer requested in WhatsApp but missing from FS
      if (comp.requestedQty > 0 && comp.fsQty === 0) {
        comp.status = 'missing_product';
        comp.errorDetail = `MISSING PRODUCT: ${comp.vaccine} (${comp.requestedQty}) was requested in WhatsApp but is missing from the FS entry.`;
        errors.push(comp.errorDetail);
        validationItems.push(comp);
        continue;
      }

      // Check Unexpected Product: Present in FS but was NOT in WhatsApp request
      if (comp.requestedQty === 0 && comp.fsQty > 0) {
        comp.status = 'unexpected_product';
        comp.errorDetail = `UNEXPECTED PRODUCT: ${comp.vaccine} (${comp.fsQty}) was entered into FS but was not requested by the customer.`;
        errors.push(comp.errorDetail);
        validationItems.push(comp);
        continue;
      }

      // Check Quantity Mismatch between WhatsApp and FS
      if (comp.requestedQty !== comp.fsQty) {
        comp.status = 'quantity_mismatch';
        comp.errorDetail = `QUANTITY MISMATCH: Customer requested ${comp.requestedQty} ${comp.vaccine}, but FS has ${comp.fsQty}.`;
        errors.push(comp.errorDetail);
      }
    }

    // Check B: Allocation checks
    if (!isAllocated) {
      comp.status = 'not_allocated';
      comp.errorDetail = `VACCINE NOT ALLOCATED: ${comp.vaccine} has NO allocated quota for ${facility.facilityName}.`;
      errors.push(comp.errorDetail);
      validationItems.push(comp);
      continue;
    }

    // Check Allocation Exhausted (Remaining is 0)
    if (comp.remainingBefore <= 0) {
      comp.status = 'exhausted';
      comp.errorDetail = `ALLOCATION EXHAUSTED: ${comp.vaccine} has 0 remaining allocation available for this facility.`;
      errors.push(comp.errorDetail);
      validationItems.push(comp);
      continue;
    }

    // Check Quantity Exceeds Allocation
    if (effectiveQtyToDeduct > comp.remainingBefore) {
      comp.status = 'excess_quantity';
      const excess = effectiveQtyToDeduct - comp.remainingBefore;
      comp.errorDetail = `QUANTITY EXCEEDS ALLOCATION: Entered ${effectiveQtyToDeduct} ${comp.vaccine}, but only ${comp.remainingBefore} is available. (Excess: ${excess})`;
      errors.push(comp.errorDetail);
      validationItems.push(comp);
      continue;
    }

    // If no errors flagged for this item
    if (comp.status === 'valid') {
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
        const isMatch = fsItems.some(f => 
          tx.items.some(txi => txi.vaccine === f.canonical && txi.currentOrder === f.quantity)
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

  return {
    isValid,
    orderSource,
    facilitySelected: facility.facilityName,
    facilityFoundInFs,
    facilityMismatch,
    errors,
    warnings,
    items: validationItems,
    duplicateWarning,
    validatedAt: new Date().toISOString()
  };
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

    // Step 1: Real-time Re-validation against current live balance
    // Ensure sufficient allocation still exists right now!
    for (const item of items) {
      const alloc = facility.vaccines[item.vaccine];
      if (!alloc) {
        return {
          success: false,
          error: `ALLOCATION ERROR: ${item.vaccine} has no allocation configured for this facility.`
        };
      }
      if (item.currentOrder > alloc.remaining) {
        return {
          success: false,
          error: `ALLOCATION CHANGED: The available allocation for ${item.vaccine} has changed since your last check. Current remaining: ${alloc.remaining}, Requested: ${item.currentOrder}. Please review the order.`
        };
      }
    }

    // Step 2: Deduct quantities and build transaction record
    const transactionItems: Array<{
      vaccine: string;
      requestedQty: number;
      previousTaken: number;
      currentOrder: number;
      remainingAfter: number;
    }> = [];

    for (const item of items) {
      const alloc = facility.vaccines[item.vaccine];
      const prevTaken = alloc.taken;
      const newTaken = prevTaken + item.currentOrder;
      const totalAuthorized = alloc.original + (alloc.adjustment || 0);
      const newRemaining = Math.max(0, totalAuthorized - newTaken);

      // Mutate facility allocation (NEVER touch original allocation!)
      alloc.taken = newTaken;
      alloc.remaining = newRemaining;

      transactionItems.push({
        vaccine: item.vaccine,
        requestedQty: item.currentOrder,
        previousTaken: prevTaken,
        currentOrder: item.currentOrder,
        remainingAfter: newRemaining
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
  reason: string;
  user: string;
}): { success: boolean; error?: string; updatedFacility?: FacilityAllocationRecord } {
  const { facilityId, vaccine, adjustment, reason, user } = params;
  const facility = getFacilityById(facilityId);
  if (!facility) return { success: false, error: 'Facility not found.' };

  const matched = matchVaccineName(vaccine);
  const canonical = matched.canonical;

  let alloc = facility.vaccines[canonical];
  if (!alloc) {
    // Create new vaccine slot if DCO is allocating a new product
    alloc = {
      original: 0,
      taken: 0,
      remaining: 0,
      adjustment: 0
    };
    facility.vaccines[canonical] = alloc;
  }

  const prevAlloc = alloc.original + (alloc.adjustment || 0);
  alloc.adjustment = (alloc.adjustment || 0) + adjustment;
  const newTotalAuthorized = alloc.original + alloc.adjustment;
  alloc.remaining = Math.max(0, newTotalAuthorized - alloc.taken);

  const adjId = `ADJ-${Date.now().toString(36).toUpperCase()}`;
  const adjRecord: AllocationAdjustmentRecord = {
    id: adjId,
    facilityName: facility.facilityName,
    vaccine: canonical,
    previousAllocation: prevAlloc,
    adjustment,
    newAllocation: newTotalAuthorized,
    reason,
    user: user || 'DCO Officer',
    timestamp: new Date().toISOString()
  };

  adjustmentsStore.unshift(adjRecord);
  facility.updatedAt = new Date().toISOString();
  facility.updatedBy = user || 'DCO Officer';

  return {
    success: true,
    updatedFacility: facility
  };
}

// Bulk Upload & Merge from parsed Excel / CSV rows
export function importAllocationsFromRows(rows: Array<{
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
}>, updatedBy: string = 'DCO Bulk Upload'): { importedCount: number; facilitiesCount: number } {
  const currentCycle = 'September 2026';
  let importedCount = 0;

  for (const row of rows) {
    if (!row.facility || !row.vaccine || isNaN(row.allocation)) continue;

    const facName = row.facility.trim();
    let facility = getFacilityByName(facName);

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

    if (!facility) {
      const id = facName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
    const rem = !isNaN(Number(row.remaining)) ? Number(row.remaining) : Math.max(0, orig - prevTaken);

    facility.vaccines[canonical] = {
      original: orig,
      taken: prevTaken,
      remaining: rem,
      adjustment: 0,
      carryOver
    };

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
  let totalOrdered = 0;
  let totalRemaining = 0;
  let facilitiesWithRemaining = 0;
  let facilitiesExhausted = 0;

  for (const f of allFacilities) {
    let facHasRemaining = false;
    let facHasExhausted = false;

    for (const v of Object.values(f.vaccines)) {
      const totalAuth = v.original + (v.adjustment || 0);
      totalAllocated += totalAuth;
      totalOrdered += v.taken;
      totalRemaining += v.remaining;

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
    totalAllocated,
    totalOrdered,
    totalRemaining,
    errorsPrevented: errorsPreventedCount,
    duplicateAlerts: duplicateAlertsCount
  };
}
