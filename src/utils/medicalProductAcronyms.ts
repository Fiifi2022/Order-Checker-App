export interface ProductAcronym {
  name: string;
  aliases: string[];
  category: 'medicine' | 'blood' | 'diagnostic';
  contextual?: boolean;
  note?: string;
}

// Product identity vocabulary, not prescribing, substitution, compatibility,
// allocation, or package-conversion rules. Add locally confirmed aliases here.
// References: existing OrderCheck catalogue and prompts, FDA acetaminophen
// terminology, WHO malaria/HIV terminology, and ISBT blood component terminology.
export let medicalProductAcronyms: readonly ProductAcronym[] = [
  { name: 'Paracetamol', aliases: ['PCM', 'APAP', 'Acetaminophen', 'Panadol'], category: 'medicine' },
  { name: 'Amoxicillin', aliases: ['Amox', 'Amoxil', 'Amoxycillin'], category: 'medicine' },
  { name: 'Artemether Lumefantrine', aliases: ['AL', 'Coartem'], category: 'medicine' },
  { name: 'Artemisinin-based combination therapy', aliases: ['ACT'], category: 'medicine', contextual: true, note: 'OrderCheck already uses ACT as local shorthand for AL/Coartem. ACT is a drug class generally; other named ACT combinations are not AL.' },
  { name: 'Artesunate', aliases: ['AS'], category: 'medicine', contextual: true, note: 'AS alone is ambiguous; require explicit artesunate or malaria product context.' },
  { name: 'Artesunate/Amodiaquine', aliases: ['ASAQ', 'AS-AQ'], category: 'medicine' },
  { name: 'Dihydroartemisinin/Piperaquine', aliases: ['DHA-PPQ', 'DHA/PPQ'], category: 'medicine' },
  { name: 'Dihydroartemisinin', aliases: ['DHA'], category: 'medicine' },
  { name: 'Piperaquine', aliases: ['PPQ'], category: 'medicine' },
  { name: 'Amodiaquine', aliases: ['AQ'], category: 'medicine' },
  { name: 'Sulphadoxine/Pyrimethamine', aliases: ['SP', 'Sulfadoxine/Pyrimethamine'], category: 'medicine' },
  { name: 'Oxytocin', aliases: ['Oxy', 'Syntocinon'], category: 'medicine' },
  { name: 'Iron Folic Acid', aliases: ['IFA'], category: 'medicine', note: 'Do not equate an iron-only or folic-acid-only product with the combination, or infer the iron salt.' },
  { name: 'Oral Rehydration Salts', aliases: ['ORS', 'ORT'], category: 'medicine', note: 'ORT denotes oral rehydration therapy generally; in OrderCheck product orders it is existing local shorthand for ORS.' },
  { name: 'Ciprofloxacin', aliases: ['Cipro'], category: 'medicine' },
  { name: 'Metronidazole', aliases: ['Metro', 'Flagyl'], category: 'medicine' },
  { name: 'Co-trimoxazole', aliases: ['Cotrimoxazole', 'Septrin', 'TMP-SMX', 'TMP/SMX'], category: 'medicine', note: 'Trimethoprim/sulfamethoxazole combination; preserve ingredient and strength order.' },
  { name: 'CTX', aliases: ['CTX'], category: 'medicine', contextual: true, note: 'Can mean co-trimoxazole or cefotaxime. Preserve CTX and warn unless the input explicitly resolves it.' },
  { name: 'DT', aliases: ['DT'], category: 'medicine', contextual: true, note: 'Can describe dispersible tablets or a vaccine. Zinc DT is dispersible zinc, not a vaccine.' },
  { name: 'Normal Saline', aliases: ['NS'], category: 'medicine', note: '0.9% sodium chloride; preserve explicitly stated concentration and distinguish half-normal saline.' },
  { name: 'Ringers Lactate', aliases: ['RL', 'LR', 'Lactated Ringers', 'Hartmanns'], category: 'medicine' },
  { name: 'Dextrose 5%', aliases: ['D5'], category: 'medicine' },
  { name: 'Dextrose 10%', aliases: ['D10'], category: 'medicine' },
  { name: 'Dextrose 50%', aliases: ['D50'], category: 'medicine' },
  { name: 'Dextrose 5% in Water', aliases: ['D5W'], category: 'medicine' },
  { name: 'Dextrose Normal Saline', aliases: ['DNS'], category: 'medicine', note: 'Do not invent glucose or sodium chloride concentrations when not stated.' },
  { name: 'Abacavir', aliases: ['ABC'], category: 'medicine' },
  { name: 'Lamivudine', aliases: ['3TC'], category: 'medicine' },
  { name: 'Dolutegravir', aliases: ['DTG'], category: 'medicine' },
  { name: 'Tenofovir Disoproxil Fumarate', aliases: ['TDF'], category: 'medicine' },
  { name: 'Tenofovir Alafenamide', aliases: ['TAF'], category: 'medicine' },
  { name: 'Emtricitabine', aliases: ['FTC'], category: 'medicine' },
  { name: 'Efavirenz', aliases: ['EFV'], category: 'medicine' },
  { name: 'Nevirapine', aliases: ['NVP'], category: 'medicine' },
  { name: 'Zidovudine', aliases: ['AZT', 'ZDV'], category: 'medicine' },
  { name: 'Tenofovir Disoproxil Fumarate/Lamivudine/Dolutegravir', aliases: ['TLD'], category: 'medicine', note: 'Ingredient order is TDF/3TC/DTG; do not invent or reorder strengths.' },
  { name: 'Depot Medroxyprogesterone Acetate', aliases: ['DMPA'], category: 'medicine', note: 'Preserve SC versus IM formulation, strength, and route; do not assume they are interchangeable.' },
  { name: 'Malaria RDT', aliases: ['mRDT'], category: 'diagnostic' },
  { name: 'Rapid Diagnostic Test', aliases: ['RDT'], category: 'diagnostic', contextual: true, note: 'Existing bare RDT product shorthand in OrderCheck means malaria RDT; a specified HIV or other RDT remains a different test.' },
  { name: 'Whole Blood', aliases: ['WB'], category: 'blood' },
  { name: 'Packed Red Blood Cells', aliases: ['PRBC', 'PRBCs', 'pRBC', 'Packed Cells', 'Packed Red Cells'], category: 'blood' },
  { name: 'Red Blood Cells', aliases: ['RBC', 'RBCs'], category: 'blood', note: 'Identify a transfusion component versus a laboratory RBC count. Keep supplied component specifications.' },
  { name: 'Fresh Frozen Plasma', aliases: ['FFP'], category: 'blood' },
  { name: 'Platelets', aliases: ['PLT', 'PLTs', 'Platelet Concentrate'], category: 'blood' },
  { name: 'Single Donor Platelets', aliases: ['SDP'], category: 'blood' },
  { name: 'Random Donor Platelets', aliases: ['RDP'], category: 'blood' },
  { name: 'Platelet Rich Plasma', aliases: ['PRP'], category: 'blood' },
  { name: 'Cryoprecipitate', aliases: ['CRYO', 'Cryo'], category: 'blood' },
  { name: 'PC', aliases: ['PC'], category: 'blood', contextual: true, note: 'May mean platelet concentrate or packed cells. Blood group alone does not resolve it; keep PC and warn unless explicit component context resolves it.' }
];

export const medicalProductAcronymReference = `MEDICAL AND BLOOD PRODUCT ACRONYM REFERENCE
This is a maintained vocabulary of known catalogue and common clinical product abbreviations, not an exhaustive list of every local acronym. These identity rules take precedence over broad synonym shortcuts.
${medicalProductAcronyms.map(entry => `- ${entry.aliases.join(' / ')} => ${entry.name}${entry.contextual ? ' [CONTEXT REQUIRED]' : ''}.${entry.note ? ` ${entry.note}` : ''}`).join('\n')}
Match whole product tokens, not substrings or unrelated prose. Expand only a supported identity with strong evidence. Never create a product acronym or guess an unfamiliar or ambiguous abbreviation; retain the source name and add a semantic warning. ART, ARV, antibiotic, analgesic and other class names are not a specific product.
Preserve strengths, concentration, ingredient order, formulation, route, package size, release type, requested/supplied quantity and any paediatric/adult qualifier. Do not assume the common strength or a substitute. Never equate vaccines with medicines or a vaccine with its diluent/dropper; existing vaccine identities and pairing rules are authoritative.
Blood components are different products: WB, PRBC/RBC, FFP, PLT, SDP, RDP, PRP and CRYO are not interchangeable. Preserve ABO (O, A, B, AB), Rh positive/negative, irradiation, leukoreduction, washed/CMV-negative/paediatric qualifiers and all component specifications. O+ = O positive = O Pos, O- = O negative = O Neg, and similarly for A/B/AB, only for the same component and specifications. Never infer a missing blood group/Rh or waive a mismatch based on donor compatibility.
Product knowledge never authorizes allocation, clinical substitution, quantity conversion, or a stock/order-limit exemption. Use the exact original product name as name and a supported expansion as normalizedName. All final validation stays deterministic.`;

const wordKey = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/−/g, '-').replace(/(?<=[a-z])-(?=[a-z])/g, ' ').replace(/\s+/g, ' ').trim();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let aliasPattern: RegExp;
let aliasNames: Map<string, string>;
let bloodNames: string[];
export function setMedicalProductAcronyms(terms: ProductAcronym[]) {
  medicalProductAcronyms = terms;
  rebuildAcronyms();
}
function rebuildAcronyms() {
  const aliases = medicalProductAcronyms.filter(entry => !entry.contextual)
    .flatMap(entry => [...entry.aliases, entry.name].map(alias => ({ alias: wordKey(alias), name: wordKey(entry.name) })))
    .sort((a, b) => b.alias.length - a.alias.length);
  aliasPattern = new RegExp(`(^|[^a-z0-9])(${[...new Set(aliases.map(entry => entry.alias))].map(escapeRegExp).join('|')})(?=$|[^a-z0-9])`, 'g');
  aliasNames = new Map(aliases.map(entry => [entry.alias, entry.name]));
  bloodNames = medicalProductAcronyms.filter(entry => entry.category === 'blood').map(entry => wordKey(entry.name));

}
rebuildAcronyms();

export function expandGeneralProductAcronyms(name: string): string {
  const expanded = wordKey(name).replace(aliasPattern, (_match, before: string, alias: string) => before + aliasNames.get(alias));
  if (!isGeneralBloodProduct(expanded)) return expanded;
  // Convert the sign to a word before generic punctuation normalization can
  // erase a clinically significant O+ versus O- distinction.
  return expanded.replace(/\b(ab|a|b|o)\s*(?:rh\s*)?(positive|negative|pos\b|neg\b|[+−-])(?=$|[^a-z0-9])/g,
    (_match, group: string, rh: string) => `${group} ${/^(?:positive|pos|\+)$/.test(rh) ? 'positive' : 'negative'} `).trim();
}

export function isGeneralBloodProduct(name: string): boolean {
  const normalized = wordKey(name);
  return bloodNames.some(component => new RegExp(`(?:^|\\b)${escapeRegExp(component)}(?:$|\\b)`).test(normalized));
}
