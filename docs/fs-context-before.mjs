// shared/productCatalog.ts
var catalogKey = (value) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/(?<=[a-z])-(?=[a-z])/g, " ").replace(/\s+/g, " ").trim();
function catalogProductNames(product) {
  const names2 = [product.name, product.displayName, product.fulfillmentSystemName, ...product.aliases].filter((name) => typeof name === "string" && !!name.trim());
  return [...new Map(names2.map((name) => [catalogKey(name), name.trim()])).values()];
}

// shared/vaccinePairing.ts
var CLINICAL_PAIRINGS = {
  BCG: { type: "diluent", name: "BCG Diluent", accessoryCanonical: "BCG Diluent", dosesPerVial: 20 },
  MR: { type: "diluent", name: "MR Diluent", accessoryCanonical: "MR Diluent", dosesPerVial: 10 },
  "Yellow Fever": { type: "diluent", name: "Yellow Fever Diluent", accessoryCanonical: "Yellow Fever Diluent", dosesPerVial: 10 },
  "Men A": { type: "diluent", name: "Men A Diluent", accessoryCanonical: "Men A Diluent", dosesPerVial: 10 },
  OPV: { type: "dropper", name: "OPV Dropper", accessoryCanonical: "OPV Dropper", dosesPerVial: 20 },
  Rota: { type: "dropper", name: "Rota Dropper", accessoryCanonical: "Rota Dropper", dosesPerVial: 1 }
};
var defaultNames = {
  BCG: ["BCG Vaccine", "Bacille Calmette-Guerin Vaccine", "Bacillus Calmette-Guerin"],
  MR: ["Measles-Rubella Vaccine", "Measles Rubella Vaccine", "MR Vaccine"],
  "Yellow Fever": ["Yellow Fever Vaccine", "YF", "YF Vaccine"],
  "Men A": ["Meningococcal A Vaccine", "Meningococcal Conjugate A Vaccine", "Men A Vaccine", "Men-A", "Mena"],
  OPV: ["Oral Polio Vaccine", "OPV Vaccine", "bOPV", "OPV (One and Three)"],
  Rota: ["Rotavirus Vaccine", "Rota Vaccine"],
  "BCG Diluent": ["BCG Vaccine Diluent", "Bacille Calmette-Guerin Vaccine Diluent"],
  "MR Diluent": ["Measles-Rubella Vaccine Diluent", "Measles Rubella Vaccine Diluent"],
  "Yellow Fever Diluent": ["Yellow Fever Vaccine Diluent", "YF Diluent"],
  "Men A Diluent": ["Meningococcal A Vaccine Diluent", "Meningococcal Conjugate A Vaccine Diluent"],
  "OPV Dropper": ["Oral Polio Vaccine Dropper", "OPV Droppers"],
  "Rota Dropper": ["Rotavirus Vaccine Dropper", "Rota Droppers"]
};
var key = (value) => catalogKey(value).replace(/\bdiluents\b/g, "diluent").replace(/\bdroppers\b/g, "dropper");
var names = /* @__PURE__ */ new Map();
function setVaccinePairingCatalog(products) {
  const candidates = /* @__PURE__ */ new Map();
  const add = (canonical, labels) => labels.forEach((label) => {
    const targets = candidates.get(key(label)) || /* @__PURE__ */ new Set();
    targets.add(canonical);
    candidates.set(key(label), targets);
  });
  for (const [canonical, aliases] of Object.entries(defaultNames)) add(canonical, [canonical, ...aliases]);
  const defaults = new Map([...candidates].map(([label, targets]) => [label, [...targets][0]]));
  if (products.length) {
    candidates.clear();
    for (const canonical of Object.keys(defaultNames)) add(canonical, [canonical]);
  }
  for (const product of products) {
    const canonical = defaults.get(key(product.name));
    if (canonical) add(canonical, catalogProductNames(product).filter((label) => !product.contextualAliases.some((alias) => key(alias) === key(label))));
  }
  names = new Map([...candidates].filter(([, targets]) => targets.size === 1).map(([label, targets]) => [label, [...targets][0]]));
}
setVaccinePairingCatalog([]);

// server/blueprintFacility.ts
function assertBlueprintActive(sheet, row) {
  if (sheet?.worksheetRole === "other" || [sheet, row].some((value) => value && (value.active === false || value.isActive === false || value.archived === true || value.deleted === true || ["inactive", "archived", "deleted"].includes(String(value.status || "").toLowerCase())))) {
    throw new Error("ALLOCATION ERROR: The selected Allocation Blueprint or facility record is inactive. Select an active allocation cycle and audit again.");
  }
}
function normalizeFacilityName(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\bc[.\s]*h[.\s]*p[.\s]*s\b/g, "chps").replace(/\bh[.\s]*c\b\.?/g, "health centre").replace(/\bd[.\s]*h[.\s]*d\b\.?/g, "district health directorate").replace(/\bhealth\s+center\b/g, "health centre").replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

// server/vaccineService.ts
var DEFAULT_DOSES_PER_VIAL = {
  "BCG": CLINICAL_PAIRINGS.BCG.dosesPerVial,
  "OPV": CLINICAL_PAIRINGS.OPV.dosesPerVial,
  "Penta": 10,
  "PENTA": 10,
  "PCV": 2,
  "Rota": CLINICAL_PAIRINGS.Rota.dosesPerVial,
  "ROTA": 1,
  "MR": CLINICAL_PAIRINGS.MR.dosesPerVial,
  "Yellow Fever": CLINICAL_PAIRINGS["Yellow Fever"].dosesPerVial,
  "YF": 10,
  "Men A": CLINICAL_PAIRINGS["Men A"].dosesPerVial,
  "MEN A": 10,
  "HPV": 1,
  "IPV": 10,
  "Td": 10,
  "TD": 10,
  "DT": 10,
  "R21": 10,
  "COVID-19": 10
};
var DEFAULT_ALIASES = {
  // Specific Diluents & Droppers first to prevent substring collisions
  "BCG Diluent": ["bcg diluent", "diluent for bcg", "bcg vaccine diluent", "diluent bcg", "bacille calmette guerin vaccine diluent"],
  "MR Diluent": ["mr diluent", "measles diluent", "diluent for mr", "measles-rubella diluent", "diluent mr", "measles rubella vaccine diluent"],
  "Yellow Fever Diluent": ["yf diluent", "yellow fever diluent", "diluent for yellow fever", "diluent yf", "yellow fever vaccine diluent"],
  "Men A Diluent": ["men a diluent", "mena diluent", "meningococcal diluent", "diluent for men a", "meningitis a vaccine diluent"],
  "OPV Dropper": ["opv dropper", "opv droppers", "dropper for opv", "polio dropper", "polio droppers", "oral polio vaccine dropper"],
  "Rota Dropper": ["rota dropper", "rota droppers", "rotavirus dropper", "rotavirus droppers", "rotavirus vaccine dropper"],
  // Core Vaccines
  "BCG": ["bcg", "bcg vaccine", "bcg inj", "bacillus calmette-guerin", "bacille calmette-guerin vaccine", "bcg injection"],
  "OPV": ["opv", "bopv", "oral polio", "oral polio vaccine", "oral polio vaccine (1&3)", "opv vaccine", "bopv vaccine", "polio oral", "oral polio drops"],
  "Penta": ["penta", "pentavalent", "penta vaccine", "pentavalent vaccine", "pentavalent (5-in-1) vaccine", "dtp-hep b-hib", "dtp-hepb-hib", "pentavalent (dtp-hepb-hib)"],
  "PCV": ["pcv", "pcv13", "pneumococcal", "pneumococcal vaccine", "pcv vaccine", "pneumococcal conjugate", "pneumococcal conjugate vaccine"],
  "Rota": ["rota", "rotavirus", "rotavirus vaccine", "rota vaccine", "rotasiil", "rotarix"],
  "MR": ["mr", "measles rubella", "measles-rubella", "mr vaccine", "measles rubella vaccine", "measles-rubella vaccine", "measles and rubella", "measles vaccine", "measles"],
  "Yellow Fever": ["yellow fever", "yf", "yf vaccine", "yellow fever vaccine", "stamaril"],
  "Men A": ["men a", "mena", "men-a", "men a vaccine", "menafrivac", "meningococcal a", "meningococcal a conjugate", "meningitis a", "meningitis a vaccine"],
  "HPV": ["hpv", "human papillomavirus", "human papillomavirus vaccine", "gardasil", "hpv vaccine"],
  "IPV": ["ipv", "inactivated polio", "inactivated polio vaccine"],
  "DT": ["dt", "td", "tetanus diphtheria", "tetanus-diphtheria", "tetanus diphtheria vaccine", "diphtheria and tetanus vaccine", "diphtheria & tetanus vaccine", "tt", "tetanus toxoid"],
  "COVID-19": ["covid", "covid-19", "pfizer", "moderna", "johnson & johnson", "astrazeneca"]
};
var CUSTOMER_VACCINE_ALIASES = {
  "BCG": ["B.C.G", "Bacille Calmette Guerin", "TB vaccine", "tuberculosis vaccine"],
  "BCG Diluent": ["B.C.G diluent", "BCG water", "BCG solvent", "water for BCG", "BCG vaccine water"],
  "DT": ["Diphtheria Tetanus", "Diphtheria and Tetanus", "Diphtheria & Tetanus"],
  "IPV": ["IPV vaccine", "injectable polio", "polio injection"],
  "OPV": ["OPV 1&3", "OPV 1 and 3", "OPV one and three", "OPV one & three", "OPV (One and Three)", "polio drops"],
  "OPV Dropper": ["OPV vaccine dropper", "oral polio dropper"],
  "Penta": ["Pentavalent (5-in-1)", "5 in 1", "5-in-1 vaccine", "five in one", "five-in-one vaccine"],
  "PCV": ["PCV 13"],
  "Rota": ["RV", "RV vaccine"],
  "Rota Dropper": ["RV dropper", "dropper for Rota", "dropper for Rotavirus", "Rota vaccine dropper"],
  "Yellow Fever Diluent": ["YF vaccine diluent", "Yellow fever solvent", "Yellow fever water"],
  "MR": ["Measles & Rubella Vaccine", "M&R", "Measles/Rubella"],
  "MR Diluent": ["MR vaccine diluent", "Measles Rubella diluent", "Measles and Rubella diluent", "Measles & Rubella Vaccine Diluent", "MR water", "MR solvent"],
  "Men A": ["Meningococcal Conjugate A", "Meningococcal Conjugate A Vaccine", "Meningococcal A vaccine"],
  "Men A Diluent": ["Men-A diluent", "Meningitis A diluent", "Meningococcal A diluent", "Meningococcal vaccine diluent", "Meningococcal Conjugate A Vaccine Diluent", "Men A water", "Men A solvent"],
  "HPV": ["Human Papilloma Virus vaccine", "cervical cancer vaccine"]
};
for (const [canonical, aliases] of Object.entries(CUSTOMER_VACCINE_ALIASES)) DEFAULT_ALIASES[canonical].push(...aliases);
var customAliases = { ...DEFAULT_ALIASES };
function normalizeProductName(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/^\s*(?:[•*#>–—-]+\s*|\d+[.)]\s*)/, "").replace(/\bb\.\s*c\.\s*g\.?/gi, "BCG").toLowerCase().replace(/\bdiluents\b/g, "diluent").replace(/\bdroppers\b/g, "dropper").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function matchExactVaccineName(rawName) {
  const normalized = normalizeProductName(rawName || "");
  const matches = Object.entries(customAliases).filter(([canonical, aliases]) => [canonical, ...aliases].some((alias) => normalizeProductName(alias) === normalized)).map(([canonical]) => canonical);
  return matches.length === 1 ? { canonical: matches[0], confidence: "high" } : { canonical: rawName, confidence: "none" };
}
function initializeService() {
}
initializeService();

// server/blueprintConfirmation.ts
function blueprintAllocationNumbers(value) {
  const carryOver = Number(value.carryOver) || 0;
  const original = Number(value.allocation) || 0;
  const taken = Number(value.distributed) || 0;
  const remaining = value.balance !== void 0 && value.balance !== "" ? Number(value.balance) : Math.max(0, carryOver + original - taken);
  return { carryOver, original, taken, remaining };
}

// server/fsAllocation.ts
var text = (value) => typeof value === "string" ? value.trim().slice(0, 160) : "";
function activeFsFacilities(sheets) {
  return sheets.flatMap((sheet) => (sheet.rows || []).flatMap((row) => {
    try {
      assertBlueprintActive(sheet, row);
    } catch {
      return [];
    }
    if (!row.facility || !row.id) return [];
    return [{
      id: `${sheet.id}:${row.id}`,
      facilityName: row.facility,
      district: sheet.district || "",
      region: row.region || sheet.region || "",
      cycle: sheet.month || "",
      fsFacilityId: row.fsFacilityId || row.facilityId || "",
      sheet,
      row
    }];
  }));
}
var publicFacility = ({ sheet, row, ...facility }) => facility;
function lookupFsAllocation(sheets, input) {
  const all = activeFsFacilities(sheets);
  const fs = input.facility || {};
  const name = text(fs.name), id = text(fs.id), manual = text(input.manualFacilityId);
  if (!name && !id) return { status: "no_facility", message: "Select a facility in FS.", products: [] };
  let candidates = id ? all.filter((f) => f.fsFacilityId === id) : [];
  if (!candidates.length) candidates = all.filter((f) => name && normalizeFacilityName(f.facilityName) === normalizeFacilityName(name));
  candidates = candidates.filter((f) => (!text(fs.district) || normalizeFacilityName(f.district) === normalizeFacilityName(fs.district)) && (!text(fs.region) || !f.region || normalizeFacilityName(f.region) === normalizeFacilityName(fs.region)));
  if (manual) candidates = candidates.filter((f) => f.id === manual);
  if (!candidates.length) return { status: "not_found", message: "Facility not found in the current Allocation Blueprint.", products: [] };
  if (candidates.length !== 1) return { status: "ambiguous", message: "Multiple matching facilities. Select the facility and allocation cycle manually.", candidates: candidates.map(publicFacility), products: [] };
  const facility = candidates[0];
  const lookup = (product) => {
    const name2 = text(product.name), match = matchExactVaccineName(name2);
    const keys = Object.keys(facility.row.vaccines || {});
    const exact = keys.filter((key2) => normalizeProductName(key2) === normalizeProductName(name2));
    const qualified = /\b(?:\d+\s*(?:ml|mcg|mg|dose|doses|valent)|pcv\s*\d+|rotarix|rotasiil|td|tt)\b/i;
    const matching = exact.length ? exact : match.confidence === "high" && !qualified.test(name2) ? keys.filter((key2) => !qualified.test(key2) && matchExactVaccineName(key2).canonical === match.canonical) : [];
    const base = { name: name2, id: text(product.id), canonical: match.canonical, quantity: text(product.quantity) };
    if (!matching.length) return { ...base, balance: null, status: match.confidence === "high" ? "missing_record" : "untracked", message: match.confidence === "high" ? "Allocation record missing for this product or presentation." : "Product is not allocation-tracked." };
    if (matching.length > 1) return { ...base, balance: null, status: "unavailable", message: "Multiple allocation presentations. Manual review required." };
    const data = facility.row.vaccines[matching[0]] || {};
    const number = (v) => v !== null && v !== void 0 && String(v).trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
    const allocation = number(data.allocation), carry = number(data.carryOver), distributed = number(data.distributed);
    const explicit = number(data.balance);
    const hasKnownValues = [explicit, allocation, carry, distributed].some((value) => value !== null);
    const malformed = ["balance", "allocation", "carryOver", "distributed"].some((key2) => data[key2] !== null && data[key2] !== void 0 && String(data[key2]).trim() !== "" && number(data[key2]) === null);
    const balance = hasKnownValues && !malformed ? blueprintAllocationNumbers({ ...data, balance: explicit === null ? void 0 : explicit }).remaining : null;
    return { ...base, allocationKey: matching[0], balance: balance !== null && balance >= 0 ? balance : null, status: balance !== null && balance >= 0 ? "available" : "unavailable", message: balance !== null && balance >= 0 ? "" : "Allocation balance unavailable." };
  };
  const products = (Array.isArray(input.products) ? input.products : []).slice(0, 101).map(lookup);
  const companions = [...new Set(products.map((p) => CLINICAL_PAIRINGS[p.canonical]?.accessoryCanonical).filter(Boolean))].filter((name2) => !products.some((p) => p.canonical === name2)).map((name2) => ({ ...lookup({ name: name2 }), accompanying: true }));
  return { status: "matched", message: "", facility: publicFacility(facility), products, companions, refreshedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
export {
  activeFsFacilities,
  lookupFsAllocation
};
