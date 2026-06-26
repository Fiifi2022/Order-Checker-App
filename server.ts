/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.text({ type: '*/*' }));
app.use(express.urlencoded({ extended: true }));

// Enable lightweight, zero-dependency CORS so the extension popup/content scripts can seamlessly query the APIs
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Local in-memory store for audits
const audits: any[] = [];

// Local in-memory store for simulated out of stock (OSU) units
let osuItems: string[] = [
  'ROTA Droppers',
  'Mosquirix Vaccine',
  'Yellow Fever Diluents',
  'BCG Vaccine'
];

async function getAudits(): Promise<any[]> {
  return audits;
}

// Lazy-initialized Gemini client accessor
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing. Please add it via Secrets configuration.');
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// System instructions for comparing WhatsApp order text with Fulfilment System confirmations
const SYSTEM_INSTRUCTIONS = `
You are an expert AI medical logisticians auditor for Zipline Ghana's Customer Care team, but you also act as an intelligent, universal text comparison and cross-examination tool.
Your task is to compare two texts:
1. "WhatsApp Message (Customer)"
2. "Fulfilment Confirmation (System)"

You MUST systematically analyze both messages and compare:
- Items, dosages, forms, or any items, concepts, numbers, and parameters mentioned.
- Customer/Facility names, location, dates (if present).
- Contact phone numbers, address info (if present).

==================================================
UNIVERSAL TEXT CROSS-COMPARE & STABILITY RULE (CRITICAL FOR GENERAL MESSAGES):
==================================================
The user may paste ANY kind of messages or text logs (including general chat, emails, notes, instructions, non-medical logistics logs, or "hello worlds") into both sectors. 
1. If the inputs are NOT medical/clinical orders/confirmations, do NOT fail! Instead, transition into UNIVERSAL CROSS-COMPARE MODE:
   - Identify any distinct items, physical assets, tasks, messages, numbers, parameters, or general claims/assertions mentioned on both sides.
   - Put these compared assertions/items/lines inside the "items" array in your JSON output.
   - For non-medical compare items, set "category" strictly to 'Consumable' as a fallback to satisfy the schema validation.
   - Identify quantities, status, or differences between what was requested/asserted in the first message (WhatsApp) and what was fulfilled/registered in the second message (System Confirmation).
   - If an item or claim in WhatsApp is matched perfectly in Fulfillment Confirmation, set status to 'match'. If they differ, set status to 'quantity mismatch' or 'missing item' or 'extra item' accordingly, and write a clear, actionable directive in the 'action' field (e.g. "Align system details with requested message text").
2. COMPULSORY VS NON-COMPULSORY METADATA AUDITING RULES:
   You MUST extract and audit these metadata fields in the following format:
   - "date": E.g. "Date: 15-06-2026" or similar. Extract from the inputs if written. If missing, set to "N/A".
   - "ordererName": Under "Name of Orderer". Extract orderer name from both inputs. Keep in sync with "customerName" for legacy compliance.
   - "facilityName": Under "Name of Health Facility". Extract health center/facility name from both inputs. Keep in sync with "facility" for legacy compliance.
   - "dropArea": Under "Delivery / Drop area". (NOT COMPULSORY. If missing, set both whatsappValue and fulfillmentValue to "N/A" and status to "match". Never log an error/mismatch for this being absent).
   - "district": Under "District". (NOT COMPULSORY. If missing, set both whatsappValue and fulfillmentValue to "N/A" and status to "match". Never log an error/mismatch for this being absent).
   - "deliveryTime": Under "Preferred time for Delivery". (NOT COMPULSORY. If missing, set both whatsappValue and fulfillmentValue to "N/A" and status to "match". Never log an error/mismatch for this being absent).

   - For legacy values:
     - "customerName": identical value as "ordererName".
     - "facility": identical value as "facilityName".
     - "phone": standard contact phone number (or "N/A" if missing; missing contact phone is NOT compulsory and shouldn't trigger mismatch errors).

   - If any optional/non-compulsory field (dropArea, district, deliveryTime) is missing or not provided:
     - You MUST boycott/omit raising error/mismatches for them. Set their value fields to "N/A" and status strictly to "match".
     - Do NOT let missing optional fields lower confidence score or set allMatch to false. Keep allMatch true and issueCount at 0 if everything else is clean!

==================================================
CRITICAL DOMAIN RULES & ABBREVIATION CATEGORIES (WHEN MEDICAL/CLINICAL):
==================================================
1. VACCINES (Ailment immunizations, preventives):
   - "BCG" = Bacillus Calmette–Guérin (Tuberculosis vaccine).
   - "OPV" = "bOPV" = "IPV" (Polio Vaccines).
   - "PCV" = "PCV13" (Pneumococcal Conjugate Vaccine).
   - "MR" = Measles-Rubella vaccine.
   - "YF" = "YFV" (Yellow Fever vaccine).
   - "Penta" = "Pentavalent" (Diphtheria-Pertussis-Tetanus-HepB-Hib vaccine).
   - "Td" = "TT" (Tetanus Toxoid / Tetanus-diphtheria).
   - "ROTA" = Rotavirus vaccine.
   - "HPV" = Human Papillomavirus vaccine.
   - "Men" = "MenAfriVac" (Meningitis vaccine).
   - "Moderna" = "Pfizer" = "Janssen" = "Covishield" (COVID-19 vaccination products).
   - "RTS,S" = "Mosquirix" (Malaria Vaccine).

2. MEDICAL PRODUCTS / DRUGS (Active pharmaceuticals, therapeutic molecules, formulations, IV liquids):
   - Anti-malarials: "ACT" = "AL" = "Coartem" = "Artemether Lumefantrine" (or "Artemether + Lumefantrine" e.g., "ACT 20/120mg").
   - Analgesics: "PCM" = "APAP" = "Paracetamol" = "Panadol" (tablets, oral suspension, or IV Paracetamol infusion).
   - Antibiotics: "Amox" = "Amoxicillin" = "Amoxil" (capsules or dry syrup pediatric suspension).
   - Postpartum Hemorrhage: "Oxy" = "Oxytocin" = "Syntocinon" (typically 10 IU/ml injections).
   - Severe Malaria: "AS" = "Artesunate" = "Inj Artesunate" (60mg or 120mg vials).
   - Prenatal cares: "IFA" = "Iron Folic Acid" = "Feso4 + Folic" (Ferrous Sulfate + Folic Acid tablets).
   - Oral Rehydration: "ORS" = "ORT" (Oral Rehydration Salts/Therapy).
   - Pediatric Diarrhea: "Zinc DT" = "Zinc dispersible" = "Zinc tablets" (usually 20mg, co-prescribed with ORS).
   - IV Fluids / Infusions:
     * "NS" = "Normal Saline" (0.9% Sodium Chloride infusion).
     * "D5" = "Dextrose 5%" (5% Dextrose liquid infusion).
     * "RL" = "Ringers Lactate" = "Hartmanns" (Ringer's Lactate / Hartmann's solution).
     * "DNS" = "Dextrose Normal Saline".

3. BLOOD PRODUCTS (Blood components, typed using ABO and Rh systems):
   - Components: 
     * "WB" = "Whole Blood".
     * "PRBC" = "Packed Cells" = "Packed Red Blood Cells".
     * "FFP" = "Fresh Frozen Plasma".
     * "PLT" = "PC" = "Platelets" = "Platelet Concentration".
   - Blood Types/Rh pairings: O+, O-, A+, A-, B+, B-, AB+, AB-.
   - Exact Synonym Matches: "O positive" = "O+" = "O Pos", "A negative" = "A-" = "A Neg", etc. Make sure to identify both component type and blood type when assessing matches.

4. CONSUMABLES (Surgical raw materials, diagnostic test strip kits, disposal units, or instruments utilized during care):
   - "Syringes": Injection equipment (e.g., "2ml injection syringe", "5ml Syringe", "10ml AD Syringe").
   - "Cannulas": Intravenous catheters (e.g., "G22 Cannula", "G24 Cannula / Gauze 24", "IV Cannula size 20").
   - "Gloves": Surgical and examination gloves (e.g., "Surgical Gloves size 7.5", "Exam gloves").
   - "mRDT" = "RDT" = "Malaria RDT" (Malaria Rapid Diagnostic Test kits).
   - "Giving Set" = "IV Giving Set" = "Blood Giving Set" (Fluid/blood transfusion sets).
   - "Cotton" = "Cotton Wool" (absorbent padding roll).
   - "Gauze" = "Gauze Bandage" (dressing roll or pieces).

==================================================
ADDITIONAL AUDIT CONSTRAINTS:
==================================================
5. PHONE NUMBER LOGIC:
   - Treat phone numbers starting with "0" and international format "+233" (or "233") as 100% Identical if their base 9 digits match.
     For example, "0244123456" matches "+233244123456", "0559123456" matches "233559123456".
   - Do NOT count normal country code formatting differences as mismatch. Standardize value displays for agent transparency.

6. FACILITY NAME / VARIATIONS LOGIC:
   - Ignore common redundant suffixes like "Clinic", "Hospital", "CHPS", "Health Center", "CHPS Compound", "RCH" when comparing to find a match, BUT note the difference in "insights".
     For example: "Kade Health Center" and "Kade CHPS" or just "Kade" is generally a match.
   - If the name represents an entirely different town/location, flag a mismatch.

7. INVENTORY QUANTITY QUANTIFICATION:
   - Identify mismatch types clearly:
     - "match": The item and quantity specified match perfectly (accounting for synonyms).
     - "quantity mismatch": The item is present in both, but requested quantity differs from fulfillment quantity.
     - "missing item": The customer requested it on WhatsApp, but it is missing from the fulfillment confirmation.
     - "extra item": The item is in the fulfillment confirmation, but was NOT requested by the customer on WhatsApp.
   - Provide a specific, concise human action for any non-match status. Action examples:
     - For missing item: "Add [Item Name] to order" or "Add 5 boxes of RDT Kits".
     - For quantity mismatch: "Correct fulfillment quantity to [Requested Qty]".
     - For extra item: "Remove [Item Name] from fulfillment".

8. CONFIDENCE SCORE:
   - Provide a confidence score from 0 to 100 on the overall accuracy of the order verification.
   - 100% means perfect item verification, name, phone, and facility matching. Deduct points for each mismatch.

9. INSIGHTS:
   - Produce 2 to 4 bullet points explaining what you did in human terms.
   - e.g., "Matched 'ACT' in WhatsApp to 'Coartem' in System."
   - e.g., "Normalized phone number '024...' and '+233...' as a match."
   - e.g., "Spotted facility suffix difference: 'Kade CHPS' vs 'Kade Health Center'."

10. VACCINES WITH DILUENTS & DROPPERS (CRITICAL CLINICAL AUDIT RULES):
   - Some vaccines MUST always be paired with their secondary components (diluents or droppers):
     e.g., "Measles" or "MR" (Measles-Rubella) and "Yellow Fever" / "YFV" / "YF" require "diluents" (diluent vials).
     e.g., "OPV" / "bOPV" (Polio vaccine) and "ROTA" / "rotavirus" require "droppers".
   - You MUST audit and flag any discrepancies regarding these pairing components:
     a. "Presence Discrepancy" (One side has it and the other does not): If one side of the messages (WhatsApp or Fulfillment Confirmation) lists diluents/droppers for the requested vaccine, but the other side does not list or list 0 of them, you MUST flag it as a mismatch/issue (status: 'missing item' or 'extra item').
     b. "Number Mismatch": The quantity/count of diluents or droppers MUST match perfectly with the quantity of the corresponding vaccine itself (e.g. 10 doses of MR vaccine must have exactly 10 vials of diluent, and 15 vials of OPV must have exactly 15 droppers). If there is any quantity discrepancy between the vaccine doses and its diluent / dropper count, OR if the requested and fulfillment count of diluents/droppers do not match, you MUST flag this as a 'quantity mismatch'.
     c. Always list these diluents/droppers as individual line items inside the "items" array in your JSON output.

11. OUT OF STOCK (OSU) DETECTION & HANDLING (CRITICAL COMPLIANCE RULES):
   - ONLY RECORD OUT OF STOCK ON EXPLICIT ZERO-LOAD (0/X): You MUST strictly limit 'out of stock' classifications to instances where you explicitly see a zero load in the fulfillment confirmation, represented in formats like "(0/any number)" (e.g., "0/1", "0/10", "0 of 5", "0 loaded", "0 units", "OPV: 0"), or when the requested product name is explicitly listed in the "ACTIVE OUT-OF-STOCK (OSU) ITEMS" list.
   - WHATSAPP EXCEEDS FULFILLMENT -> ORDER LIMIT / QUANTITY MISMATCH (CRITICAL): If the quantity requested in the WhatsApp section is MORE than the quantity shown in the fulfillment confirmation (e.g., requested 10, found 3, or shown as "3/10"), but the found quantity is greater than 0, you MUST NOT record this as 'out of stock'. Instead, you MUST treat this strictly as a 'quantity mismatch' (which triggers the Order Limit verification flow). Set the status strictly to 'quantity mismatch' and set the action to something like: "Order limit triggered. Correct fulfillment quantity to [Requested Qty] or confirm order limit."
   - ZERO-MISTAKE CLEARANCE EXEMPTION: If the ONLY anomalies/non-match items found in the entire verification process are 'out of stock' items, and there are absolutely NO OTHER mistakes (meaning all other items have perfect status: 'match', and there is no phone number, names, or facility name mismatch), you MUST consider the order cleared!
     In this zero-mistake out-of-stock case, you MUST set output variable 'allMatch' to true, and output variable 'issueCount' to 0 (or count only actual mistakes in issueCount, excluding out-of-stock items so they do not block dispatch). This grants compliance clearance for takeoff/launch since no packaging errors exist, but still preserves the out-of-stock visual alert to notify the clinical facility. Set 'verdict' to something like: 'Cleared for dispatch: No packing mistakes, but some items are out of stock.'
   - If there is any actual packing mistake (like quantity mismatch, missing item, extra item, or facility name/phone mismatch) in addition to out of stock items, then set 'allMatch' to false and include them in the issueCount.

12. PRODUCT INTERNAL QUANTITY EQUIVALENCY RULE (CRITICAL FOR DISCREPANCY MINIMIZATION):
   - The fulfillment system might register quantities of certain products in terms of individual tablets, capsules, vials, syringes, or items (representing their "internal quantity" within a pack/box/bottle), whereas WhatsApp requests describe bulk packs/boxes/containers, or vice-versa.
   - You MUST consult the official Product Internal Quantities Catalog below to check the equivalency factor (internal_quantity) for each product name.
   - If the requested quantity (Q_r) in WhatsApp and the found quantity (Q_f) in the fulfillment system differ:
     * Check if either: (Q_f = Q_r * internal_quantity) OR (Q_r = Q_f * internal_quantity).
     * If either of these mathematical equations holds true (with minor text allowances, e.g., "1 box" matches "100 tablets" for a product with an internal quantity of 100, "2 cards" matches "20 tablets" for an internal quantity of 10, "500 capsules" matches "1 pack" for an internal quantity of 500, or "24 tablets" matches "1 pack" for an internal quantity of 24):
       + You MUST treat this as a PERFECT MATCH!
       + Set the item's status strictly to "match".
       + Do NOT flag it as "quantity mismatch" or any other discrepancy.
       + Do NOT increment "issueCount" or lower the confidence score.
       + In the returned "items" entry, specify the original descriptions from both messages (e.g., requested: "1 box", found: "100 tablets") so the user understands the conversion, but mark the status strictly as "match".
   
   Official Product Internal Quantities Catalog (Any product not listed here has a default internal_quantity of 1):
   * "Abacavir/Lamivudine 120mg/60mg Tablet": 60
   * "(Tantala CHPS) Albendazole Tablet, 400mg": 20
   * "(Jadema HC) Albendazole Tablet, 400mg": 20
   * "Aluminium Hydroxide 500mg Tablet": 100
   * "Amlodipine 5mg Tablet": 100
   * "Amlodipine 10mg Tablet": 100
   * "Amodiaquine/Artesunate 50mg/135mg Tablet": 30
   * "Amodiaquine + Artesunate Tablet, 50mg +135 mg (1 - 5 yrs)": 75
   * "Amodiaquine/Artesunate 100mg/270mg Tablet": 60
   * "Amodiaquine + Artesunate Tablet 25mg + 67.5mg < 1yr [30] *": 3
   * "Amodiaquine/Artesunate 25mg/67.5mg Tablet": 30
   * "Amoxicillin Capsule, 250 mg [100]*": 10
   * "Amoxicillin Capsule, 250 mg": 500
   * "(Katigri CHPS) Amoxicillin Capsule, 250 mg": 500
   * "(Nangrumah CHPS) Amoxicillin Capsule, 250 mg [10]": 500
   * "(Soo CHPS) Amoxicillin Capsule, 250 mg": 500
   * "Amoxicillin 500mg Capsule": 10
   * "Amoxicillin 250mg Capsule": 100
   * "(Gbintiri HC) Amoxicillin Capsule, 250 mg [10]": 10
   * "(Sakogu HC) Amoxicillin Capsule, 250 mg [10]": 10
   * "(Jadema HC) Amoxicillin Capsule, 250 mg [10]": 500
   * "(Yagba HC) Amoxicillin Capsule, 250 mg [10]": 500
   * "Artemether 40mg/mL Injection": 6
   * "Artemether 80mg/mL Injection": 5
   * "Artesunate 500mg Suppository": 6
   * "Artesunate 100mg Suppository": 2
   * "Artemether + Lumefantrine Tablet, 20 mg + 120 mg [24*10]*": 24
   * "Artemether/Lumefantrine 20mg/120mg Tablet, 24's": 240
   * "Artemether/Lumefantrine 20mg/120mg Dispersible Tablet, 18's": 180
   * "Artemether/Lumefantrine 20mg/120mg Dispersible Tablet, 6's": 60
   * "(Soo CHPS) Artemether + Lumefantrine Tablet, 20 mg + 120 mg (Dispersible) 3-8yrs": 360
   * "Artemether + Lumefantrine Tablet, 20 mg + 120 mg (Dispersible) [6] <3yrs": 6
   * "Artemether + Lumefantrine Tablet, 20 mg + 120 mg (Dispersible) [12*10] 3-8yrs*": 12
   * "(Gbintiri HC) Artemether + Lumefantrine Tablet, 20 mg + 120 mg [24]": 24
   * "(Gbintiri HC) Artemether + Lumefantrine Tablet, 20 mg + 120 mg (Dispersible) [6]": 6
   * "(Sakogu HC) Artemether + Lumefantrine Tablet, 20 mg + 120 mg [24]": 24
   * "(Jadema HC) Artemether + Lumefantrine Tablet, 20 mg + 120 mg (Dispersible) [12] 3-8yrs": 360
   * "Artemether + Lumefantrine Tablet, 20 mg + 120 mg (Dispersible) [18] 3-8yrs": 18
   * "Artemether/Lumefantrine 20mg/120mg Dispersible Tablet, 12's": 120
   * "Artesunate Suppository, 100mg": 2
   * "Atropine 0.6mg/mL Injection": 5
   * "Cefuroxime 500mg Tablet": 10
   * "Chlorpromazine 25mg/mL Injection, 2mL": 10
   * "Chlorpheniramine 4mg Tablet": 10
   * "Chlorpheniramine Tablet, 4mg [100]": 100
   * "Ciprofloxacin 500mg Tablet": 100
   * "Ciprofloxacin Tablet, 500mg [10]": 10
   * "(Gbintiri HC) Ciprofloxacin Tablet, 500mg": 10
   * "(Sakogu HC) Ciprofloxacin Tablet, 500mg [100]": 100
   * "Clindamycin Injection, 300mg/ml in 2ml [10]": 10
   * "Clotrimazole 100mg Pessary": 6
   * "Amoxicillin/Clavulanic acid 500mg/125mg Tablet": 14
   * "Amoxicillin/Clavulanic acid 875mg/125mg Tablet": 10
   * "(Gbintiri HC) Amoxycillin + Clavulanic Acid Tablet, 500mg + 125mg [14]": 14
   * "(Sakogu HC) Amoxycillin + Clavulanic Acid Tablet, 500mg + 125mg [14]": 14
   * "(Janga HSP) Amoxycillin + Clavulanic Acid Tablet, 500mg + 125mg [14]": 14
   * "Umbilical Cord Clamp": 5
   * "Sulphamethoxazole/Trimethoprim 400mg/80mg Tablet": 100
   * "Covid - 19 Hologram Strip [100]": 100
   * "Dihydroartemisinin/Piperaquine 20mg/160mg Tablet": 3
   * "Dihydroartemisinin/Piperaquine 40mg/320mg Tablet": 3
   * "Dihydroartemisinin/Piperaquine 60mg/480mg Tablet": 3
   * "Dihydroartemisinin/Piperaquine 80mg/640mg Tablet": 3
   * "(Gbintiri HC) Diazepam Injection, 5 mg/mL in 2ml [10]": 10
   * "(Katigri CHPS) Diazepam Injection, 5 mg/mL in 2ml [10]": 10
   * "(Nangrumah CHPS) Diazepam Injection, 5 mg/mL in 2ml [10]": 10
   * "(Sakogu HC) Diazepam Injection, 5 mg/mL in 2ml [10]": 10
   * "Diazepam 10mg/mL Injection, 1mL": 10
   * "Diazepam 5mg Tablet": 50
   * "Diazepam 10mg Tablet": 50
   * "Diclofenac 75mg Capsule": 20
   * "(Tantala CHPS) Diclofenac Gel, 30mg": 12
   * "(Tantala CHPS) Diclofenac Injection, 25mg/ml In 3ml[5]": 5
   * "(Nangrumah CHPS) Diclofenac Injection, 25mg/ml In 3ml[5]": 5
   * "Diclofenac Injection, 25mg/ml In 3ml [5]": 5
   * "(Gbintiri HC) Diclofenac Injection, 25mg/ml In 3ml[5]": 5
   * "(Sakogu HC) Diclofenac Injection, 25mg/ml In 3ml[5]": 5
   * "(Jadema HC) Diclofenac Injection, 25mg/ml In 3ml[5]": 5
   * "Diclofenac 50mg Suppository": 100
   * "Diclofenac 100mg Suppository": 10
   * "Diclofenac Suppository, 50mg [10]": 10
   * "(Janga HSP) Diclofenac Suppository, 100mg [10]": 10
   * "Diclofenac 100mg Tablet": 50
   * "(Tantala CHPS) Diclofenac Tablet, 50mg": 500
   * "Diclofenac 50mg Tablet": 100
   * "(Gbintiri HC) Diclofenac Tablet, 50mg [10]": 10
   * "(Sakogu HC) Diclofenac Tablet, 50mg [10]": 10
   * "(Jadema HC) Diclofenac Tablet, 50mg [10]": 10
   * "(Yagba HC) Diclofenac Tablet, 50mg": 500
   * "Dolutegravir/Lamivudine/Tenofovir 50mg/300mg/300mg Tablet": 30
   * "Dolutegravir 50mg Tablet": 30
   * "Erythromycin 250mg Tablet": 100
   * "(Jadema HC) Erythromycin Tablet, 250mg": 500
   * "Ferrous Sulphate 200mg Tablet": 10
   * "(Tantala CHPS) Ferrous Fumarate Tablet, 200 mg (Elemental Iron)": 1000
   * "Ferrous Fumarate 200mg Tablet": 500
   * "Ferrous Sulphate Tablet, 200 mg (Elemental Iron) [500]": 500
   * "(Jadema HC) Ferrous Fumarate Tablet, 200 mg (Elemental Iron)": 1000
   * "(Yagba HC) Ferrous Fumarate Tablet, 200 mg (Elemental Iron)": 1000
   * "Ferrous Sulphate Tablet, 60 mg (Elemental Iron)": 1000
   * "Fluconazole 150mg Capsule": 10
   * "Fluoxetine Capsule 20mg": 100
   * "Fluphenazine 25mg/mL Injection": 10
   * "Folic acid 5mg Tablet": 10
   * "(Tantala CHPS) Folic Acid Tablet 5mg [10]": 1000
   * "(Nangrumah CHPS) Folic Acid Tablet 5mg [10]": 1000
   * "Folic Acid Tablet 5mg [100]": 100
   * "Folic Acid Tablet 5mg [500]": 500
   * "(Gbintiri HC) Folic Acid Tablet 5mg [10]": 10
   * "(Sakogu HC) Folic Acid Tablet 5mg [10]": 10
   * "(Jadema HC) Folic Acid Tablet 5mg [10]": 1000
   * "(Yagba HC) Folic Acid Tablet 5mg [10]": 1000
   * "Furosemide 40mg Tablet": 10
   * "(Janga HSP) Furosemide Tablet, 40mg [10]": 10
   * "Surgical Gloves Size 7.5\"[10]": 10
   * "Surgical Gloves Size 7\"[10]": 10
   * "Surgical Gloves Size 8\"[10]": 10
   * "Examination Gloves M/S [100]": 100
   * "Hydroxycarbamide 500mg Capsule": 100
   * "(Gbintiri HC) Hyoscine Butylbromide Tablet, 10mg": 10
   * "Hyoscine Butylbromide 10mg Tablet": 10
   * "Hyoscine Butylbromide Tablet, 10mg [100]": 100
   * "(Gbintiri HC) Hyoscine Butylbromide Tablet, 10mg [10]": 10
   * "(Sakogu HC) Hyoscine Butylbromide Tablet, 10mg [10]": 10
   * "(Janga HSP) Hyoscine Butylbromide Tablet, 10mg [10]": 10
   * "Ibuprofen 200mg Tablet": 100
   * "Ibuprofen 400mg Tablet": 100
   * "Iron (III) Hydroxide Polymaltose Complex Capsule": 30
   * "Levonogestrel/Ethinylestradiol 150mcg/30mcg Tablet": 84
   * "Levonorgestrel/Ethinylestrastradiol 0.15mg/0.03mg Tablet": 84
   * "Lisinopril 10mg Tablet": 500
   * "Medroxyprogesterone Acetate 104mg/0.65mL Injection": 10
   * "Metformin 500mg Tablet": 100
   * "Methyldopa 250mg Tablet": 100
   * "Metronidazole 200mg Tablet": 10
   * "(Janga HSP) Metronidazole Tablet, 200mg [10]": 10
   * "(Yagba HC) Metronidazole Tablet, 200mg": 500
   * "(Yagba HC) Metronidazole Tablet, 400mg": 500
   * "(Tantala CHPS) Metronidazole Tablet, 200mg": 500
   * "(Tantala CHPS) Metronidazole Tablet, 400mg": 500
   * "(Katigri CHPS) Metronidazole Tablet, 200mg": 500
   * "(Katigri CHPS) Metronidazole Tablet, 400mg": 500
   * "(Nangrumah CHPS) Metronidazole Tablet, 200mg [10]": 500
   * "Metronidazole 400mg Tablet": 10
   * "Metronidazole Tablet, 200mg [100]": 100
   * "Metronidazole Tablet, 400mg [100]": 100
   * "(Gbintiri HC) Metronidazole Tablet, 200mg [10]": 10
   * "(Sakogu HC) Metronidazole Tablet, 200mg [10]": 10
   * "(Sakogu HC) Metronidazole Tablet, 400mg [10]": 10
   * "(Jadema HC) Metronidazole Tablet, 200mg [10]": 500
   * "(Jadema HC) Metronidazole Tablet, 400mg": 500
   * "Levonorgestrel 30mcg Tablet": 105
   * "Multivitamin Tablet": 10
   * "(Tantala CHPS) Multivitamin Tablet": 1000
   * "(Katigri CHPS) Multivitamin Tablet": 1000
   * "(Nangrumah CHPS) Multivitamin Tablet [10]": 1000
   * "Multivitamin Tablet[10*10]": 100
   * "(Gbintiri HC) Multivitamin Tablet [10]": 10
   * "(Sakogu HC) Multivitamin Tablet [10]": 10
   * "(Jadema HC) Multivitamin Tablet [10]": 1000
   * "(Yagba HC) Multivitamin Tablet [10]": 1000
   * "Nifedipine 20mg Tablet": 100
   * "(Sakogu HC) Nifedipine Retard Tablet, 20mg": 100
   * "(Yagba HC) Nifedipine Retard Tablet, 20mg": 1000
   * "Olanzapine 5mg Tablet": 200
   * "Oral Rehydration Salt Powder": 25
   * "Oral Rehydration Salt Powder (Flavoured)": 25
   * "(Gbintiri HC) Oral Rehydration Salt Powder": 25
   * "(Sakogu HC) Oral Rehydration Salt Powder": 25
   * "Paracetamol 125mg Suppository": 10
   * "Paracetamol 250mg Suppository": 100
   * "Paracetamol Suppository, 500mg[100]": 100
   * "Paracetamol Suppository, 250mg[10]": 10
   * "Paracetamol 500mg Suppository": 10
   * "Paracetamol 1000mg Suppository": 10
   * "Paracetamol 500 mg Tablet": 100
   * "(Tantala CHPS) Paracetamol Tablet, 500 mg": 1000
   * "(Katigri CHPS) Paracetamol Tablet, 500 mg": 1000
   * "(Nangrumah CHPS) Paracetamol Tablet, 500 mg [10]": 1000
   * "(Soo CHPS) Paracetamol Tablet, 500 mg": 1000
   * "(Gbintiri HC) Paracetamol Tablet, 500 mg [10]": 10
   * "(Sakogu HC) Paracetamol Tablet, 500 mg [10]": 10
   * "(Jadema HC) Paracetamol Tablet, 500 mg [10]": 1000
   * "(Janga HSP) Paracetamol Tablet, 500 mg [10]": 10
   * "(Yagba HC) Paracetamol Tablet, 500 mg [10]": 1000
   * "Promethazine Hydrocloride 1mg/0.5mL Injection": 10
   * "Risperidone 2mg Tablet": 10
   * "Salbutamol 4mg Tablet": 10
   * "Salbutamol Tablet, 4mg [5*10]": 50
   * "Sulphadoxine/Pyrimethamine/Amodiaquine, 250mg/12.5mg/75mg Tablet": 4
   * "Sulphadoxine/Pyrimethamine /Amodiaquine, 500mg/25mg/153mg Tablet": 4
   * "Sulphadoxine/Pyrimethamine 500mg/25mg Tablet": 3
   * "Sulphadoxine+Pyrimethamine Tablet, 525mg (IPT) [30]": 30
   * "Sulphadoxine + Pyrimethamine 500mg+25mg Tablet": 150
   * "Soloshots (Syringes & Needles)1ml [FP]": 5
   * "Syringes & Needles 5ml [5]": 5
   * "Vitamin A 100,000IU Capsule": 100
   * "Vitamin A 200,000IU Capsule": 500
   * "Zinc 10mg Tablet": 100
   * "Zinc 20mg Tablet": 10
  `;

// Helper function to call Gemini model with exponential backoff and multi-model fallbacks on transient errors (like 503 high demand)
async function generateContentWithRetry(ai: any, options: any): Promise<any> {
  const modelSequence = options.model === 'gemini-3.5-flash'
    ? ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest']
    : [options.model];

  let lastError: any = null;

  for (const currentModel of modelSequence) {
    let attempt = 0;
    const maxAttemptsForModel = currentModel === 'gemini-3.5-flash' ? 1 : 2; // Try gemini-3.5-flash once and instantly fallback on error to save latency
    const initialDelay = 150; // Fast initial delay for low latency

    while (attempt < maxAttemptsForModel) {
      attempt++;
      try {
        console.log(`[Gemini Request] Trying model: ${currentModel} (Attempt ${attempt}/${maxAttemptsForModel})`);
        
        // Copy options and override the model for this attempt
        const currentOptions = {
          ...options,
          model: currentModel
        };
        
        return await ai.models.generateContent(currentOptions);
      } catch (error: any) {
        lastError = error;
        
        const errorMessage = String(error?.message || error || '').toLowerCase();
        const statusText = String(error?.status || '').toLowerCase();
        const errorCode = Number(error?.code || error?.status || 0);

        const isTransient = 
          errorCode === 503 ||
          errorCode === 429 ||
          statusText === 'unavailable' ||
          statusText === 'resource_exhausted' ||
          errorMessage.includes('503') ||
          errorMessage.includes('429') ||
          errorMessage.includes('unavailable') ||
          errorMessage.includes('high demand') ||
          errorMessage.includes('temporary') ||
          errorMessage.includes('overloaded') ||
          errorMessage.includes('resource exhausted') ||
          errorMessage.includes('rate limit');

        if (isTransient) {
          if (attempt < maxAttemptsForModel) {
            const delay = initialDelay * Math.pow(2, attempt - 1);
            console.warn(`[Gemini Retry] Model ${currentModel} failed (Attempt ${attempt}/${maxAttemptsForModel}) due to high demand. Retrying in ${delay}ms... Error: ${error.message || error}`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            console.warn(`[Gemini Model Fallback] Model ${currentModel} exhausted all attempts. Trying next fallback model if available...`);
          }
        } else {
          // If it's a structural or validation error (like bad parameters or authentication), throw it immediately
          throw error;
        }
      }
    }
  }

  // If we exhausted all fallback models and all attempts
  if (lastError) {
    const errorMsg = lastError.message || String(lastError);
    const customError = new Error(`The Gemini verification service is currently experiencing extreme demand across all available model pathways (tried gemini-3.5-flash, gemini-3.1-flash-lite, and gemini-flash-latest). Details: ${errorMsg}`);
    (customError as any).status = lastError.status || 'UNAVAILABLE';
    (customError as any).code = lastError.code || 503;
    throw customError;
  }
}

// Health-check endpoint for client/extension pings
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Helper endpoint for Order Verification
app.post('/api/verify', async (req, res) => {
  console.log('[API POST /api/verify] Request received.');
  
  let body = req.body || {};
  
  // If express.text() parsed the body as a raw string, try to parse as JSON fallback
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body.trim());
      if (parsed && typeof parsed === 'object') {
        body = parsed;
      }
    } catch (e) {
      console.warn('[API POST /api/verify] Text body received but is not JSON:', body);
    }
  }

  // Also catch empty object with raw request listeners if any stream chunking occurred
  if (typeof body === 'object' && Object.keys(body).length === 0) {
    try {
      const rawText = await new Promise<string>((resolve) => {
        let buf = '';
        req.on('data', chunk => { buf += chunk; });
        req.on('end', () => resolve(buf));
      });
      if (rawText) {
        const parsed = JSON.parse(rawText.trim());
        if (parsed && typeof parsed === 'object') {
          body = parsed;
        }
      }
    } catch (e) {
      console.warn('[API POST /api/verify] Stream fallback parse failed:', e);
    }
  }

  console.log('[API POST /api/verify] Keys received in body:', typeof body === 'object' ? Object.keys(body) : 'primitive/none');

  // Extract variables with complete backward-compatible fallback maps (Task 7)
  let whatsappMessage = body.whatsappMessage || 
                        body.whatsapp_message || 
                        body.whatsappText || 
                        body.whatsapp_text || 
                        body.whatsapp || 
                        body.wa || 
                        body.whatsappDraft || 
                        body.whatsapp_draft || 
                        body.text1 || 
                        body.input1;

  let fulfillmentConfirmation = body.fulfillmentConfirmation || 
                                body.fulfillment_confirmation || 
                                body.fulfillmentText || 
                                body.fulfillment_text || 
                                body.fulfillmentLog || 
                                body.fulfillment_log || 
                                body.fulfillment || 
                                body.ff || 
                                body.fulfillmentMessage || 
                                body.fulfillment_message || 
                                body.text2 || 
                                body.input2;

  // Trim if string
  if (typeof whatsappMessage === 'string') whatsappMessage = whatsappMessage.trim();
  if (typeof fulfillmentConfirmation === 'string') fulfillmentConfirmation = fulfillmentConfirmation.trim();

  // Defensive validation with log on failure (Task 5, 2 & 6)
  if (!whatsappMessage || !fulfillmentConfirmation) {
    console.error('*** [API POST /api/verify] Validation FAILED! ***');
    console.error('Request received Headers:', req.headers);
    console.error('Request received Body payload:', JSON.stringify(body, null, 2));

    const missingFields = [];
    if (!whatsappMessage) {
      missingFields.push("WhatsApp Message ('whatsappMessage', 'whatsappText', or 'whatsapp')");
    }
    if (!fulfillmentConfirmation) {
      missingFields.push("Fulfillment Confirmation ('fulfillmentConfirmation', 'fulfillmentText', or 'fulfillment')");
    }

    const missingExplanation = missingFields.join(' and ');
    
    return res.status(400).json({
      error: `Validation Error (400): Missing required audit fields. ${missingExplanation}. Please check your request parameters and try again.`,
      missing: missingFields,
      receivedKeys: Object.keys(body)
    });
  }

  // Print successful parsing details
  console.log('[API POST /api/verify] Parsing success! Params matched:', {
    whatsappMessageLen: whatsappMessage.length,
    fulfillmentConfirmationLen: fulfillmentConfirmation.length
  });

  const startTime = Date.now();
  try {
    const ai = getGeminiClient();

    const response = await generateContentWithRetry(ai, {
      model: 'gemini-3.5-flash',
      contents: `Please parse, cross-examine, and verify these two inputs (they could be Zipline Ghana medical logistics orders, or general operational/text logs, custom chat messages, or hello worlds requested vs fulfilled/acted):
          
          === WHATSAPP SOURCE MESSAGE ===
          ${whatsappMessage}
          
          === FULFILMENT RECIPIENT SYSTEM LOG ===
          ${fulfillmentConfirmation}

          === ACTIVE OUT-OF-STOCK (OSU) ITEMS (IF IN MEDICAL CONTEXT) ===
          The following items are currently OUT OF STOCK in the supply warehouse.
          If any item requested in the WhatsApp Message is listed below (or has a matching generic/abbreviation), you MUST set its status to 'out of stock' and write an action advising the operator of the OSU shortage:
          [${osuItems.join(', ')}]
          `,
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS,
        responseMimeType: 'application/json',
        temperature: 0.1,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            confidence: {
              type: Type.INTEGER,
              description: 'Confidence score (0–100) regarding overall correctness & consistency of fulfillment and WhatsApp inputs.'
            },
            verdict: {
              type: Type.STRING,
              description: "Overall summary verdict. e.g. 'All items match — ready for dispatch' or '2 issues found — review before dispatch'."
            },
            allMatch: {
              type: Type.BOOLEAN,
              description: 'Whether it is a perfect match (true) or contains any mismatch/missing/extra/out-of-stock issues (false).'
            },
            issueCount: {
              type: Type.INTEGER,
              description: 'The number of mismatch, missing item, extra item, or out-of-stock issues found.'
            },
            items: {
              type: Type.ARRAY,
              description: 'Direct comparison log of all medical items mentioned across both messages.',
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description: 'Common name of the item. Use Zipline standard naming (or the matched synonym).'
                  },
                  category: {
                    type: Type.STRING,
                    description: "The medical logistics category of this item. Must be exactly one of: 'Vaccine', 'Medical Product', 'Blood Product', 'Consumable'."
                  },
                  requested: {
                    type: Type.STRING,
                    description: "Quantity/packing described in WhatsApp (e.g. '20 packs', '10 cards', 'None')."
                  },
                  found: {
                    type: Type.STRING,
                    description: "Quantity/packing found in system confirmation (e.g. '20 packs', '0 packs', 'None')."
                  },
                  status: {
                    type: Type.STRING,
                    description: "Must be exactly one of: 'match', 'quantity mismatch', 'missing item', 'extra item', 'out of stock'."
                  },
                  action: {
                    type: Type.STRING,
                    description: "Short specific directive/action for the user, e.g. 'Change amount to 10 cards' or 'OSU ALERT: OPV is out of stock'."
                  }
                },
                required: ['name', 'requested', 'found', 'status', 'category']
              }
            },
            meta: {
              type: Type.OBJECT,
              description: 'Validation of metadata categories including compulsory and non-compulsory fields.',
              properties: {
                customerName: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Customer/Contact name on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Customer/Contact name on system confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                phone: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Contact phone on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Contact phone on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                facility: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Facility name on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Facility name on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                date: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Date of order on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Date of order on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                ordererName: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Name of Orderer on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Name of Orderer on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                facilityName: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Name of Health Facility on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Name of Health Facility on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                dropArea: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Delivery/Drop area on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Delivery/Drop area on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                district: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'District on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'District on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                },
                deliveryTime: {
                  type: Type.OBJECT,
                  properties: {
                    whatsappValue: { type: Type.STRING, description: 'Preferred time for Delivery on WhatsApp' },
                    fulfillmentValue: { type: Type.STRING, description: 'Preferred time for Delivery on confirmation' },
                    status: { type: Type.STRING, description: "Must be 'match' or 'mismatch'" }
                  },
                  required: ['whatsappValue', 'fulfillmentValue', 'status']
                }
              },
              required: ['customerName', 'phone', 'facility', 'date', 'ordererName', 'facilityName', 'dropArea', 'district', 'deliveryTime']
            },
            insights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2 to 4 plain-language notes/observations explaining synonyms matched, phone logic checked, or details of anomalies.'
            }
          },
          required: ['confidence', 'verdict', 'allMatch', 'issueCount', 'items', 'meta', 'insights']
        }
      }
    });

    if (!response.text) {
      throw new Error('Empty API response received from Gemini.');
    }

    const payload = JSON.parse(response.text.trim());
    const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(2));

    // Construct final audit record with database metadata
    const auditRecord = {
      ...payload,
      id: 'audit_' + Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString(),
      durationSec,
      whatsappMessage,
      fulfillmentConfirmation,
      status: payload.allMatch ? 'resolved' : 'pending',
      resolutionNotes: payload.allMatch ? 'Matched perfectly upon entry' : '',
      resolvedAt: payload.allMatch ? new Date().toISOString() : undefined
    };

    // Save to local in-memory store (most recent first)
    audits.unshift(auditRecord);

    return res.json(auditRecord);
  } catch (error: any) {
    console.error('Order verification error:', error);
    return res.status(500).json({ error: error.message || 'An error occurred during order audits verification.' });
  }
});


// Scan WhatsApp Screenshot messages via Gemini Vision API
app.post('/api/scan-screenshot', async (req, res) => {
  const { imageBase64, mimeType } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'Please select or upload a WhatsApp screenshot to scan.' });
  }

  // Clean raw base64 if it includes standard data URL scheme (e.g., "data:image/png;base64,")
  let cleanBase64 = imageBase64;
  let cleanMimeType = mimeType || 'image/png';

  if (imageBase64.includes(';base64,')) {
    const parts = imageBase64.split(';base64,');
    cleanBase64 = parts[1];
    const mimeMatch = parts[0].match(/data:(image\/[a-zA-Z0-9+.-]+)/);
    if (mimeMatch) {
      cleanMimeType = mimeMatch[1];
    }
  }

  try {
    const ai = getGeminiClient();

    const response = await generateContentWithRetry(ai, {
      model: 'gemini-3.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: cleanMimeType,
            data: cleanBase64
          }
        },
        {
          text: `You are an expert medical logistics transcription agent.
Please scan this WhatsApp screenshot and extract the full text order.
Specifically, capture and transcribe:
- Sender name or role if visible.
- Facility/Clinic/Health Center name if specified.
- Contact/Reference Phone numbers.
- Detailed medical supplies order list (with accurate quantities, dosages, forms, e.g. "10 vials of Yellow Fever vaccine", "5 cards of PCM 500mg").

Return ONLY the plain text transcription. Do not include any intro/outro, conversational greetings, explanations, or extra markdown blocks unless it is part of the actual message content. Make your output clear, readable, and direct.`
        }
      ]
    });

    const extractedText = response.text || '';
    return res.json({ text: extractedText.trim() });
  } catch (error: any) {
    console.error('Screenshot transcription error:', error);
    return res.status(500).json({ error: error.message || 'An error occurred during screenshot transcription.' });
  }
});



// Fetch all saved audits
app.get('/api/audits', async (req, res) => {
  try {
    const audits = await getAudits();
    return res.json(audits);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Update audit status / resolution notes (discrepancy resolution workflow)
app.patch('/api/audits/:id', async (req, res) => {
  const { id } = req.params;
  const { status, resolutionNotes } = req.body;

  try {
    const auditIndex = audits.findIndex(a => a.id === id);
    if (auditIndex === -1) {
      return res.status(404).json({ error: 'Audit record not found' });
    }

    const currentData = audits[auditIndex];
    const updatedData: any = {
      ...currentData,
      status: status || currentData.status,
      resolutionNotes: resolutionNotes !== undefined ? resolutionNotes : currentData.resolutionNotes,
      resolvedAt: status === 'resolved' ? new Date().toISOString() : (currentData.resolvedAt || null)
    };

    audits[auditIndex] = updatedData;
    return res.json(updatedData);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Calculate statistical analytics for discrepancy improvements
app.get('/api/analytics', async (req, res) => {
  try {
    const audits = await getAudits();

    const totalChecked = audits.length;
    const perfectMatches = audits.filter(a => a.allMatch).length;
    const totalWithIssues = totalChecked - perfectMatches;
    const resolvedCount = audits.filter(a => a.status === 'resolved').length;

    const mismatchTypeCounts = {
      quantityMismatch: 0,
      missingItem: 0,
      extraItem: 0,
      metadataMismatch: 0
    };

    const errorItemCounts: Record<string, { occurrences: number; type: string }> = {};

    for (const audit of audits) {
      if (
        audit.meta?.customerName?.status === 'mismatch' ||
        audit.meta?.phone?.status === 'mismatch' ||
        audit.meta?.facility?.status === 'mismatch'
      ) {
        mismatchTypeCounts.metadataMismatch++;
      }

      if (audit.items && Array.isArray(audit.items)) {
        for (const item of audit.items) {
          if (item.status === 'quantity mismatch') {
            mismatchTypeCounts.quantityMismatch++;
          } else if (item.status === 'missing item') {
            mismatchTypeCounts.missingItem++;
          } else if (item.status === 'extra item') {
            mismatchTypeCounts.extraItem++;
          }

          if (item.status !== 'match') {
            const normalizedName = item.name || 'Unknown Item';
            if (!errorItemCounts[normalizedName]) {
              errorItemCounts[normalizedName] = { occurrences: 0, type: item.status };
            }
            errorItemCounts[normalizedName].occurrences++;
          }
        }
      }
    }

    const commonErrorsList = Object.entries(errorItemCounts).map(([item, details]) => ({
      item,
      occurrences: details.occurrences,
      type: details.type
    })).sort((a, b) => b.occurrences - a.occurrences);

    return res.json({
      totalChecked,
      perfectMatches,
      totalWithIssues,
      resolvedCount,
      mismatchTypeCounts,
      commonErrorsList
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});


// simulated OSU items API endpoints
app.get('/api/osu', (req, res) => {
  res.json(osuItems);
});

app.post('/api/osu', (req, res) => {
  const { item } = req.body;
  if (item && typeof item === 'string') {
    const trimmed = item.trim();
    if (trimmed && !osuItems.includes(trimmed)) {
      osuItems.push(trimmed);
    }
  }
  res.json(osuItems);
});

app.delete('/api/osu', (req, res) => {
  const { item } = req.body;
  if (item && typeof item === 'string') {
    osuItems = osuItems.filter(i => i.toLowerCase() !== item.trim().toLowerCase());
  }
  res.json(osuItems);
});


// Compile companion Chrome extension into packaged ZIP and output on the fly
app.get('/api/download-extension', (req, res) => {
  try {
    // Robustly determine correct secure protocol.
    // Remote servers deployed on Cloud Run are strictly HTTPS, regardless of internal proxy routing.
    let protocol = 'https';
    const hostHeader = req.headers.host || '';
    if (hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') || hostHeader.includes('3000')) {
      protocol = 'http';
    }
    const hostUrl = req.headers.host ? `${protocol}://${req.headers.host}` : 'https://ais-dev-ksv3oiifrmnhdib3nb7awh-944779874869.europe-west2.run.app';
    
    // 1. Extension manifest.json
    const manifest = {
      manifest_version: 3,
      name: "OrderCheck Compliance Companion",
      version: "1.2.0",
      description: "Direct Zipline compliance cross-examiner. Scans orders across tabs and matches logs.",
      permissions: ["activeTab", "scripting", "storage"],
      host_permissions: [
        "http://*/*",
        "https://*/*"
      ],
      action: {
        "default_popup": "popup.html",
        "default_icon": "icon.png"
      },
      content_scripts: [
        {
          "matches": ["http://*/*", "https://*/*"],
          "js": ["content.js"]
        }
      ]
    };

    // 2. Extension popup.html
    const popupHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      width: 340px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 12px;
      background-color: #FDFBFF;
      color: #1e1e24;
    }
    .header {
      background-color: #3B1A5E;
      color: white;
      padding: 10px;
      margin: -12px -12px 12px -12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-keep-open {
      margin-left: auto;
      background: #D6C2EB;
      color: #3B1A5E;
      border: none;
      font-size: 8.5px;
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 3px;
      transition: background 0.2s, color 0.2s;
    }
    .btn-keep-open:hover {
      background: #FFFFFF;
      color: #3B1A5E;
    }
    .header h3 {
      font-size: 14px;
      margin: 0;
    }
    .header p {
      font-size: 9px;
      margin: 2px 0 0 0;
      opacity: 0.8;
    }
    .section-title {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: bold;
      color: #5C2D91;
      margin: 8px 0 4px 0;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    textarea {
      width: 100%;
      height: 70px;
      font-size: 11px;
      font-family: monospace;
      padding: 6px;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      box-sizing: border-box;
      resize: vertical;
      background-color: #FAFAFA;
    }
    textarea:focus {
      outline: none;
      border-color: #5C2D91;
      background-color: #FFFFFF;
    }
    .btn-primary {
      width: 100%;
      background-color: #5C2D91;
      color: white;
      font-weight: bold;
      padding: 10px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      margin-top: 10px;
      transition: background 0.2s;
    }
    .btn-primary:hover {
      background-color: #3B1A5E;
    }
    .btn-secondary {
      width: 100%;
      background-color: #F3E8FF;
      color: #5C2D91;
      font-weight: 500;
      padding: 6px;
      border: 1px solid #D6C2EB;
      border-radius: 6px;
      cursor: pointer;
      font-size: 10px;
      margin-top: 4px;
      transition: background 0.2s;
    }
    .btn-secondary:hover {
      background-color: #E9D5FF;
    }
    .btn-clear {
      width: 100%;
      background-color: #FEE2E2;
      color: #991B1B;
      font-weight: 500;
      padding: 6px;
      border: 1px solid #FCA5A5;
      border-radius: 6px;
      cursor: pointer;
      font-size: 10px;
      margin-top: 4px;
      transition: background 0.2s;
    }
    .btn-clear:hover {
      background-color: #FCA5A5;
    }
    .result-box {
      margin-top: 10px;
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      padding: 8px;
      max-height: 150px;
      overflow-y: auto;
      font-size: 11px;
    }
    .badge {
      display: inline-block;
      font-size: 9px;
      font-weight: bold;
      padding: 2px 6px;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .badge-error { background-color: #FEE2E2; color: #991B1B; }
    .badge-success { background-color: #D1FAE5; color: #065F46; }
    .server-status {
      font-size: 9px;
      color: #6B7280;
      text-align: right;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div style="background-color:#5C2D91; padding:4px; border-radius:4px;">⚡</div>
    <div>
      <h3>OrderCheck Companion</h3>
      <p>Clinical Dispatch Audit Extension v1.2</p>
    </div>
    <button id="btnKeepOpen" class="btn-keep-open" title="📌 Open in a standalone stay-open window, so it won't auto-close when clicking outside!">📌 Keep Open</button>
  </div>

  <div class="section-title">
    <span>WhatsApp Message Log</span>
    <span style="font-size:8px; color:#888; font-weight:normal;">Paste or auto-extract</span>
  </div>
  <textarea id="whatsappText" placeholder="Pasted or extracted WhatsApp message goes here..."></textarea>

  <div class="section-title">
    <span>Fulfillment system log</span>
    <span style="font-size:8px; color:#888; font-weight:normal;">Will pull highlighted text</span>
  </div>
  <textarea id="fulfillmentText" placeholder="Highlight text on the fulfillment page and click button below..."></textarea>
  
  <div style="display: flex; gap: 8px;">
    <button id="btnCapture" class="btn-secondary" style="margin-top: 4px; flex: 1;">✨ Grab Active Page</button>
    <button id="btnClear" class="btn-clear" style="margin-top: 4px; flex: 1;">🗑 Clear Inputs</button>
  </div>

  <button id="btnVerify" class="btn-primary">Analyze For Discrepancies</button>

  <div class="section-title">Audit Cross-Examination</div>
  <div id="results" class="result-box">
    <p style="color:#6B7280; margin:0; text-align:center;">Highlight fulfillment data, ensure WhatsApp is pasted, and click Analyze!</p>
  </div>

  <div class="server-status" id="serverInfo" style="margin-top: 12px; border-top: 1px dashed #D6C2EB; padding-top: 8px; text-align: left;">
    <div style="display: flex; gap: 4px; align-items: center; margin-bottom: 4px;">
      <span style="font-size: 9px; font-weight: bold; color: #5C2D91; white-space: nowrap;">Backend:</span>
      <input type="text" id="backendUrlInput" style="flex: 1; min-width: 0; font-size: 9px; padding: 2px 4px; border: 1px solid #D6C2EB; border-radius: 3px;" value="https://ordercheck-507802192766.europe-west2.run.app" />
      <button id="btnSaveBackend" style="font-size: 8px; padding: 2px 4px; background: #5C2D91; color: white; border: none; border-radius: 3px; cursor: pointer; white-space: nowrap;">Save</button>
      <button id="btnResetBackend" style="font-size: 8px; padding: 2px 4px; background: #E5E7EB; color: #374151; border: 1px solid #D1D5DB; border-radius: 3px; cursor: pointer; white-space: nowrap;">Reset</button>
    </div>
    <div id="backendSaveMsg" style="font-size: 8px; color: #059669; font-weight: 500; display: none; margin-bottom: 4px;">URL updated successfully!</div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <span id="connectionBadge" style="font-size: 8px; font-weight: bold; color: #991B1B; padding: 1px 4px; border-radius: 3px; background-color: #FEE2E2; display: inline-block;">● Pinging...</span>
      <span style="font-size: 8px; color: #5C2D91; font-weight: 500;">Saved automatically</span>
    </div>
    <div style="font-size: 8.5px; color: #6B7280; text-align: left; line-height: 1.2;">
      Verify this matches your current app's Dev/Shared tab URL if you get fetch failures.
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>`;

    // 3. Extension popup.js
    const popupJs = `
const SERVER_URL = 'https://ordercheck-507802192766.europe-west2.run.app';

document.addEventListener('DOMContentLoaded', () => {
  const btnVerify = document.getElementById('btnVerify');
  const btnCapture = document.getElementById('btnCapture');
  const btnClear = document.getElementById('btnClear');
  const whatsappText = document.getElementById('whatsappText');
  const fulfillmentText = document.getElementById('fulfillmentText');
  const results = document.getElementById('results');
  const backendUrlInput = document.getElementById('backendUrlInput');
  const btnSaveBackend = document.getElementById('btnSaveBackend');
  const btnResetBackend = document.getElementById('btnResetBackend');
  const backendSaveMsg = document.getElementById('backendSaveMsg');
  const connectionBadge = document.getElementById('connectionBadge');

  let checkTimer = null;
  const debouncedCheck = () => {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(checkConnection, 500);
  };

  const checkConnection = async () => {
    if (!connectionBadge) return;
    let rawUrl = backendUrlInput ? backendUrlInput.value.trim() : '';
    if (!rawUrl) {
      connectionBadge.textContent = '● Empty URL';
      connectionBadge.style.color = '#B45309';
      connectionBadge.style.backgroundColor = '#FEF3C7';
      return;
    }

    if (!/^https?:\\/\\//i.test(rawUrl)) {
      rawUrl = 'https://' + rawUrl;
    }
    const cleanUrl = rawUrl.replace(/\\/+$/, '');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(\`\${cleanUrl}/api/health\`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        connectionBadge.textContent = '● Connected (Live)';
        connectionBadge.style.color = '#047857';
        connectionBadge.style.backgroundColor = '#D1FAE5';
      } else {
        connectionBadge.textContent = '● Not Ready (' + res.status + ')';
        connectionBadge.style.color = '#DC2626';
        connectionBadge.style.backgroundColor = '#FEE2E2';
      }
    } catch (err) {
      connectionBadge.textContent = '● Unreachable';
      connectionBadge.style.color = '#DC2626';
      connectionBadge.style.backgroundColor = '#FEE2E2';
    }
  };

  // Load saved state and custom backend URL
  chrome.storage.local.get(['whatsappText', 'fulfillmentText', 'customBackendUrl'], (saved) => {
    if (saved.whatsappText !== undefined && saved.whatsappText !== null) {
      whatsappText.value = saved.whatsappText;
    }
    if (saved.fulfillmentText !== undefined && saved.fulfillmentText !== null) {
      fulfillmentText.value = saved.fulfillmentText;
    }
    if (saved.customBackendUrl !== undefined && saved.customBackendUrl !== null && saved.customBackendUrl !== '') {
      if (backendUrlInput) {
        backendUrlInput.value = saved.customBackendUrl;
      }
    }
    // Perform initial ping
    checkConnection();
  });

  // Track state changes to prevent loss
  whatsappText.addEventListener('input', () => {
    chrome.storage.local.set({ whatsappText: whatsappText.value });
  });
  fulfillmentText.addEventListener('input', () => {
    chrome.storage.local.set({ fulfillmentText: fulfillmentText.value });
  });

  // Save customized backend URL on typing instantly
  if (backendUrlInput) {
    backendUrlInput.addEventListener('input', () => {
      let rawUrl = backendUrlInput.value.trim();
      chrome.storage.local.set({ customBackendUrl: rawUrl });
      debouncedCheck();
    });
  }

  // Save button fallback
  if (btnSaveBackend && backendUrlInput) {
    btnSaveBackend.addEventListener('click', () => {
      let rawUrl = backendUrlInput.value.trim();
      if (rawUrl.endsWith('/')) {
        rawUrl = rawUrl.slice(0, -1);
      }
      chrome.storage.local.set({ customBackendUrl: rawUrl }, () => {
        if (backendSaveMsg) {
          backendSaveMsg.style.display = 'block';
          setTimeout(() => {
            backendSaveMsg.style.display = 'none';
          }, 2000);
        }
        checkConnection();
      });
    });
  }

  // Reset button fallback
  if (btnResetBackend && backendUrlInput) {
    btnResetBackend.addEventListener('click', () => {
      backendUrlInput.value = SERVER_URL;
      chrome.storage.local.set({ customBackendUrl: SERVER_URL }, () => {
        if (backendSaveMsg) {
          backendSaveMsg.textContent = 'Reset to Default Backend URL!';
          backendSaveMsg.style.display = 'block';
          setTimeout(() => {
            backendSaveMsg.style.display = 'none';
            backendSaveMsg.textContent = 'URL updated successfully!';
          }, 2000);
        }
        checkConnection();
      });
    });
  }

  // Clear inputs action
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      whatsappText.value = '';
      fulfillmentText.value = '';
      chrome.storage.local.set({ whatsappText: '', fulfillmentText: '' }, () => {
        results.innerHTML = '<p style="color:#6B7280; margin:0; text-align:center;">Inputs cleared. Ready for new audit data!</p>';
      });
    });
  }

  // Standalone Window / Keep Open Behavior
  const urlParams = new URLSearchParams(window.location.search);
  const isStandalone = urlParams.get('standalone') === 'true';
  const btnKeepOpen = document.getElementById('btnKeepOpen');
  if (isStandalone && btnKeepOpen) {
    btnKeepOpen.style.display = 'none';
    // Make the body size adapt nicely to window size
    document.body.style.width = '100%';
    document.body.style.height = '100vh';
    document.body.style.boxSizing = 'border-box';
  } else if (btnKeepOpen) {
    btnKeepOpen.addEventListener('click', () => {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html?standalone=true'),
        type: 'popup',
        width: 380,
        height: 610,
        focused: true
      });
    });
  }

  // Function to request content scrape or selection capture
  const captureSelection = () => {
    results.innerHTML = '<span style="color:#5C2D91; font-weight:500;">Scraping page data...</span>';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
        results.innerHTML = '<span style="color:#DC2626; font-size:11px;">Error: No active tab found. Use the capture button on a real website/WhatsApp tab.</span>';
        return;
      }
      
      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url || '';
      if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:') || tabUrl.startsWith('chrome-extension://')) {
        results.innerHTML = '<span style="color:#D97706; font-size:11px;">Note: Cannot capture highlights on internal chrome:// pages. Access a website first.</span>';
        return;
      }

      chrome.tabs.sendMessage(tabId, { action: "scrape" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[OrderCheck] Could not contact content script:", chrome.runtime.lastError.message);
          results.innerHTML = '<span style="color:#6B7280; font-size:11px; line-height:1.3; display:block;">Active tab does not have a running content script yet.<br/>Please copy & paste directly into the inputs above, or refresh the webpage to enable auto-capture.</span>';
          return;
        }

        if (response) {
          let hasUpdated = false;
          // Priority: use mouse selection if present
          if (response.selection) {
            fulfillmentText.value = response.selection;
            chrome.storage.local.set({ fulfillmentText: response.selection });
            hasUpdated = true;
          } else if (response.fulfillment) {
            fulfillmentText.value = response.fulfillment;
            chrome.storage.local.set({ fulfillmentText: response.fulfillment });
            hasUpdated = true;
          }
          
          if (response.whatsapp) {
            whatsappText.value = response.whatsapp;
            chrome.storage.local.set({ whatsappText: response.whatsapp });
            hasUpdated = true;
          }

          if (hasUpdated) {
            results.innerHTML = '<span style="color:#047857; font-size:11px; font-weight:bold;">✓ Page data captured! Ready for analysis.</span>';
          } else {
            results.innerHTML = '<span style="color:#6B7280; font-size:11px;">No screen state detected. You can paste details manually.</span>';
          }
        } else {
          results.innerHTML = '<span style="color:#DC2626; font-size:11px;">No active scraper response. You can paste details manually!</span>';
        }
      });
    });
  };

  // Capture selection trigger click
  btnCapture.addEventListener('click', captureSelection);

  btnVerify.addEventListener('click', async () => {
    const wa = whatsappText.value.trim();
    const ff = fulfillmentText.value.trim();

    if (!wa || !ff) {
      results.innerHTML = '<span style="color:red; font-size:11px;">Error: Paste or load both the WhatsApp client order and the systems fulfillment log.</span>';
      return;
    }

    results.innerHTML = '<span style="color:#5C2D91; font-weight:bold; animation:pulse 1s infinite;">Checking clinical compliance portal...</span>';

    try {
      let activeUrl = backendUrlInput ? backendUrlInput.value.trim() : SERVER_URL;
      if (!activeUrl) {
         throw new Error("Backend URL is empty.");
      }
      if (!/^https?:\\/\\//i.test(activeUrl)) {
         activeUrl = 'https://' + activeUrl;
      }
      const cleanActiveUrl = activeUrl.replace(/\\/+$/, '');

      const res = await fetch(\`\${cleanActiveUrl}/api/verify\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappMessage: wa, fulfillmentConfirmation: ff })
      });

      if (!res.ok) {
        let errText = 'Status ' + res.status;
        try {
          const errData = await res.json();
          if (errData && errData.error) {
            errText = errData.error;
          }
        } catch (e) {}
        throw new Error('Compliance server error: ' + errText);
      }

      const data = await res.json();
      
      let html = '';
      if (data.allMatch) {
         html += '<div class="badge badge-success">CLEARED FOR LAUNCH</div>';
         html += '<p style="color:#065F46; font-weight:bold; margin:4px 0 0 0;">' + data.verdict + '</p>';
      } else {
         html += '<div class="badge badge-error">DISCREPANCY ALERT (' + data.issueCount + ')</div>';
         html += '<p style="color:#991B1B; font-weight:bold; margin:4px 0;">' + data.verdict + '</p>';
      }

      // Display non-match items/status as summary table
      html += '<div style="margin-top:8px; border-top: 1px solid #F3E8FF; padding-top:6px;">';
      data.items.forEach(it => {
        const itemColor = it.status === 'match' ? '#047857' : (it.status === 'out of stock' ? '#D97706' : '#DC2626');
        const itemSymbol = it.status === 'match' ? '✓' : (it.status === 'out of stock' ? '⚠' : '✗');
        
        html += '<div style="border-bottom:1px solid #FAF5FF; padding:4px 0; font-size:10.5px;">';
        html += '<strong style="color:#3B1A5E;">' + itemSymbol + ' ' + it.name + '</strong>';
        html += ' (Req: ' + it.requested + ' | Sys: ' + it.found + ')';
        html += '<br/><span style="color:' + itemColor + '; font-size:9.5px; font-weight:600;">Status: ' + it.status.toUpperCase() + '</span>';
        if (it.action) {
          html += '<br/><span style="color:#5C2D91; font-size:9.5px; font-weight:500;">➔ ' + it.action + '</span>';
        }
        html += '</div>';
      });
      html += '</div>';

      if (data.insights && data.insights.length > 0) {
        html += '<div style="margin-top:8px; padding-top:6px; border-top:1px solid #F3E8FF; color:#555; font-size:10px;"><strong>Key Insights:</strong><ul style="padding-left:12px; margin:4px 0 0 0;">';
        data.insights.forEach(ins => {
          html += '<li style="margin-bottom:3px;">' + ins + '</li>';
        });
        html += '</ul></div>';
      }

      if (data.meta) {
         html += '<div style="margin-top:8px; border-top:1px dashed #D6C2EB; padding-top:6px; font-size:10px; color:#1E1B4B; background:#FAF5FF; padding:5px; border-radius:4px;">';
         html += '<strong style="color:#5C2D91; display:block; margin-bottom:3px;">Audited Metadata Details:</strong>';
         html += '• <strong>Date:</strong> ' + (data.meta.date ? data.meta.date.whatsappValue || 'N/A' : 'N/A');
         html += '<br/>• <strong>Name of Orderer:</strong> ' + (data.meta.ordererName ? data.meta.ordererName.whatsappValue || 'N/A' : 'N/A');
         html += '<br/>• <strong>Name of Health Facility:</strong> ' + (data.meta.facilityName ? data.meta.facilityName.whatsappValue || 'N/A' : 'N/A');

         if (data.meta.dropArea && data.meta.dropArea.whatsappValue && data.meta.dropArea.whatsappValue !== 'N/A' && data.meta.dropArea.whatsappValue.trim() !== '') {
           html += '<br/>• <strong>Delivery / Drop area:</strong> ' + data.meta.dropArea.whatsappValue;
         }
         if (data.meta.district && data.meta.district.whatsappValue && data.meta.district.whatsappValue !== 'N/A' && data.meta.district.whatsappValue.trim() !== '') {
           html += '<br/>• <strong>District:</strong> ' + data.meta.district.whatsappValue;
         }
         if (data.meta.deliveryTime && data.meta.deliveryTime.whatsappValue && data.meta.deliveryTime.whatsappValue !== 'N/A' && data.meta.deliveryTime.whatsappValue.trim() !== '') {
           html += '<br/>• <strong>Preferred time for Delivery:</strong> ' + data.meta.deliveryTime.whatsappValue;
         }
         html += '</div>';
      }

      results.innerHTML = html;
    } catch (err) {
      results.innerHTML = '<span style="color:red">Error from OrderCheck: ' + err.message + '</span>';
    }
  });
});
`;

    // 4. Extension content.js
    const contentJs = `
console.log("[Compliance Companion] Extension script active.");

// Listen for scrape request
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrape") {
    // 1. Read mouse highlight selection currently made by user on active screen
    const selectedText = window.getSelection() ? window.getSelection().toString().trim() : '';

    // 2. Read message confirmation draft pasted on WhatsApp Web text area (if applicable)
    const waInput = document.querySelector('footer div[contenteditable="true"]') || document.querySelector('footer textarea');
    const whatsappDraft = waInput ? waInput.innerText || waInput.value : '';

    // 3. Read general page text if selection is empty as a fail-safe fallback
    let fallbackText = '';
    const rows = document.querySelectorAll('.fulfillment-item-row, .order-details-card, tr, .item-details');
    if (rows.length > 0) {
      fallbackText = Array.from(rows).map(row => row.innerText || row.textContent).join('\\n');
    } else {
      const mainBox = document.querySelector('#fulfillment-root, .manifest-details, main, body');
      if (mainBox) {
        fallbackText = mainBox.innerText || mainBox.textContent;
      }
    }

    sendResponse({
      selection: selectedText || "",
      whatsapp: whatsappDraft || "",
      fulfillment: fallbackText || ""
    });
  }
  return true;
});
`;

    // 5. Circular purple extension icon base64
    const base64PixelImage = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR42mP8z8AARjYGBgY2NDVMyPhfG0fVUA2MqmECmEC6AmSgK0AGRskwVAMEAABqXg4NshdF9gAAAABJRU5ErkJggg==";
    const iconBuffer = Buffer.from(base64PixelImage, 'base64');

    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile("popup.html", Buffer.from(popupHtml));
    zip.addFile("popup.js", Buffer.from(popupJs));
    zip.addFile("content.js", Buffer.from(contentJs));
    zip.addFile("icon.png", iconBuffer);

    const zipBuffer = zip.toBuffer();
    res.setHeader("Content-Disposition", "attachment; filename=ordercheck-compliance-companion.zip");
    res.setHeader("Content-Type", "application/zip");
    res.status(200).send(zipBuffer);
  } catch (error: any) {
    console.error("Extension compiler error:", error);
    res.status(500).json({ error: error.message || 'Unable to pack extension files' });
  }
});


// Setup static file serving & dev environment Vite handling
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OrderCheck Backend listening on http://localhost:${PORT}`);
  });
}

startServer();
