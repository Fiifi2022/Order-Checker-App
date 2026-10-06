/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import fs from 'fs/promises';
import fsSync from 'fs';
import AdmZip from 'adm-zip';
import { initializeApp as initializeClientApp, getApps as getClientApps, getApp as getClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, collection, getDocs, doc, setDoc, getDoc, deleteDoc, query, orderBy, limit } from 'firebase/firestore/lite';
import * as vaccineService from './server/vaccineService';
import * as activityService from './server/activityService';
import { runDeterministicAuditFallback } from './server/deterministicAudit';
import {
  calculateGeneralAuditSummary,
  isExplicitZeroFulfillment,
  normalizeAuditText,
  normalizeFacilityName,
  normalizeGhanaPhone,
  quantitiesMatchWithInternalQuantity,
  reconcileGeneralQuantityStatus
} from './server/generalAuditRules';
import { getBlueprintProgressStatus } from './src/utils/blueprintProgress';

const app = express();
const PORT = 3000;

// Load Firebase configuration
const firebaseConfig = JSON.parse(
  fsSync.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf-8')
);

// Explicitly set environment variables for sub-libraries/gRPC
process.env.GOOGLE_CLOUD_PROJECT = firebaseConfig.projectId;
process.env.FIRESTORE_DATABASE = firebaseConfig.firestoreDatabaseId;

let firestoreDb: any = null;
function getFirestoreDb() {
  if (!firestoreDb) {
    const apps = getClientApps();
    let app;
    if (apps.length === 0) {
      app = initializeClientApp(firebaseConfig);
    } else {
      app = getClientApp();
    }
    firestoreDb = getClientFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
  return firestoreDb;
}

/**
 * Recursively sanitizes any payload before persisting to Firestore, eliminating any keys
 * with 'undefined' values that Firestore strictly rejects.
 */
function cleanFirestorePayload<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return null as any;
  }
  if (Array.isArray(obj)) {
    return obj
      .filter(item => item !== undefined)
      .map(item => cleanFirestorePayload(item)) as any;
  }
  if (typeof obj === 'object') {
    if (obj instanceof Date) {
      return obj.toISOString() as any;
    }
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanFirestorePayload(value);
      }
    }
    return cleaned as any;
  }
  return obj;
}

/**
 * Safely persists an activity log entry to Firestore without crashing or warning on undefined values
 */
async function persistActivityLogToFirestore(record: any) {
  if (!record || !record.id) return;
  try {
    const db = getFirestoreDb();
    const cleaned = cleanFirestorePayload(record);
    await setDoc(doc(db, 'activity_logs', record.id), cleaned);
  } catch (fErr) {
    console.warn('Firestore activity log persist warning:', fErr);
  }
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.text({ limit: '50mb', type: '*/*' }));

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

function hasKeywordWithBoundaries(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(^|[^a-zA-Z0-9])' + escaped + '($|[^a-zA-Z0-9])', 'i');
  return regex.test(text);
}

function isVaccineExplicitlyInWhatsApp(whatsappText: string, group: { vaccineKeywords: string[]; vaccineName: string }): boolean {
  if (!whatsappText) return false;
  const lines = whatsappText.split('\n');
  
  for (const line of lines) {
    const lineLower = line.toLowerCase().trim();
    if (!lineLower) continue;
    // Skip metadata header lines like "contact:", "name:", "attention:", "facility:", "to:", "from:"
    if (/^(contact|name|attention|facility|to|from|delivered to|received by|doctor|dr|phone|date)\s*:/i.test(lineLower)) {
      continue;
    }
    for (const kw of group.vaccineKeywords) {
      if (kw === 'mr' || kw === 'men') {
        // Must be 'mr vaccine', 'mr -', 'mr 5', '5 mr', 'mr vials', 'mr doses', etc., NOT honorific "Mr. John" or "Mr Kwame"
        if (/(mr|men)\s*(vaccine|vials?|doses?|boxes?|cards?|packs?|\d+)/i.test(lineLower) || /\d+\s*(mr|men)/i.test(lineLower)) {
          return true;
        }
      } else {
        if (hasKeywordWithBoundaries(lineLower, kw)) {
          return true;
        }
      }
    }
  }
  return false;
}

function extractNumber(str: any): number | null {
  if (!str) return null;
  const matches = String(str).match(/(\d+)/);
  return matches ? parseInt(matches[1], 10) : null;
}

// Local in-memory store for simulated out of stock (OSU) units
let osuItems: string[] = [];

const VACCINE_GROUPS_CONFIG = [
  {
    vaccineKeywords: [
      'mr', 'measles', 'measles-rubella', 'measles rubella', 'measles-rubella vaccine',
      'measles vaccine', 'rubella', 'rubella vaccine', 'mr vaccine', 'measles-rubella (mr)',
      'mr (measles-rubella)'
    ],
    diluentKeywords: [
      'mr diluent', 'mr vaccine diluent', 'measles diluent', 'measles-rubella diluent',
      'measles rubella diluent', 'mr diluents', 'mr vaccine diluents', 'measles diluents',
      'measles-rubella diluents', 'measles rubella diluents', 'diluent for mr', 'diluent for measles',
      'diluents for mr', 'diluents for measles', 'measles-rubella vaccine diluent', 'measles-rubella vaccine diluents',
      'measles vaccine diluent', 'measles vaccine diluents', 'rubella diluent', 'rubella diluents'
    ],
    preferredDiluentName: 'MR Diluent',
    vaccineName: 'MR Vaccine'
  },
  {
    vaccineKeywords: ['mena', 'men a', 'men-a', 'men', 'menafrivac', 'meningococcal', 'meningococcal a', 'meningococcal a conjugate vaccine'],
    diluentKeywords: [
      'men a diluent', 'mena diluent', 'menafrivac diluent', 'meningococcal a diluent',
      'men-a diluent', 'men diluent', 'meningococcal diluent', 'men a diluents', 'mena diluents',
      'men-a diluents', 'men a vaccine diluent', 'mena vaccine diluent', 'men-a vaccine diluent'
    ],
    preferredDiluentName: 'Men A Diluent',
    vaccineName: 'Men A Vaccine'
  },
  {
    vaccineKeywords: [
      'bcg', 'bcg vaccine', 'bacillus calmette', 'bacillus calmette-guérin', 'bacillus calmette–guérin',
      'bacillus calmette guerin', 'guerin'
    ],
    diluentKeywords: [
      'bcg diluent', 'bcg vaccine diluent', 'bcg diluents', 'bcg vaccine diluents', 'diluent for bcg',
      'diluents for bcg', 'bcg vaccine diluent', 'bcg vaccine diluents', 'bacillus calmette-guérin diluent',
      'bacillus calmette-guérin diluents', 'bacillus calmette–guérin diluent', 'bacillus calmette–guérin diluents',
      'guerin diluent', 'guerin diluents'
    ],
    preferredDiluentName: 'BCG Diluent',
    vaccineName: 'BCG Vaccine'
  },
  {
    vaccineKeywords: ['opv', 'bopv', 'oral polio', 'oral polio vaccine', 'opv vaccine', 'bopv vaccine'],
    diluentKeywords: [
      'opv dropper', 'opv droppers', 'bopv dropper', 'bopv droppers', 'oral polio dropper', 'oral polio droppers',
      'polio dropper', 'polio droppers', 'opv vaccine dropper', 'opv vaccine droppers', 'bopv vaccine dropper',
      'bopv vaccine droppers', 'dropper for opv', 'droppers for opv', 'dropper for bopv', 'droppers for bopv',
      'oral polio vaccine dropper', 'oral polio vaccine droppers'
    ],
    preferredDiluentName: 'OPV Droppers',
    vaccineName: 'OPV Vaccine'
  },
  {
    vaccineKeywords: ['rota', 'rotavirus', 'rotavirus vaccine', 'rota vaccine'],
    diluentKeywords: [
      'rota dropper', 'rota droppers', 'rotavirus dropper', 'rotavirus droppers',
      'dropper for rota', 'droppers for rota', 'dropper for rotavirus', 'droppers for rotavirus',
      'rota vaccine dropper', 'rota vaccine droppers', 'rotavirus vaccine dropper', 'rotavirus vaccine droppers'
    ],
    preferredDiluentName: 'ROTA Droppers',
    vaccineName: 'Rotavirus Vaccine'
  }
];

async function getAudits(): Promise<any[]> {
  try {
    const db = getFirestoreDb();
    const q = query(collection(db, 'audits'), orderBy('timestamp', 'desc'), limit(100));
    const snapshot = await getDocs(q);
    const results: any[] = [];
    snapshot.forEach((docSnapshot: any) => {
      results.push(docSnapshot.data());
    });
    // Sync to local memory list to keep backward compatibility
    audits.length = 0;
    audits.push(...results);
    return results;
  } catch (err) {
    console.error('Error fetching audits from Firestore, falling back to memory:', err);
    return audits;
  }
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
   - "date": (EXCLUDED FROM AUDITING. Always set both whatsappValue and fulfillmentValue to "N/A" and status strictly to "match" so it never flags any mismatch).
   - "ordererName": Under "Name of Orderer". Extract orderer name from both inputs. Keep in sync with "customerName" for legacy compliance.
   - "facilityName": Under "Name of Health Facility". Extract health center/facility name from both inputs. Keep in sync with "facility" for legacy compliance.
   - "dropArea": Under "Delivery / Drop area". (NOT COMPULSORY. If missing, set both whatsappValue and fulfillmentValue to "N/A" and status to "match". Never log an error/mismatch for this being absent).
   - "district": Under "District". (NOT COMPULSORY. If missing, set both whatsappValue and fulfillmentValue to "N/A" and status to "match". Never log an error/mismatch for this being absent).
   - "deliveryTime": Under "Preferred time for Delivery". (NOT COMPULSORY. If missing, set both whatsappValue and fulfillmentValue to "N/A" and status to "match". Never log an error/mismatch for this being absent).

   - For legacy values:
     - "customerName": identical value as "ordererName".
     - "facility": identical value as "facilityName".
     - "phone": standard contact phone number (or "N/A" if missing; missing contact phone is NOT compulsory and shouldn't trigger mismatch errors).

   - If any optional/non-compulsory field (date, dropArea, district, deliveryTime) is missing or not provided:
     - You MUST boycott/omit raising error/mismatches for them. Set their value fields to "N/A" and status strictly to "match".
     - Do NOT let missing optional fields or excluded fields like date lower confidence score or set allMatch to false. Keep allMatch true and issueCount at 0 if everything else is clean!

==================================================
CRITICAL DOMAIN RULES & ABBREVIATION CATEGORIES (WHEN MEDICAL/CLINICAL):
==================================================
1. VACCINES (Ailment immunizations, preventives):
   DEVELOPER RULE: Perform validation using the exact product identity. Vaccine abbreviations must map one-to-one. Never use disease equivalence for matching. The validator must compare the actual product (e.g., IPV, bOPV, OPV, PCV, MR, BCG, etc.), not the disease they target. Any mismatch between expected and received products must be reported as a discrepancy unless an explicit substitution rule exists in the system configuration.
   You MUST recognize the following routine vaccines and their standard abbreviations as exact 1-to-1 mappings:
   - "BCG" ↔ "Bacillus Calmette-Guérin" (or "Bacillus Calmette–Guérin")
   - "bOPV" ↔ "Bivalent Oral Polio Vaccine" (or "bOPV Vaccine")
   - "OPV" ↔ "Oral Polio Vaccine" (or "OPV Vaccine")
   - "IPV" ↔ "Inactivated Polio Vaccine" (or "Inactivated Polio", "IPV Vaccine")
   - "Penta" ↔ "Pentavalent Vaccine (Diphtheria, Pertussis, Tetanus, Hepatitis B, Hib)" (or "Pentavalent", "Pentavalent Vaccine")
   - "PCV" ↔ "Pneumococcal Conjugate Vaccine" (or "PCV13")
   - "Rota" ↔ "Rotavirus Vaccine" (or "ROTA", "rotavirus")
   - "MR" ↔ "Measles-Rubella Vaccine" (or "Measles-Rubella")
   - "YF" ↔ "Yellow Fever Vaccine" (or "YFV", "Yellow Fever")
   - "MenA" ↔ "Meningococcal A Conjugate Vaccine" (or "Men", "MenAfriVac")
   - "HPV" ↔ "Human Papillomavirus Vaccine" (or "Human Papillomavirus")
   - "Td" ↔ "Tetanus-Diphtheria Vaccine" (or "TT", "Tetanus Toxoid", "Td Vaccine")
   - "HepB" or "HepB BD" ↔ "Hepatitis B Vaccine (Birth Dose)" (or "Hepatitis B Vaccine")
   - "COVID-19" ↔ "COVID-19 Vaccine" (or "Moderna", "Pfizer", "Janssen", "Covishield" where applicable)
   - "RTS,S" ↔ "Mosquirix" (Malaria Vaccine).

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
     e.g., "Measles" or "MR" (Measles-Rubella), "Yellow Fever" / "YFV" / "YF", and "BCG" require "diluents" (diluent vials).
     e.g., "OPV" / "bOPV" (Polio vaccine) and "ROTA" / "rotavirus" require "droppers".
   - You MUST audit and flag any discrepancies regarding these pairing components:
     a. "Presence Discrepancy" (One side has it and the other does not): If one side of the messages (WhatsApp or Fulfillment Confirmation) lists diluents/droppers for the requested vaccine, but the other side does not list or list 0 of them, you MUST flag it as a mismatch/issue (status: 'missing item' or 'extra item').
     b. "Yellow Fever Diluent Rule" (CRITICAL): If "Yellow Fever vaccine" (or YF / YFV / Yellow Fever Vaccine) is entered, requested, or present in either input (WhatsApp or Fulfillment Confirmation), but the matching "Yellow Fever Diluent" is NOT listed or mentioned anywhere in either input (or has a quantity of 0), you MUST flag this as a "missing item" discrepancy. In the "items" array, list "Yellow Fever Diluent" as a separate line item with category set to "Vaccine", status set strictly to "missing item", requested set to match the vaccine doses (e.g., "10 vials" or similar), found set to "0 vials" (or "None"), and action set to "Missing diluent alert: Add [Vaccine Qty] vials of Yellow Fever Diluent to match vaccine doses."
     c. "Number Mismatch": The quantity/count of diluents or droppers MUST match perfectly with the quantity of the corresponding vaccine itself (e.g. 10 doses of MR vaccine must have exactly 10 vials of diluent, and 15 vials of OPV must have exactly 15 droppers). If there is any quantity discrepancy between the vaccine doses and its diluent / dropper count, OR if the requested and fulfillment count of diluents/droppers do not match, you MUST flag this as a 'quantity mismatch'.
     d. Always list these diluents/droppers as individual line items inside the "items" array in your JSON output.
     e. "BCG Vaccine Diluent Match Rule": All BCG vaccine has a diluent, so the vaccine should match the diluent. If the customer orders "BCG Vaccine" (or similar BCG orders) on WhatsApp, and the system fulfillment lists both "BCG Vaccine" and "BCG Diluent" (or BCG Diluents), do NOT flag the BCG Diluent as an "extra item" or any discrepancy. As long as the quantities correspond, set the BCG Diluent's status strictly to "match" so it is not flagged as a discrepancy alert.
      f. "Diluent & Dropper Extra Item Exemption" (CRITICAL): You MUST NOT treat "MR diluent" (or MR vaccine diluent), "Men A diluent" (or MenA diluent, MenAfriVac diluent), "BCG Diluent" (or BCG Vaccine Diluent), or "OPV droppers" (or OPV dropper) as extra items or discrepancies when they are not requested or seen in the WhatsApp message but are present/seen in the fulfillment confirmation log. If they are in the fulfillment confirmation but not in WhatsApp, set their status strictly to "match" and clear them of any discrepancy alerts or actions.

11. OUT OF STOCK (OSU) DETECTION & HANDLING (CRITICAL COMPLIANCE RULES):
   - OUT OF STOCK (OSU) DETECTION & HANDLING: An item is classified as 'out of stock' whenever its fulfillment quantity is explicitly 0 (e.g., "0 vials", "0/N", "0 of N", "0 loaded", "0 units", "0") or when listed as out of stock. If an item requested in WhatsApp is completely absent/omitted from fulfillment confirmation (not mentioned with 0 count), classify it as 'missing item'.
   - WHATSAPP EXCEEDS FULFILLMENT -> ORDER LIMIT / QUANTITY MISMATCH (CRITICAL): If the quantity requested in the WhatsApp section is MORE than the quantity shown in the fulfillment confirmation (e.g., requested 10, found 3, or shown as "3/10"), but the found quantity is greater than 0, you MUST NOT record this as 'out of stock'. Instead, you MUST treat this strictly as a 'quantity mismatch' (which triggers the Order Limit verification flow). Set the status strictly to 'quantity mismatch' and set the action to something like: "Order limit triggered. Correct fulfillment quantity to [Requested Qty] or confirm order limit."
   - ZERO-MISTAKE CLEARANCE EXEMPTION: If the ONLY anomalies/non-match items found in the entire verification process are 'out of stock' items, and there are absolutely NO OTHER mistakes (meaning all other items have perfect status: 'match', and there is no phone number, names, or facility name mismatch), you MUST consider the order cleared!
     In this zero-mistake out-of-stock case, you MUST set output variable 'allMatch' to true, and output variable 'issueCount' to 0 (or count only actual mistakes in issueCount, excluding out-of-stock items so they do not block dispatch). This grants compliance clearance for takeoff/launch since no packaging errors exist, but still preserves the out-of-stock visual alert to notify the clinical facility. Set 'verdict' to something like: 'Cleared for dispatch: No packing mistakes, but some items are out of stock.'
   - If there is any actual packing mistake (like quantity mismatch, missing item, extra item, or facility name/phone mismatch) in addition to out of stock items (see the DISCREPANCY FOCUS & SHORTAGE EXCLUSION RULE exceptions below).
    - DISCREPANCY FOCUS & SHORTAGE EXCLUSION RULE: When an out of stock is detected with other discrepancies (such as a packaging error like quantity mismatch, missing item, extra item, or metadata mismatch like phone or name/facility mismatch), you MUST focus strictly on the other discrepancies and NOT show/treat the out of stock as a discrepancy. In this situation, for any out of stock items, you MUST set their status strictly to 'match' (not 'out of stock') and set their action to something neutral (e.g., "Product out of stock. Shortage noted, but excluded from discrepancies to focus on packaging errors."), and exclude them from your discrepancy lists, allMatch calculation, and issueCount. This ensures the operator can focus solely on the active packing/metadata mistakes.
    - If there is any actual packing mistake (like quantity mismatch, missing item, extra item, or facility name/phone mismatch) in addition to out of stock items, then set 'allMatch' to false and include them in the issueCount, EXCEPT for those out-of-stock items which are converted to 'match' status under the DISCREPANCY FOCUS & SHORTAGE EXCLUSION RULE above.

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
   * "ORS": 25
   * "ORT": 25
   * "ORS Powder": 25
   * "ORS Sachet": 25
   * "ORS Sachets": 25
   * "Oral Rehydration Salt": 25
   * "Oral Rehydration Salts": 25
   * "Oral Rehydration Therapy": 25
   * "Oral Rehydration Salts (ORS)": 25
   * "Oral Rehydration Salt Powder": 25
   * "Oral Rehydration Salt Powder (Flavoured)": 25
   * "(Gbintiri HC) Oral Rehydration Salt Powder": 25
   * "(Sakogu HC) Oral Rehydration Salt Powder": 25
   * "Malaria RDT": 25
   * "Malaria RDT Kit": 25
   * "Malaria RDT Kits": 25
   * "Malaria Rapid Diagnostic Test": 25
   * "Malaria Rapid Diagnostic Test Kit": 25
   * "mRDT": 25
   * "RDT": 25
   * "RDT Kit": 25
   * "RDT Kits": 25
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
  const isFastGeneralAudit = options.generalAuditorFast === true;
  const modelSequence = isFastGeneralAudit
    ? ['gemini-2.5-flash-lite']
    : options.model === 'gemini-3.5-flash' || options.model === 'gemini-3.1-flash-lite' || options.model === 'gemini-2.5-flash'
      ? ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']
      : [options.model];

  let lastError: any = null;

  for (const currentModel of modelSequence) {
    let attempt = 0;
    const maxAttemptsForModel = isFastGeneralAudit || currentModel.startsWith('gemini-3.5') ? 1 : 2; // Fast initial try for flash models to instantly fallback on error to save latency
    const initialDelay = 150; // Fast initial delay for low latency

    while (attempt < maxAttemptsForModel) {
      attempt++;
      try {
        console.log(`[Gemini Request] Trying model: ${currentModel} (Attempt ${attempt}/${maxAttemptsForModel})`);
        
        // Copy options and override the model for this attempt
        const { generalAuditorFast: _generalAuditorFast, ...requestOptions } = options;
        const currentOptions = {
          ...requestOptions,
          model: currentModel
        };

        // If using standard non-thinking models that do not support thinking configuration,
        // we MUST remove thinkingConfig to avoid API schema errors and maintain high speed.
        if (currentOptions.config) {
          currentOptions.config = { ...currentOptions.config };
          if (currentModel !== 'gemini-3.5-flash') {
            if (currentOptions.config.thinkingConfig) {
              delete currentOptions.config.thinkingConfig;
            }
          }
        }
        
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
    const customError = new Error(`The Gemini verification service is currently experiencing extreme demand across all available model pathways (tried ${modelSequence.join(', ')}). Details: ${errorMsg}`);
    (customError as any).status = lastError.status || 'UNAVAILABLE';
    (customError as any).code = lastError.code || 503;
    throw customError;
  }
}

// Health-check endpoint for client/extension pings
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Speed-test and latency-benchmark endpoint
app.get('/api/speedtest', async (req, res) => {
  const startTime = Date.now();
  try {
    const ai = getGeminiClient();
    const response = await generateContentWithRetry(ai, {
      model: 'gemini-3.1-flash-lite',
      contents: 'Verify speed. Output exactly: "OK"'
    });
    const durationMs = Date.now() - startTime;
    res.json({
      success: true,
      durationMs,
      message: response.text ? response.text.trim() : 'OK',
      model: 'gemini-3.1-flash-lite',
      status: durationMs < 2000 ? 'Excellent' : (durationMs < 5000 ? 'Good' : 'Acceptable')
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || String(err)
    });
  }
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
  const isGeneralAuditor = body.auditScope === 'general_auditor';

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
    let response: any;
    const generalRequestController = isGeneralAuditor ? new AbortController() : null;
    const generalRequestTimeout = generalRequestController
      ? setTimeout(() => generalRequestController.abort(), 3500)
      : null;
    generalRequestTimeout?.unref?.();

    try {
      const ai = getGeminiClient();
      response = await generateContentWithRetry(ai, {
      model: isGeneralAuditor ? 'gemini-2.5-flash-lite' : 'gemini-3.1-flash-lite',
      generalAuditorFast: isGeneralAuditor,
      contents: isGeneralAuditor
        ? `Compare these two messages and return only the requested structured audit. Match product aliases only when clearly equivalent. Compare requested and fulfilled quantities using the supplied internal-quantity rules. A fulfillment value of 0/X means out of stock, excluded from discrepancy count; positive partial fulfillment is a quantity mismatch. Include actual product discrepancies and explicitly stated orderer, facility, phone, drop area, district, and delivery-time mismatches. Ignore dates and absent optional metadata. Use only these messages as evidence.\n\nWHATSAPP:\n${whatsappMessage}\n\nFULFILLMENT:\n${fulfillmentConfirmation}`
        : `Please parse, cross-examine, and verify these two inputs (they could be Zipline Ghana medical logistics orders, or general operational/text logs, custom chat messages, or hello worlds requested vs fulfilled/acted):
          
          === WHATSAPP SOURCE MESSAGE ===
          ${whatsappMessage}
          
          === FULFILMENT RECIPIENT SYSTEM LOG ===
          ${fulfillmentConfirmation}
          ${isGeneralAuditor ? '' : `
          === ACTIVE OUT-OF-STOCK (OSU) ITEMS (IF IN MEDICAL CONTEXT) ===
          The following items are currently OUT OF STOCK in the supply warehouse.
          If any item requested in the WhatsApp Message is listed below (or has a matching generic/abbreviation), you MUST set its status to 'out of stock' and write an action advising the operator of the OSU shortage:
          [${osuItems.join(', ')}]`}
          `,
      config: {
        systemInstruction: isGeneralAuditor
          ? `You audit order requests against fulfillment confirmations. Apply these rules: compare product identity, packaging and quantity; use exact aliases and product-specific internal quantities only where supported by the catalog below; detect vaccines and required paired accessories; compare orderer, health facility, and explicitly stated delivery metadata. Normalize harmless spelling, punctuation, facility-type suffixes, and Ghana phone formats. Treat 0/X as out of stock, not a discrepancy. Keep positive partial quantities as quantity mismatches. Ignore dates and missing optional fields. Do not infer facts absent from these two messages.\n\n${SYSTEM_INSTRUCTIONS.slice(SYSTEM_INSTRUCTIONS.indexOf('Official Product Internal Quantities Catalog'))}`
          : SYSTEM_INSTRUCTIONS,
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: isGeneralAuditor ? 4096 : undefined,
        thinkingConfig: isGeneralAuditor ? undefined : {
          thinkingLevel: ThinkingLevel.LOW
        },
        abortSignal: generalRequestController?.signal,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            confidence: {
              type: Type.INTEGER,
              description: isGeneralAuditor ? 'Confidence score (0–100) based only on the two pasted messages.' : 'Confidence score (0–100) regarding overall correctness & consistency of fulfillment and WhatsApp inputs.'
            },
            verdict: {
              type: Type.STRING,
              description: isGeneralAuditor ? 'Summary of discrepancies found by comparing only the two pasted messages.' : "Overall summary verdict. e.g. 'All items match — ready for dispatch' or '2 issues found — review before dispatch'."
            },
            allMatch: {
              type: Type.BOOLEAN,
              description: isGeneralAuditor ? 'Whether the two pasted messages contain any supported discrepancies.' : 'Whether it is a perfect match (true) or contains any mismatch/missing/extra/out-of-stock issues (false).'
            },
            issueCount: {
              type: Type.INTEGER,
              description: isGeneralAuditor ? 'Number of discrepancies supported by the two pasted messages.' : 'The number of mismatch, missing item, extra item, or out-of-stock issues found.'
            },
            items: {
              type: Type.ARRAY,
              description: isGeneralAuditor ? 'Direct comparisons of details explicitly stated in the two messages.' : 'Direct comparison log of all medical items mentioned across both messages.',
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description: isGeneralAuditor ? 'Name or detail as stated in the messages.' : 'Common name of the item. Use Zipline standard naming (or the matched synonym).'
                  },
                  category: {
                    type: Type.STRING,
                    description: isGeneralAuditor ? "Use 'Consumable' as a generic category when the messages do not state a type." : "The medical logistics category of this item. Must be exactly one of: 'Vaccine', 'Medical Product', 'Blood Product', 'Consumable'."
                  },
                  requested: {
                    type: Type.STRING,
                    description: isGeneralAuditor ? 'Value or quantity explicitly stated in the customer request, or None if absent.' : "Quantity/packing described in WhatsApp (e.g. '20 packs', '10 cards', 'None')."
                  },
                  found: {
                    type: Type.STRING,
                    description: isGeneralAuditor ? 'Value or quantity explicitly stated in the fulfilment confirmation, or None if absent.' : "Quantity/packing found in system confirmation (e.g. '20 packs', '0 packs', 'None')."
                  },
                  status: {
                    type: Type.STRING,
                    description: isGeneralAuditor ? "Use 'match', 'quantity mismatch', 'missing item', 'extra item', or 'out of stock' when fulfilment shows 0/X; out-of-stock items are not discrepancies." : "Must be exactly one of: 'match', 'quantity mismatch', 'missing item', 'extra item', 'out of stock'."
                  },
                  action: {
                    type: Type.STRING,
                    description: isGeneralAuditor ? 'Short action based only on the discrepancy shown in the two messages, or None.' : "Short specific directive/action for the user, e.g. 'Change amount to 10 cards' or 'OSU ALERT: OPV is out of stock'."
                  }
                },
                required: ['name', 'requested', 'found', 'status', 'category']
              }
            },
            meta: {
              type: Type.OBJECT,
              description: 'Validation of orderer, facility, contact, and optional delivery metadata; order date is excluded from discrepancy checks.',
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
                    status: { type: Type.STRING, description: "Use 'N/A' for both values and 'match'; dates are not audited." }
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
              description: isGeneralAuditor ? 'Plain-language notes explaining comparisons and discrepancies supported by the two messages.' : '2 to 4 plain-language notes/observations explaining synonyms matched, phone logic checked, or details of anomalies.'
            }
          },
          required: ['confidence', 'verdict', 'allMatch', 'issueCount', 'items', 'meta', 'insights']
        }
      }
      });
    } catch (modelError: any) {
      if (!isGeneralAuditor) throw modelError;
      console.warn('General Auditor model did not finish within its fast request window; using the deterministic audit fallback:', modelError?.message || modelError);
      response = { text: JSON.stringify(runDeterministicAuditFallback(whatsappMessage, fulfillmentConfirmation)) };
    } finally {
      if (generalRequestTimeout) clearTimeout(generalRequestTimeout);
    }

    if (!response.text) {
      throw new Error('Empty API response received from Gemini.');
    }

    const payload = JSON.parse(response.text.trim());

    {
      // Post-process payload to handle Diluent & Dropper Extra Item Exemption:
      // "don't raise discripancy if MR diluent,Men A Diluent and OPV dropper is not added to Whatsapp order but added to fulfilment log."
      if (payload && Array.isArray(payload.items)) {
        const whatsappLower = (whatsappMessage || '').toLowerCase();
      
        const whatsappHasMrDiluent = hasKeywordWithBoundaries(whatsappLower, 'mr diluent') || hasKeywordWithBoundaries(whatsappLower, 'measles diluent') || hasKeywordWithBoundaries(whatsappLower, 'measles-rubella diluent') || (hasKeywordWithBoundaries(whatsappLower, 'diluent') && (hasKeywordWithBoundaries(whatsappLower, 'mr vaccine') || hasKeywordWithBoundaries(whatsappLower, 'measles') || hasKeywordWithBoundaries(whatsappLower, 'rubella')));
        const whatsappHasMenADiluent = hasKeywordWithBoundaries(whatsappLower, 'men a diluent') || hasKeywordWithBoundaries(whatsappLower, 'mena diluent') || (hasKeywordWithBoundaries(whatsappLower, 'diluent') && (hasKeywordWithBoundaries(whatsappLower, 'men a') || hasKeywordWithBoundaries(whatsappLower, 'mena') || hasKeywordWithBoundaries(whatsappLower, 'menafrivac')));
        const whatsappHasBcgDiluent = hasKeywordWithBoundaries(whatsappLower, 'bcg diluent') || (hasKeywordWithBoundaries(whatsappLower, 'diluent') && hasKeywordWithBoundaries(whatsappLower, 'bcg'));
        const whatsappHasOpvDropper = hasKeywordWithBoundaries(whatsappLower, 'opv dropper') || hasKeywordWithBoundaries(whatsappLower, 'opv droppers') || (hasKeywordWithBoundaries(whatsappLower, 'dropper') && (hasKeywordWithBoundaries(whatsappLower, 'opv') || hasKeywordWithBoundaries(whatsappLower, 'bopv') || hasKeywordWithBoundaries(whatsappLower, 'polio')));
        const whatsappHasRotaDropper = hasKeywordWithBoundaries(whatsappLower, 'rota dropper') || hasKeywordWithBoundaries(whatsappLower, 'rota droppers') || hasKeywordWithBoundaries(whatsappLower, 'rotavirus dropper') || hasKeywordWithBoundaries(whatsappLower, 'rotavirus droppers') || (hasKeywordWithBoundaries(whatsappLower, 'dropper') && (hasKeywordWithBoundaries(whatsappLower, 'rota') || hasKeywordWithBoundaries(whatsappLower, 'rotavirus')));

        payload.items = payload.items.map((item: any) => {
          if (!item) return item;
          const nameLower = (item.name || '').toLowerCase();
        
          const isMrDiluent = (nameLower.includes('mr') || nameLower.includes('measles')) && nameLower.includes('diluent');
          const isMenADiluent = (nameLower.includes('men') || nameLower.includes('mena')) && nameLower.includes('diluent');
          const isBcgDiluent = nameLower.includes('bcg') && nameLower.includes('diluent');
          const isOpvDropper = (nameLower.includes('opv') || nameLower.includes('bopv') || nameLower.includes('oral polio')) && nameLower.includes('dropper');
          const isRotaDropper = (nameLower.includes('rota') || nameLower.includes('rotavirus')) && nameLower.includes('dropper');

          if (isMrDiluent || isMenADiluent || isBcgDiluent || isOpvDropper || isRotaDropper) {
            const reqEmpty = !item.requested || item.requested === 'None' || item.requested === '0' || item.requested.trim() === '' || item.requested.toLowerCase().includes('none') || item.requested.toLowerCase().includes('0');
          
            let notInWhatsapp = reqEmpty;
            if (isMrDiluent && !whatsappHasMrDiluent) notInWhatsapp = true;
            if (isMenADiluent && !whatsappHasMenADiluent) notInWhatsapp = true;
            if (isBcgDiluent && !whatsappHasBcgDiluent) notInWhatsapp = true;
            if (isOpvDropper && !whatsappHasOpvDropper) notInWhatsapp = true;
            if (isRotaDropper && !whatsappHasRotaDropper) notInWhatsapp = true;

            const foundPresent = item.found && item.found !== 'None' && item.found !== '0' && item.found.trim() !== '' && !item.found.toLowerCase().includes('none');

            if (notInWhatsapp && foundPresent) {
              return {
                ...item,
                status: 'match',
                action: `${item.name} is present in fulfillment and exempt from active discrepancy alerts since it was not requested.`
              };
            }
          }
          return item;
        });
      }

      // Post-process payload to flag missing diluents/droppers if corresponding vaccine is requested:
      // "flag discripancy when a MR diluent, Men A diluent, BCG Diluent and OPV droppers is not added to fulfilment log but has it corresponding vaccines in the Whatsapp message"
      if (payload && Array.isArray(payload.items)) {
        const vaccineGroups = [
          {
            vaccineKeywords: [
              'mr', 'measles', 'measles-rubella', 'measles rubella', 'measles-rubella vaccine',
              'measles vaccine', 'rubella', 'rubella vaccine', 'mr vaccine', 'measles-rubella (mr)',
              'mr (measles-rubella)'
            ],
            diluentKeywords: [
              'mr diluent', 'mr vaccine diluent', 'measles diluent', 'measles-rubella diluent',
              'measles rubella diluent', 'mr diluents', 'mr vaccine diluents', 'measles diluents',
              'measles-rubella diluents', 'measles rubella diluents', 'diluent for mr', 'diluent for measles',
              'diluents for mr', 'diluents for measles', 'measles-rubella vaccine diluent', 'measles-rubella vaccine diluents',
              'measles vaccine diluent', 'measles vaccine diluents', 'rubella diluent', 'rubella diluents'
            ],
            preferredDiluentName: 'MR Diluent',
            vaccineName: 'MR Vaccine'
          },
          {
            vaccineKeywords: ['mena', 'men a', 'men-a', 'men', 'menafrivac', 'meningococcal', 'meningococcal a', 'meningococcal a conjugate vaccine'],
            diluentKeywords: [
              'men a diluent', 'mena diluent', 'menafrivac diluent', 'meningococcal a diluent',
              'men-a diluent', 'men diluent', 'meningococcal diluent', 'men a diluents', 'mena diluents',
              'men-a diluents', 'men a vaccine diluent', 'mena vaccine diluent', 'men-a vaccine diluent'
            ],
            preferredDiluentName: 'Men A Diluent',
            vaccineName: 'Men A Vaccine'
          },
          {
            vaccineKeywords: [
              'bcg', 'bcg vaccine', 'bacillus calmette', 'bacillus calmette-guérin', 'bacillus calmette–guérin',
              'bacillus calmette guerin', 'guerin'
            ],
            diluentKeywords: [
              'bcg diluent', 'bcg vaccine diluent', 'bcg diluents', 'bcg vaccine diluents', 'diluent for bcg',
              'diluents for bcg', 'bcg vaccine diluent', 'bcg vaccine diluents', 'bacillus calmette-guérin diluent',
              'bacillus calmette-guérin diluents', 'bacillus calmette–guérin diluent', 'bacillus calmette–guérin diluents',
              'guerin diluent', 'guerin diluents'
            ],
            preferredDiluentName: 'BCG Diluent',
            vaccineName: 'BCG Vaccine'
          },
          {
            vaccineKeywords: ['opv', 'bopv', 'oral polio', 'oral polio vaccine', 'opv vaccine', 'bopv vaccine'],
            diluentKeywords: [
              'opv dropper', 'opv droppers', 'bopv dropper', 'bopv droppers', 'oral polio dropper', 'oral polio droppers',
              'polio dropper', 'polio droppers', 'opv vaccine dropper', 'opv vaccine droppers', 'bopv vaccine dropper',
              'bopv vaccine droppers', 'dropper for opv', 'droppers for opv', 'dropper for bopv', 'droppers for bopv',
              'oral polio vaccine dropper', 'oral polio vaccine droppers'
            ],
            preferredDiluentName: 'OPV Droppers',
            vaccineName: 'OPV Vaccine'
          },
          {
            vaccineKeywords: ['rota', 'rotavirus', 'rotavirus vaccine', 'rota vaccine'],
            diluentKeywords: [
              'rota dropper', 'rota droppers', 'rotavirus dropper', 'rotavirus droppers',
              'dropper for rota', 'droppers for rota', 'dropper for rotavirus', 'droppers for rotavirus',
              'rota vaccine dropper', 'rota vaccine droppers', 'rotavirus vaccine dropper', 'rotavirus vaccine droppers'
            ],
            preferredDiluentName: 'ROTA Droppers',
            vaccineName: 'Rotavirus Vaccine'
          }
        ];

        for (const group of vaccineGroups) {
          // Find if the vaccine is in payload.items and requested (not out of stock)
          const vaccineItem = payload.items.find((item: any) => {
            if (!item) return false;
            const nameLower = (item.name || '').toLowerCase();
            // Ensure it's the vaccine itself, not a diluent/dropper
            if (nameLower.includes('diluent') || nameLower.includes('dropper')) return false;
            return group.vaccineKeywords.some(keyword => {
              return nameLower === keyword || 
                     nameLower.startsWith(keyword + ' ') || 
                     nameLower.endsWith(' ' + keyword) ||
                     (keyword.length > 3 && nameLower.includes(keyword));
            });
          });

          // Check if vaccine item is requested in payload.items or explicitly in WhatsApp message text (excluding honorific titles like Mr. in contact names)
          const isVaccineInItems = !!(vaccineItem && 
            vaccineItem.status !== 'out of stock' && 
            vaccineItem.requested && 
            vaccineItem.requested !== 'None' && 
            vaccineItem.requested !== '0' && 
            !vaccineItem.requested.toLowerCase().includes('none') &&
            !vaccineItem.requested.toLowerCase().includes('0'));

          const isVaccineInWaText = isVaccineExplicitlyInWhatsApp(whatsappMessage, group);

          const isVaccineRequested = isVaccineInItems || isVaccineInWaText;

          if (isVaccineRequested) {
            // Verify vaccine is not out of stock
            const isVaccineOsu = payload.items.some((item: any) => {
              if (!item) return false;
              const nameLower = (item.name || '').toLowerCase();
              if (nameLower.includes('diluent') || nameLower.includes('dropper')) return false;
              const isMatched = group.vaccineKeywords.some(keyword => {
                return nameLower === keyword || 
                       nameLower.startsWith(keyword + ' ') || 
                       nameLower.endsWith(' ' + keyword) ||
                       (keyword.length > 3 && nameLower.includes(keyword));
              });
              return isMatched && item.status === 'out of stock';
            });

            if (!isVaccineOsu) {
              // Check if diluent/dropper is in fulfillment confirmation log
              const lowerFf = (fulfillmentConfirmation || '').toLowerCase();

              let diluentItem = payload.items.find((item: any) => {
                if (!item) return false;
                const nameLower = (item.name || '').toLowerCase();
                return group.diluentKeywords.some(keyword => nameLower.includes(keyword));
              });

              // A robust check: check if fulfillment text contains the diluent/dropper for this vaccine
              const hasFoundDiluentInItems = !!(diluentItem && 
                diluentItem.found && 
                diluentItem.found !== 'None' && 
                diluentItem.found !== '0' && 
                diluentItem.found.trim() !== '' && 
                !diluentItem.found.toLowerCase().includes('none') && 
                !diluentItem.found.toLowerCase().includes('0'));

              const ffLinesForCheck = lowerFf.split('\n');
              const hasMatchedLineInFf = ffLinesForCheck.some((line: string) => {
                const lineHasDiluentOrDropper = group.preferredDiluentName.toLowerCase().includes('dropper')
                  ? line.includes('dropper')
                  : line.includes('diluent');
                const lineHasVaccineKeyword = group.vaccineKeywords.some(kw => hasKeywordWithBoundaries(line, kw));
                return group.diluentKeywords.some(keyword => hasKeywordWithBoundaries(line, keyword)) || (lineHasDiluentOrDropper && lineHasVaccineKeyword);
              });

              const isDiluentInFfLog = hasFoundDiluentInItems || hasMatchedLineInFf;

              // Extract actual quantity from fulfillment log if present
              let ffQty = 'None';
              if (diluentItem && diluentItem.found && diluentItem.found !== 'None' && diluentItem.found !== '0' && !diluentItem.found.toLowerCase().includes('none')) {
                ffQty = diluentItem.found;
              } else if (isDiluentInFfLog) {
                const lines = lowerFf.split('\n');
                for (const line of lines) {
                  const lineHasDiluentOrDropper = group.preferredDiluentName.toLowerCase().includes('dropper')
                    ? line.includes('dropper')
                    : line.includes('diluent');
                  const lineHasVaccineKeyword = group.vaccineKeywords.some(kw => hasKeywordWithBoundaries(line, kw));
                  const isLineMatched = group.diluentKeywords.some(keyword => hasKeywordWithBoundaries(line, keyword)) || (lineHasDiluentOrDropper && lineHasVaccineKeyword);
                
                  if (isLineMatched) {
                    const match = line.match(/(\d+)/);
                    if (match) {
                      ffQty = match[1];
                      break;
                    }
                  }
                }
                // If we saw it but no number was found, let's assume it matches the vaccine requested quantity to be safe and avoid false alarms
                if (ffQty === 'None') {
                  const reqVal = vaccineItem ? (vaccineItem.requested || '10') : '10';
                  const matchNum = reqVal.match(/\d+/);
                  ffQty = matchNum ? matchNum[0] : '10';
                }
              }

              // If the diluent is present in fulfillment, update its found quantity and set status to match
              if (isDiluentInFfLog && ffQty !== '0') {
                const reqQty = vaccineItem ? (vaccineItem.requested || '10 vials') : '10 vials';
                if (diluentItem) {
                  diluentItem.found = ffQty;
                  diluentItem.status = 'match';
                  diluentItem.action = 'None';
                } else {
                  payload.items.push({
                    name: group.preferredDiluentName,
                    category: 'Vaccine',
                    requested: reqQty,
                    found: ffQty,
                    status: 'match',
                    action: 'None'
                  });
                }
              } else {
                // Diluent is missing or has 0 quantity in fulfillment
                const reqQty = vaccineItem ? (vaccineItem.requested || '10 vials') : '10 vials';
                if (diluentItem) {
                  diluentItem.status = 'missing item';
                  diluentItem.found = 'None';
                  diluentItem.requested = reqQty;
                  diluentItem.action = `Missing secondary component: Add matching ${group.preferredDiluentName} to fulfillment to pair with ${group.vaccineName}.`;
                } else {
                  payload.items.push({
                    name: group.preferredDiluentName,
                    category: 'Vaccine',
                    requested: reqQty,
                    found: 'None',
                    status: 'missing item',
                    action: `Missing secondary component: Add matching ${group.preferredDiluentName} to fulfillment to pair with ${group.vaccineName}.`
                  });
                }
              }
            }
          }
        }
      }

      // Post-process payload to strictly enforce the "Vaccine out-of-stock format (0/requested)" rule:
      // "A vaccine product can be considered as out of stock only if it is in this form(X/the number requested). note x is also the number requested by customer"
      if (payload && Array.isArray(payload.items)) {
        payload.items = payload.items.map((item: any) => {
          if (!item) return item;

          // If the item has a positive found quantity, it CANNOT be out of stock or missing!
          // Correct status to match or quantity mismatch accordingly.
          if (item.status === 'out of stock' || item.status === 'missing item') {
            const foundVal = (item.found || '').trim().toLowerCase();
            const hasFoundQty = foundVal && foundVal !== 'none' && foundVal !== '0' && !foundVal.includes('none') && !foundVal.includes('0');
            if (hasFoundQty) {
              const numReqMatch = (item.requested || '').match(/\d+/);
              const numFoundMatch = (item.found || '').match(/\d+/);
              if (numReqMatch && numFoundMatch) {
                const numReq = parseInt(numReqMatch[0], 10);
                const numFound = parseInt(numFoundMatch[0], 10);
                if (numReq === numFound) {
                  return {
                    ...item,
                    status: 'match',
                    action: 'None'
                  };
                } else {
                  return {
                    ...item,
                    status: 'quantity mismatch',
                    action: `Correct fulfillment quantity to ${item.requested}.`
                  };
                }
              } else {
                return {
                  ...item,
                  status: 'match',
                  action: 'None'
                };
              }
            }
          }

          // Handle items marked as out of stock or zero-fulfilled (e.g., 0 vials, 0/5, 0 loaded, 0 of 5)
          const foundStr = (item.found || '').trim().toLowerCase();
          const isZeroFound = foundStr === '0' || foundStr.startsWith('0 ') || foundStr.startsWith('0/') || foundStr.startsWith('0 of');
          if (item.status === 'out of stock' || isZeroFound) {
            const currentAction = item.action || '';
            const cleanAction = currentAction.startsWith('Missing item:') || !currentAction ? `OSU ALERT: ${item.name} is out of stock.` : currentAction;
            return {
              ...item,
              status: 'out of stock',
              action: cleanAction
            };
          }
          return item;
        });
      }

      // Post-process payload to handle the Out-Of-Stock Vaccine Diluent/Dropper Exemption:
      // "When a vaccine order is entered and it is out of stock (N/0) and there is no diluent or dropper attached, since it is out of stock do not flag the diluent or dropper as missing."
      if (payload && Array.isArray(payload.items)) {
        const outOfStockVaccines = payload.items.filter((item: any) => {
          if (!item) return false;
          const nameLower = (item.name || '').toLowerCase();
          const isVaccine = (item.category || '').toLowerCase() === 'vaccine' || 
                            ['yellow fever', 'yf', 'yfv', 'measles', 'mr', 'opv', 'bopv', 'ipv', 'pcv', 'penta', 'td', 'tt', 'rota', 'rotavirus', 'hpv', 'men', 'moderna', 'pfizer', 'janssen', 'covishield', 'rts,s', 'mosquirix'].some(v => nameLower.includes(v));
          return isVaccine && item.status === 'out of stock';
        });

        if (outOfStockVaccines.length > 0) {
          payload.items = payload.items.map((item: any) => {
            if (!item) return item;
            const nameLower = (item.name || '').toLowerCase();
            const isDiluent = nameLower.includes('diluent');
            const isDropper = nameLower.includes('dropper');

            if (isDiluent || isDropper) {
              let hasMatchingOsuVaccine = false;
              if (isDiluent) {
                hasMatchingOsuVaccine = outOfStockVaccines.some((v: any) => {
                  const vName = (v.name || '').toLowerCase();
                  return ['yellow fever', 'yf', 'yfv', 'measles', 'mr'].some(keyword => vName.includes(keyword));
                });
              } else if (isDropper) {
                hasMatchingOsuVaccine = outOfStockVaccines.some((v: any) => {
                  const vName = (v.name || '').toLowerCase();
                  return ['opv', 'bopv', 'rota', 'rotavirus'].some(keyword => vName.includes(keyword));
                });
              }

              if (hasMatchingOsuVaccine && (item.status === 'missing item' || item.status === 'quantity mismatch')) {
                return {
                  ...item,
                  status: 'match',
                  action: `Vaccine is out of stock. Matching secondary component (${isDiluent ? 'diluent' : 'dropper'}) is excluded from active discrepancies.`
                };
              }
            }
            return item;
          });
        }
      }

      // Post-process payload to handle BCG Vaccine & BCG Diluent matching:
      // "All BCG vaccine has a diluent so the vaccine should match the diluent. don't flag it if the customer orders for BCG vaccine and the system gives vaccine and BCG diluents."
      if (payload && Array.isArray(payload.items)) {
        const hasBcgVaccine = payload.items.some((item: any) => {
          if (!item) return false;
          const nameLower = (item.name || '').toLowerCase();
          return nameLower.includes('bcg') && !nameLower.includes('diluent') && !nameLower.includes('dropper');
        });

        if (hasBcgVaccine) {
          payload.items = payload.items.map((item: any) => {
            if (!item) return item;
            const nameLower = (item.name || '').toLowerCase();
            if (nameLower.includes('bcg') && nameLower.includes('diluent')) {
              if (item.status === 'extra item' || item.status === 'missing item') {
                return {
                  ...item,
                  status: 'match',
                  action: 'BCG Diluent matched perfectly with BCG Vaccine.'
                };
              }
            }
            return item;
          });
        }
      }

      // Post-process payload to enforce Rule 10.c: Vaccine Diluents & Droppers Quantity Matching
      if (payload && Array.isArray(payload.items)) {
        const vaccineGroupsConfig = [
          {
            vaccineKeywords: [
              'mr', 'measles', 'measles-rubella', 'measles rubella', 'measles-rubella vaccine',
              'measles vaccine', 'rubella', 'rubella vaccine', 'mr vaccine', 'measles-rubella (mr)',
              'mr (measles-rubella)'
            ],
            diluentKeywords: [
              'mr diluent', 'mr vaccine diluent', 'measles diluent', 'measles-rubella diluent',
              'measles rubella diluent', 'mr diluents', 'mr vaccine diluents', 'measles diluents',
              'measles-rubella diluents', 'measles rubella diluents', 'diluent for mr', 'diluent for measles',
              'diluents for mr', 'diluents for measles', 'measles-rubella vaccine diluent', 'measles-rubella vaccine diluents',
              'measles vaccine diluent', 'measles vaccine diluents', 'rubella diluent', 'rubella diluents'
            ],
            preferredDiluentName: 'MR Diluent',
            vaccineName: 'MR Vaccine'
          },
          {
            vaccineKeywords: ['mena', 'men a', 'men-a', 'men', 'menafrivac', 'meningococcal', 'meningococcal a', 'meningococcal a conjugate vaccine'],
            diluentKeywords: [
              'men a diluent', 'mena diluent', 'menafrivac diluent', 'meningococcal a diluent',
              'men-a diluent', 'men diluent', 'meningococcal diluent', 'men a diluents', 'mena diluents',
              'men-a diluents', 'men a vaccine diluent', 'mena vaccine diluent', 'men-a vaccine diluent'
            ],
            preferredDiluentName: 'Men A Diluent',
            vaccineName: 'Men A Vaccine'
          },
          {
            vaccineKeywords: [
              'bcg', 'bcg vaccine', 'bacillus calmette', 'bacillus calmette-guérin', 'bacillus calmette–guérin',
              'bacillus calmette guerin', 'guerin'
            ],
            diluentKeywords: [
              'bcg diluent', 'bcg vaccine diluent', 'bcg diluents', 'bcg vaccine diluents', 'diluent for bcg',
              'diluents for bcg', 'bcg vaccine diluent', 'bcg vaccine diluents', 'bacillus calmette-guérin diluent',
              'bacillus calmette-guérin diluents', 'bacillus calmette–guérin diluent', 'bacillus calmette–guérin diluents',
              'guerin diluent', 'guerin diluents'
            ],
            preferredDiluentName: 'BCG Diluent',
            vaccineName: 'BCG Vaccine'
          },
          {
            vaccineKeywords: ['opv', 'bopv', 'oral polio', 'oral polio vaccine', 'opv vaccine', 'bopv vaccine'],
            diluentKeywords: [
              'opv dropper', 'opv droppers', 'bopv dropper', 'bopv droppers', 'oral polio dropper', 'oral polio droppers',
              'polio dropper', 'polio droppers', 'opv vaccine dropper', 'opv vaccine droppers', 'bopv vaccine dropper',
              'bopv vaccine droppers', 'dropper for opv', 'droppers for opv', 'dropper for bopv', 'droppers for bopv',
              'oral polio vaccine dropper', 'oral polio vaccine droppers'
            ],
            preferredDiluentName: 'OPV Droppers',
            vaccineName: 'OPV Vaccine'
          },
          {
            vaccineKeywords: ['rota', 'rotavirus', 'rotavirus vaccine', 'rota vaccine'],
            diluentKeywords: [
              'rota dropper', 'rota droppers', 'rotavirus dropper', 'rotavirus droppers',
              'dropper for rota', 'droppers for rota', 'dropper for rotavirus', 'droppers for rotavirus',
              'rota vaccine dropper', 'rota vaccine droppers', 'rotavirus vaccine dropper', 'rotavirus vaccine droppers'
            ],
            preferredDiluentName: 'ROTA Droppers',
            vaccineName: 'Rotavirus Vaccine'
          }
        ];

        const getNum = (str: any) => {
          if (!str) return null;
          const m = String(str).match(/(\d+)/);
          return m ? parseInt(m[1], 10) : null;
        };

        payload.items = payload.items.map((item: any) => {
          if (!item) return item;
          const nameLower = (item.name || '').toLowerCase();

          // Check if this item is a diluent or dropper
          const matchedGroup = vaccineGroupsConfig.find(g =>
            g.diluentKeywords.some(dk => nameLower.includes(dk)) ||
            (nameLower.includes('diluent') && g.vaccineKeywords.some(vk => nameLower.includes(vk))) ||
            (nameLower.includes('dropper') && g.vaccineKeywords.some(vk => nameLower.includes(vk)))
          );

          if (matchedGroup) {
            // Find the corresponding vaccine in the items
            const correspondingVaccine = payload.items.find((v: any) => {
              if (!v || v === item) return false;
              const vNameLower = (v.name || '').toLowerCase();
              // Ensure it's not a diluent/dropper itself
              if (vNameLower.includes('diluent') || vNameLower.includes('dropper')) return false;
              return matchedGroup.vaccineKeywords.some(vk => vNameLower.includes(vk));
            });

            if (correspondingVaccine) {
              // Verify vaccine is not out of stock
              const isVaccineOsu = correspondingVaccine.status === 'out of stock';
              if (!isVaccineOsu) {
                const numDiluent = getNum(item.found);
                const numVaccine = getNum(correspondingVaccine.found);

                if (numDiluent !== null && numVaccine !== null && numDiluent !== numVaccine) {
                  return {
                    ...item,
                    status: 'quantity mismatch',
                    action: `Quantity mismatch: ${item.name} quantity (${numDiluent}) must match ${correspondingVaccine.name} quantity (${numVaccine}).`
                  };
                }
              }
            }
          }
          return item;
        });
      }

      // Post-process payload to enforce Product Internal Quantity Equivalency for ORS and Malaria RDT (internal quantity = 25):
      if (payload && Array.isArray(payload.items)) {
        payload.items = payload.items.map((item: any) => {
          if (!item || !item.name) return item;
          const nameLower = item.name.toLowerCase().trim();
          const isOrs =
            hasKeywordWithBoundaries(nameLower, 'ors') ||
            hasKeywordWithBoundaries(nameLower, 'ort') ||
            nameLower.includes('oral rehydration');

          const isRdt =
            hasKeywordWithBoundaries(nameLower, 'rdt') ||
            hasKeywordWithBoundaries(nameLower, 'mrdt') ||
            nameLower.includes('malaria rdt') ||
            nameLower.includes('rapid diagnostic');

          if (isOrs || isRdt) {
            const numReq = extractNumber(item.requested);
            const numFound = extractNumber(item.found);

            if (numReq !== null && numFound !== null) {
              // Internal quantity ratio for ORS and Malaria RDT is 25: 1 box/pack = 25 units/tests
              if (numFound === numReq * 25 || numReq === numFound * 25 || numFound === numReq) {
                return {
                  ...item,
                  status: 'match',
                  action: 'None'
                };
              }
            }
          }
          return item;
        });
      }

      // Post-process payload to reconcile routine vaccine abbreviations:
      if (payload && Array.isArray(payload.items)) {
        const vaccineSynonymsGroup = [
          ['bcg', 'bacillus calmette-guérin', 'bacillus calmette–guérin'],
          ['bopv', 'bopv vaccine', 'bivalent oral polio vaccine', 'bivalent oral polio'],
          ['opv', 'opv vaccine', 'oral polio vaccine', 'oral polio'],
          ['ipv', 'ipv vaccine', 'inactivated polio vaccine', 'inactivated polio'],
          ['penta', 'pentavalent', 'pentavalent vaccine', 'pentavalent vaccine (diphtheria, pertussis, tetanus, hepatitis b, hib)'],
          ['pcv', 'pcv13', 'pneumococcal conjugate vaccine'],
          ['rota', 'rotavirus', 'rotavirus vaccine'],
          ['mr', 'measles-rubella', 'measles-rubella vaccine'],
          ['yf', 'yfv', 'yellow fever', 'yellow fever vaccine'],
          ['mena', 'men', 'menafrivac', 'meningococcal a conjugate vaccine'],
          ['hpv', 'human papillomavirus', 'human papillomavirus vaccine'],
          ['td', 'tt', 'tetanus-diphtheria', 'tetanus-diphtheria vaccine', 'tetanus toxoid', 'td vaccine'],
          ['hepb', 'hepb bd', 'hepatitis b', 'hepatitis b vaccine', 'hepatitis b vaccine (birth dose)'],
          ['covid-19', 'covid-19 vaccine', 'moderna', 'pfizer', 'janssen', 'covishield']
        ];

        const getVaccineGroupIndex = (name: string): number => {
          if (!name) return -1;
          const lower = name.toLowerCase().trim();
          if (lower.includes('diluent') || lower.includes('dropper')) {
            return -1;
          }
          for (let idx = 0; idx < vaccineSynonymsGroup.length; idx++) {
            for (const syn of vaccineSynonymsGroup[idx]) {
              if (lower === syn || 
                  lower.startsWith(syn + ' ') || 
                  lower.endsWith(' ' + syn) ||
                  (syn.length > 3 && lower.includes(syn))) {
                return idx;
              }
            }
          }
          return -1;
        };

        const extractNumber = (qtyStr: string): number | null => {
          if (!qtyStr) return null;
          const matches = qtyStr.match(/(\d+)/);
          return matches ? parseInt(matches[1], 10) : null;
        };

        const originalItems = [...payload.items];
        const mergedIndices = new Set<number>();
        const processedItems: any[] = [];

        for (let i = 0; i < originalItems.length; i++) {
          if (mergedIndices.has(i)) continue;
          const itemA = originalItems[i];
          if (!itemA) continue;

          const groupA = getVaccineGroupIndex(itemA.name);
          if (groupA !== -1 && (itemA.status === 'missing item' || itemA.status === 'extra item' || itemA.status === 'quantity mismatch')) {
            let foundPartner = false;
            for (let j = i + 1; j < originalItems.length; j++) {
              if (mergedIndices.has(j)) continue;
              const itemB = originalItems[j];
              if (!itemB) continue;

              const groupB = getVaccineGroupIndex(itemB.name);
              if (groupB === groupA) {
                const reqVal = (itemA.status === 'missing item' || itemA.status === 'quantity mismatch') ? itemA.requested : itemB.requested;
                const foundVal = (itemB.status === 'extra item' || itemB.status === 'quantity mismatch') ? itemB.found : itemA.found;

                const numReq = extractNumber(reqVal);
                const numFound = extractNumber(foundVal);
                const isQtyMatch = numReq !== null && numFound !== null && numReq === numFound;

                const status = isQtyMatch ? 'match' : 'quantity mismatch';
                const action = isQtyMatch 
                  ? `Vaccine abbreviation match: verified successfully.`
                  : `Quantity mismatch between requested ${reqVal} and fulfilled ${foundVal}.`;

                processedItems.push({
                  name: itemB.name,
                  category: 'Vaccine',
                  requested: reqVal || 'None',
                  found: foundVal || 'None',
                  status: status,
                  action: action
                });

                mergedIndices.add(j);
                foundPartner = true;
                break;
              }
            }

            if (foundPartner) {
              mergedIndices.add(i);
            } else {
              processedItems.push(itemA);
            }
          } else {
            processedItems.push(itemA);
          }
        }

        // Deduplicate payload.items by name or vaccine/diluent groups to prevent duplicate rows
        const uniqueItems: any[] = [];
        for (const item of processedItems) {
          if (!item || !item.name) continue;
          const nameLower = item.name.toLowerCase().trim();
        
          let existingIdx = uniqueItems.findIndex((ex: any) => {
            const exLower = ex.name.toLowerCase().trim();
            if (exLower === nameLower) return true;
            if (exLower + 's' === nameLower || nameLower + 's' === exLower) return true;
            if (exLower.replace(/s$/, '') === nameLower.replace(/s$/, '')) return true;
          
            // Check if both are diluents/droppers of the same group
            for (const group of VACCINE_GROUPS_CONFIG) {
              const isExDil = group.diluentKeywords.some(dk => exLower.includes(dk));
              const isItemDil = group.diluentKeywords.some(dk => nameLower.includes(dk));
              if (isExDil && isItemDil) return true;
            }
            return false;
          });

          if (existingIdx === -1) {
            uniqueItems.push(item);
          } else {
            const existingItem = uniqueItems[existingIdx];
            const finalName = item.name.length > existingItem.name.length ? item.name : existingItem.name;
            const finalCategory = existingItem.category || item.category || 'Vaccine';
          
            const isEmptyVal = (val: any) => !val || val === 'None' || val === '0' || val.trim() === '' || val.toLowerCase().includes('none') || val.toLowerCase().includes('0');
          
            const finalRequested = isEmptyVal(existingItem.requested) && !isEmptyVal(item.requested) ? item.requested : existingItem.requested;
            const finalFound = isEmptyVal(existingItem.found) && !isEmptyVal(item.found) ? item.found : existingItem.found;
          
            let finalStatus = existingItem.status;
            if (existingItem.status === 'match' && item.status !== 'match') {
              finalStatus = item.status;
            }
          
            const finalAction = (existingItem.action && existingItem.action !== 'None' && existingItem.action !== '') ? existingItem.action : item.action;
          
            uniqueItems[existingIdx] = {
              name: finalName,
              category: finalCategory,
              requested: finalRequested || 'None',
              found: finalFound || 'None',
              status: finalStatus,
              action: finalAction || 'None'
            };
          }
        }

        payload.items = uniqueItems;

        // Recalculate issueCount, allMatch, and verdict after resolving abbreviations and deduplicating:
        const remainingIssues = payload.items.filter((item: any) => 
          item && item.status && item.status !== 'match' && item.status !== 'out of stock'
        ).length;
      
        let metaIssuesCount = 0;
        const activeMetaIssues: string[] = [];
        if (payload.meta) {
          // Group similar metadata fields to prevent duplicate discrepancies
          const mismatchedGroups = new Set<string>();
        
          // 1. Name: customerName and ordererName are the same
          if ((payload.meta.customerName && payload.meta.customerName.status === 'mismatch') || 
              (payload.meta.ordererName && payload.meta.ordererName.status === 'mismatch')) {
            mismatchedGroups.add('name');
            activeMetaIssues.push('Customer Name Mismatch');
          }
        
          // 2. Facility: facility and facilityName are the same
          if ((payload.meta.facility && payload.meta.facility.status === 'mismatch') || 
              (payload.meta.facilityName && payload.meta.facilityName.status === 'mismatch')) {
            mismatchedGroups.add('facility');
            activeMetaIssues.push('Facility Name Mismatch');
          }
        
          // 3. Other fields
          const otherFields: Record<string, string> = {
            phone: 'Phone Number',
            dropArea: 'Drop Area',
            district: 'District',
            deliveryTime: 'Delivery Time'
          };
          for (const key of Object.keys(otherFields)) {
            if (payload.meta[key] && payload.meta[key].status === 'mismatch') {
              mismatchedGroups.add(key);
              activeMetaIssues.push(`${otherFields[key]} Mismatch`);
            }
          }
          metaIssuesCount = mismatchedGroups.size;
        }

        payload.issueCount = remainingIssues + metaIssuesCount;
        payload.allMatch = payload.issueCount === 0;

        const activeItemIssues = payload.items
          .filter((item: any) => item && item.status && item.status !== 'match' && item.status !== 'out of stock')
          .map((item: any) => {
            const statusLabel = item.status === 'quantity mismatch' ? 'quantity mismatch' : item.status;
            return `${item.name} (${statusLabel})`;
          });

        const allIssues = Array.from(new Set([...activeItemIssues, ...activeMetaIssues]));
        if (allIssues.length > 0) {
          payload.verdict = `Discrepancy: ${allIssues.join(', ')}.`;
        } else {
          const hasOsu = payload.items.some((item: any) => item && item.status === 'out of stock');
          if (hasOsu) {
            payload.verdict = `Cleared for dispatch: No packing mistakes, but some items are out of stock.`;
          } else {
            payload.verdict = `All active packaging and compliance details match perfectly.`;
          }
        }
      }

      // Post-process payload to strictly enforce the "Discrepancy Focus & Shortage Exclusion" rule:
      // "when an out of stock is detected with other discrepancies, focus on the other discrepancies and dont show the out of stock as a discrepancy"
      if (payload && Array.isArray(payload.items)) {
        const hasOtherItemDiscrepancies = payload.items.some((item: any) => 
          item && item.status && ['quantity mismatch', 'missing item', 'extra item'].includes(item.status)
        );

        let hasOtherMetaDiscrepancies = false;
        if (payload.meta) {
          const compFields = ['customerName', 'phone', 'facility', 'ordererName', 'facilityName', 'dropArea', 'district', 'deliveryTime'];
          for (const field of compFields) {
            if (payload.meta[field] && payload.meta[field].status === 'mismatch') {
              hasOtherMetaDiscrepancies = true;
              break;
            }
          }
        }

        const hasOtherDiscrepancies = hasOtherItemDiscrepancies || hasOtherMetaDiscrepancies;
        const hasOutOfStock = payload.items.some((item: any) => item && item.status === 'out of stock');

        if (hasOutOfStock) {
          if (hasOtherDiscrepancies) {
            // Rule: Convert out of stock items to 'match' so we don't show or treat them as discrepancies
            payload.items = payload.items.map((item: any) => {
              if (item && item.status === 'out of stock') {
                return {
                  ...item,
                  status: 'match',
                  action: `Product out of stock. Shortage noted, but excluded from active discrepancies to focus on packaging errors.`
                };
              }
              return item;
            });

            // Recalculate issueCount and verdict
            const remainingIssues = payload.items.filter((item: any) => 
              item && item.status && item.status !== 'match'
            ).length;
          
            let metaIssuesCount = 0;
            const activeMetaIssues: string[] = [];
            if (payload.meta) {
              // Group similar metadata fields to prevent duplicate discrepancies
              const mismatchedGroups = new Set<string>();
            
              // 1. Name: customerName and ordererName are the same
              if ((payload.meta.customerName && payload.meta.customerName.status === 'mismatch') || 
                  (payload.meta.ordererName && payload.meta.ordererName.status === 'mismatch')) {
                mismatchedGroups.add('name');
                activeMetaIssues.push('Customer Name Mismatch');
              }
            
              // 2. Facility: facility and facilityName are the same
              if ((payload.meta.facility && payload.meta.facility.status === 'mismatch') || 
                  (payload.meta.facilityName && payload.meta.facilityName.status === 'mismatch')) {
                mismatchedGroups.add('facility');
                activeMetaIssues.push('Facility Name Mismatch');
              }
            
              // 3. Other fields
              const otherFields: Record<string, string> = {
                phone: 'Phone Number',
                dropArea: 'Drop Area',
                district: 'District',
                deliveryTime: 'Delivery Time'
              };
              for (const key of Object.keys(otherFields)) {
                if (payload.meta[key] && payload.meta[key].status === 'mismatch') {
                  mismatchedGroups.add(key);
                  activeMetaIssues.push(`${otherFields[key]} Mismatch`);
                }
              }
              metaIssuesCount = mismatchedGroups.size;
            }

            payload.issueCount = remainingIssues + metaIssuesCount;
            payload.allMatch = payload.issueCount === 0;

            const activeItemIssues = payload.items
              .filter((item: any) => item && item.status && item.status !== 'match')
              .map((item: any) => {
                const statusLabel = item.status === 'quantity mismatch' ? 'quantity mismatch' : item.status;
                return `${item.name} (${statusLabel})`;
              });

            const allIssues = Array.from(new Set([...activeItemIssues, ...activeMetaIssues]));
            if (allIssues.length > 0) {
              payload.verdict = `Discrepancy: ${allIssues.join(', ')}.`;
            } else {
              payload.verdict = `All active packaging and compliance details match perfectly.`;
            }
          } else {
            // Out of stock is the ONLY issue, so it's a pass with no active discrepancy alert!
            payload.issueCount = 0;
            payload.allMatch = true;
            payload.verdict = `Cleared for dispatch: No packing mistakes, but some items are out of stock.`;
          }
        }
      }
    }

    if (isGeneralAuditor) {
      const normalizeForComparison = normalizeAuditText;
      const isPresentValue = (value: unknown) => {
        const normalized = normalizeForComparison(value);
        return normalized !== '' && normalized !== 'none' && normalized !== 'n a' && normalized !== 'not provided';
      };
      const defaultMetaField = () => ({ whatsappValue: 'N/A', fulfillmentValue: 'N/A', status: 'match' });
      const normalizeComparedField = (field: any, normalize: (value: unknown) => string, optional = false) => {
        const whatsappValue = field?.whatsappValue;
        const fulfillmentValue = field?.fulfillmentValue;
        const hasWhatsapp = isPresentValue(whatsappValue);
        const hasFulfillment = isPresentValue(fulfillmentValue);
        if ((!hasWhatsapp || !hasFulfillment) && optional) return defaultMetaField();
        const normalized = {
          whatsappValue: hasWhatsapp ? String(whatsappValue).trim() : 'N/A',
          fulfillmentValue: hasFulfillment ? String(fulfillmentValue).trim() : 'N/A',
          status: 'match'
        };
        if (!hasWhatsapp && !hasFulfillment) return normalized;
        normalized.status = hasWhatsapp && hasFulfillment && normalize(whatsappValue) === normalize(fulfillmentValue)
          ? 'match'
          : 'mismatch';
        return normalized;
      };

      const meta = payload.meta || {};
      const ordererName = normalizeComparedField(meta.ordererName || meta.customerName, normalizeAuditText);
      const facilityName = normalizeComparedField(meta.facilityName || meta.facility, normalizeFacilityName);
      meta.ordererName = ordererName;
      meta.customerName = ordererName;
      meta.facilityName = facilityName;
      meta.facility = facilityName;
      meta.phone = normalizeComparedField(meta.phone, normalizeGhanaPhone, true);
      meta.date = defaultMetaField();
      meta.dropArea = normalizeComparedField(meta.dropArea, normalizeForComparison, true);
      meta.district = normalizeComparedField(meta.district, normalizeForComparison, true);
      meta.deliveryTime = normalizeComparedField(meta.deliveryTime, normalizeForComparison, true);
      payload.meta = meta;

      const internalQuantityCatalog = new Map<string, number>();
      const catalogSection = SYSTEM_INSTRUCTIONS.split('Official Product Internal Quantities Catalog')[1] || '';
      for (const match of catalogSection.matchAll(/^\s*\*\s*"(.+?)":\s*(\d+)\s*$/gm)) {
        internalQuantityCatalog.set(normalizeForComparison(match[1]), Number(match[2]));
      }
      const productInternalQuantity = (name: unknown) => internalQuantityCatalog.get(normalizeForComparison(name)) || 1;
      const parseQuantity = (value: unknown) => extractNumber(value);
      const products = Array.isArray(payload.items) ? payload.items : [];

      const ignoredQuantityWords = new Set([
        'a', 'an', 'and', 'the', 'of', 'for', 'item', 'items', 'product', 'products',
        'quantity', 'qty', 'requested', 'found', 'loaded', 'fulfilled', 'fulfilment',
        'fulfillment', 'system', 'confirmation', 'unit', 'units', 'vial', 'vials',
        'box', 'boxes', 'pack', 'packs', 'card', 'cards', 'dose', 'doses'
      ]);
      const productTokens = (value: unknown) => normalizeForComparison(value)
        .split(' ')
        .filter(token => token && !ignoredQuantityWords.has(token));
      const vaccineAliasGroups = [
        ...VACCINE_GROUPS_CONFIG.map(group => group.vaccineKeywords),
        ['yellow fever', 'yellow fever vaccine', 'yf', 'yfv']
      ];
      const vaccineAliasIndex = (value: unknown) => {
        const name = String(value ?? '').toLowerCase();
        if (/diluent|dropper/.test(name)) return -1;
        return vaccineAliasGroups.findIndex(group => group.some(keyword => hasKeywordWithBoundaries(name, keyword)));
      };
      const zeroFulfillmentLines = String(fulfillmentConfirmation || '').split(/\r?\n/).flatMap(line => {
        if (!isExplicitZeroFulfillment(line)) return [];
        const match = line.match(/(?:\b0\s*\/\s*\d+\b|\b0\s+of\s+\d+\b|\b0\s+(?:units?|vials?|packs?|boxes?|cards?|doses?|loaded)\b|\bout[\s-]?of[\s-]?stock\b)/i);
        if (!match) return [];
        const quantity = match[0].match(/\b0\s*\/\s*(\d+)\b|\b0\s+of\s+(\d+)\b/i);
        const found = quantity ? `0/${quantity[1] || quantity[2]}` : match[0];
        const label = line.replace(match[0], ' ').trim();
        return [{ found, tokens: productTokens(label) }];
      });
      const zeroFulfillmentByItem = new Map<any, string>();

      for (const zeroLine of zeroFulfillmentLines) {
        const rankedItems = products.map((item: any) => {
          if (!item || !isPresentValue(item.name)) return { item, score: 0 };
          const itemName = normalizeForComparison(item.name);
          const lineName = normalizeForComparison(zeroLine.tokens.join(' '));
          const lineHasAccessory = /\b(diluent|dropper)\b/.test(lineName);
          const itemHasAccessory = /\b(diluent|dropper)\b/.test(itemName);
          if (lineHasAccessory && !itemHasAccessory) return { item, score: 0 };
          const exactNameScore = itemName && lineName.includes(itemName) ? 1000 + itemName.length : 0;
          const lineVaccineGroup = vaccineAliasIndex(lineName);
          const itemVaccineGroup = vaccineAliasIndex(item.name);
          const vaccineAliasScore = lineVaccineGroup >= 0 && lineVaccineGroup === itemVaccineGroup ? 100 : 0;
          const itemTokens = productTokens(item.name);
          const tokenScore = itemTokens.filter(token => zeroLine.tokens.includes(token)).length;
          return { item, score: Math.max(exactNameScore, vaccineAliasScore, tokenScore) };
        }).filter((candidate: any) => candidate.score > 0)
          .sort((a: any, b: any) => b.score - a.score);
        if (rankedItems.length === 1 || (rankedItems.length > 1 && rankedItems[0].score > rankedItems[1].score)) {
          zeroFulfillmentByItem.set(rankedItems[0].item, zeroLine.found);
        } else if (rankedItems.length === 0 && products.length === 1) {
          zeroFulfillmentByItem.set(products[0], zeroLine.found);
        }
      }

      payload.items = products.map((item: any) => {
        if (!item) return item;
        const foundText = String(item.found ?? '');
        const foundZero = foundText.match(/\b0\s*\/\s*(\d+)\b|\b0\s+of\s+(\d+)\b|\b0\s+(?:units?|vials?|packs?|boxes?|cards?|doses?|loaded)\b/i);
        const sourceZero = zeroFulfillmentByItem.get(item);
        if (foundZero || sourceZero || item.status === 'out of stock' && !isPresentValue(item.found)) {
          const zeroFound = foundZero
            ? foundZero[1] || foundZero[2] ? `0/${foundZero[1] || foundZero[2]}` : foundZero[0]
            : sourceZero || foundText || 'Out of stock';
          return { ...item, found: zeroFound, status: 'out of stock', action: `${item.name} is currently out of stock.` };
        }

        const factor = productInternalQuantity(item.name);
        const reconciledStatus = reconcileGeneralQuantityStatus(item.status, item.requested, item.found, factor);
        if (reconciledStatus === item.status) return item;
        if (reconciledStatus === 'match') return { ...item, status: 'match', action: 'None' };
        if (reconciledStatus === 'extra item') {
          return { ...item, status: 'extra item', action: `Remove ${item.name} from fulfillment.` };
        }
        if (reconciledStatus === 'quantity mismatch') {
          return { ...item, status: 'quantity mismatch', action: `Correct fulfillment quantity to ${item.requested}.` };
        }
        return { ...item, status: reconciledStatus };
      });

      // Yellow Fever diluent is a required paired item. Keep it separate, and do not
      // create a second discrepancy when the vaccine itself is out of stock.
      const isYellowFeverVaccine = (item: any) => {
        const name = String(item?.name || '').toLowerCase();
        return !/diluent|dropper/.test(name) &&
          (name.includes('yellow fever') || hasKeywordWithBoundaries(name, 'yfv') || hasKeywordWithBoundaries(name, 'yf'));
      };
      const isYellowFeverDiluent = (item: any) => {
        const name = String(item?.name || '').toLowerCase();
        return name.includes('diluent') &&
          (name.includes('yellow fever') || hasKeywordWithBoundaries(name, 'yfv') || hasKeywordWithBoundaries(name, 'yf'));
      };
      const yellowFeverVaccine = payload.items.find(isYellowFeverVaccine);
      const yellowFeverRequested = Boolean(yellowFeverVaccine && isPresentValue(yellowFeverVaccine.requested)) ||
        isVaccineExplicitlyInWhatsApp(String(whatsappMessage || ''), {
          vaccineKeywords: ['yellow fever', 'yellow fever vaccine', 'yfv', 'yf'],
          vaccineName: 'Yellow Fever Vaccine'
        });
      if (yellowFeverRequested && yellowFeverVaccine && yellowFeverVaccine.status !== 'out of stock' &&
          isPresentValue(yellowFeverVaccine.found)) {
        const yellowFeverDiluent = payload.items.find(isYellowFeverDiluent);
        const fulfillmentLines = String(fulfillmentConfirmation || '').split(/\r?\n/);
        const diluentLine = fulfillmentLines.find(line => {
          const lower = line.toLowerCase();
          return lower.includes('diluent') &&
            (lower.includes('yellow fever') || hasKeywordWithBoundaries(lower, 'yfv') || hasKeywordWithBoundaries(lower, 'yf'));
        });
        const foundQuantity = yellowFeverDiluent?.found && isPresentValue(yellowFeverDiluent.found)
          ? String(yellowFeverDiluent.found)
          : diluentLine ? String(extractNumber(diluentLine) ?? 'None') : 'None';
        const vaccineQuantity = parseQuantity(yellowFeverVaccine.found) ?? parseQuantity(yellowFeverVaccine.requested);
        const diluentQuantity = parseQuantity(foundQuantity);
        const componentIsOutOfStock = yellowFeverDiluent?.status === 'out of stock' ||
          /\b0\s*\/\s*\d+\b|\b0\s+(?:units?|vials?|packs?|loaded)\b/i.test(foundQuantity);
        const componentStatus = componentIsOutOfStock
          ? 'out of stock'
          : !isPresentValue(foundQuantity)
            ? 'missing item'
            : vaccineQuantity !== null && diluentQuantity !== null && vaccineQuantity !== diluentQuantity
              ? 'quantity mismatch'
              : 'match';
        const component = {
          name: 'Yellow Fever Vaccine Diluent',
          category: 'Vaccine',
          requested: yellowFeverVaccine.found || yellowFeverVaccine.requested || 'N/A',
          found: foundQuantity,
          status: componentStatus,
          action: componentStatus === 'missing item'
            ? 'Add matching Yellow Fever Vaccine Diluent.'
            : componentStatus === 'quantity mismatch'
              ? 'Yellow Fever Diluent quantity must correspond with Yellow Fever Vaccine quantity.'
              : componentStatus === 'out of stock'
                ? 'Yellow Fever Vaccine Diluent is currently out of stock.'
                : 'Auto-paired with Yellow Fever Vaccine.'
        };
        if (yellowFeverDiluent) Object.assign(yellowFeverDiluent, component);
        else payload.items.push(component);
      }

      const hasNameMismatch = ordererName.status === 'mismatch';
      const hasFacilityMismatch = facilityName.status === 'mismatch';
      const metaIssueFields: Array<[string, string]> = [
        ['phone', 'Phone Number Mismatch'],
        ['dropArea', 'Drop Area Mismatch'],
        ['district', 'District Mismatch'],
        ['deliveryTime', 'Delivery Time Mismatch']
      ];
      const metadataIssues = [
        ...(hasNameMismatch ? ['Orderer Name Mismatch'] : []),
        ...(hasFacilityMismatch ? ['Facility Name Mismatch'] : []),
        ...metaIssueFields.filter(([key]) => meta[key]?.status === 'mismatch').map(([, label]) => label)
      ];
      const summary = calculateGeneralAuditSummary(payload.items, metadataIssues);
      payload.issueCount = summary.issueCount;
      payload.allMatch = summary.allMatch;
      payload.verdict = summary.verdict;
    }

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

    // Save to Firestore
    try {
      const db = getFirestoreDb();
      const cleanRecord = { ...auditRecord };
      if (cleanRecord.resolutionNotes === undefined) cleanRecord.resolutionNotes = '';
      if (cleanRecord.resolvedAt === undefined) delete cleanRecord.resolvedAt;
      
      const saveAudit = setDoc(doc(db, 'audits', auditRecord.id), cleanFirestorePayload(cleanRecord))
        .then(() => console.log(`Successfully recorded audit log ${auditRecord.id} to Firestore.`))
        .catch(dbErr => console.error('Failed to write audit log to Firestore:', dbErr));
      if (isGeneralAuditor) void saveAudit;
      else await saveAudit;
    } catch (dbErr) {
      console.error('Failed to write audit log to Firestore:', dbErr);
    }

    return res.json(auditRecord);
  } catch (error: any) {
    console.warn('Gemini verification encountered an issue, seamlessly switching to Deterministic Compliance Engine:', error?.message);
    if (isGeneralAuditor) {
      return res.status(503).json({ error: 'Unable to compare the two pasted messages right now. Please try again.' });
    }
    try {
      const fallbackPayload = runDeterministicAuditFallback(whatsappMessage, fulfillmentConfirmation);
      const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(2));
      const auditRecord = {
        ...fallbackPayload,
        id: 'audit_' + Math.random().toString(36).substring(2, 11),
        timestamp: new Date().toISOString(),
        durationSec,
        whatsappMessage,
        fulfillmentConfirmation,
        status: fallbackPayload.allMatch ? 'resolved' : 'pending',
        resolutionNotes: fallbackPayload.allMatch ? 'Matched perfectly upon entry (Deterministic Fallback Engine)' : '',
        resolvedAt: fallbackPayload.allMatch ? new Date().toISOString() : undefined
      };

      audits.unshift(auditRecord);
      try {
        const db = getFirestoreDb();
        const cleanRecord = { ...auditRecord };
        if (cleanRecord.resolutionNotes === undefined) cleanRecord.resolutionNotes = '';
        if (cleanRecord.resolvedAt === undefined) delete cleanRecord.resolvedAt;
        await setDoc(doc(db, 'audits', auditRecord.id), cleanFirestorePayload(cleanRecord));
        console.log(`Successfully recorded deterministic audit log ${auditRecord.id} to Firestore.`);
      } catch (dbErr) {
        console.error('Failed to write deterministic audit log to Firestore:', dbErr);
      }

      return res.json(auditRecord);
    } catch (fallbackErr: any) {
      console.error('Deterministic fallback error:', fallbackErr);
      return res.status(500).json({ error: error.message || 'An error occurred during order audits verification.' });
    }
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
    const errMsg = String(error?.message || error || '').toLowerCase();
    if (errMsg.includes('exhausted') || errMsg.includes('rate limit') || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('503') || errMsg.includes('demand')) {
      return res.status(200).json({
        text: '',
        quotaAlert: true,
        message: 'The AI vision scanner quota is currently exhausted. Please paste or type your order text directly into the text box below to audit immediately without waiting.'
      });
    }
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
    let currentData: any = null;
    const auditIndex = audits.findIndex(a => a.id === id);
    if (auditIndex !== -1) {
      currentData = audits[auditIndex];
    } else {
      // Try fetching from Firestore if not in-memory
      try {
        const db = getFirestoreDb();
        const docSnap = await getDoc(doc(db, 'audits', id));
        if (docSnap.exists()) {
          currentData = docSnap.data();
        }
      } catch (dbErr) {
        console.error('Failed to fetch from Firestore during patch:', dbErr);
      }
    }

    if (!currentData) {
      return res.status(404).json({ error: 'Audit record not found' });
    }

    const updatedData: any = {
      ...currentData,
      status: status || currentData.status,
      resolutionNotes: resolutionNotes !== undefined ? resolutionNotes : currentData.resolutionNotes,
      resolvedAt: status === 'resolved' ? new Date().toISOString() : (currentData.resolvedAt || null)
    };

    // Update in-memory
    if (auditIndex !== -1) {
      audits[auditIndex] = updatedData;
    } else {
      audits.unshift(updatedData);
    }

    // Update in Firestore
    try {
      const db = getFirestoreDb();
      await setDoc(doc(db, 'audits', id), cleanFirestorePayload(updatedData), { merge: true });
      console.log(`Successfully updated audit log ${id} in Firestore.`);
    } catch (dbErr) {
      console.error('Failed to update audit log in Firestore:', dbErr);
    }

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

app.delete('/api/audits', (req, res) => {
  audits.length = 0;
  res.json({ success: true, count: 0 });
});

// ==========================================
// VACCINE ALLOCATION VALIDATION & TRACKING ROUTES
// ==========================================

// Get all facilities with their current vaccine allocations
app.get('/api/vaccine/allocations', async (req, res) => {
  try {
    const facilities = vaccineService.getAllFacilities();
    return res.json(facilities);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Get specific facility allocation by ID
app.get('/api/vaccine/allocations/:id', async (req, res) => {
  try {
    const facility = vaccineService.getFacilityById(req.params.id);
    if (!facility) return res.status(404).json({ error: 'Facility not found' });
    return res.json(facility);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Clear allocations to pave way for a new cycle / prepare for live operational use
app.post('/api/vaccine/allocations/clear', async (req, res) => {
  try {
    const { clearHistory, newCycleName } = req.body || {};
    const result = vaccineService.clearAllAllocations({ clearHistory: true, newCycleName });
    audits.length = 0;
    osuItems = [];
    return res.json({ ...result, facilities: [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Reset allocations to standard DCO baseline (including Konkoma SDA Clinic)
app.post('/api/vaccine/allocations/reset-demo', async (req, res) => {
  try {
    const facilities = vaccineService.resetDemoAllocations();
    return res.json({ success: true, facilities });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Import allocation tracker rows from parsed Excel/CSV
app.post('/api/vaccine/allocations/upload', async (req, res) => {
  try {
    const { rows, updatedBy } = req.body;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Invalid payload: rows must be an array' });
    }
    const result = vaccineService.importAllocationsFromRows(rows, updatedBy);
    return res.json({ success: true, ...result, facilities: vaccineService.getAllFacilities() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 67-COLUMN VACCINE ALLOCATION BLUEPRINT (sample.xlsx)
// ==========================================
const DEFAULT_BLUEPRINT_PRODUCTS = [
  'BCG',
  'OPV',
  'MR',
  'PENTA',
  'YF',
  'ROTA',
  'IPV',
  'PCV',
  'MEN A',
  'HPV',
  'TD',
  'R21',
  'Soloshot 0.05ml',
  'Soloshot 0.5ml',
  'Syringe and needle 2ml',
  'Syringe and needle 5ml'
];

export interface DistrictSheetData {
  id: string;
  district: string;
  month: string;
  products: string[];
  rows: any[];
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_DISTRICT_SHEETS: Record<string, DistrictSheetData> = {
  west_mamprusi: {
    id: 'west_mamprusi',
    district: 'West Mamprusi',
    month: 'September 2026',
    products: [...DEFAULT_BLUEPRINT_PRODUCTS],
    rows: [
      {
        id: 'bp_wm_1',
        processing: 'Completed',
        completed: '2026-09-02',
        facility: 'Walewale District Hospital',
        subDistrict: 'Walewale',
        comment: 'Main district referral hospital with functional walk-in cold room. Morning drone delivery preferred.',
        vaccineComments: {
          'BCG': 'Emergency top-up +20 vials approved by Regional EPI officer.',
          'R21': 'Phase 2 malaria immunization cohort enrolled.',
          'HPV': 'School outreach delivery scheduled for week 2.'
        },
        vaccines: {
          'BCG': { carryOver: 15, allocation: 100, distributed: 115, balance: 0 },
          'OPV': { carryOver: 20, allocation: 150, distributed: 170, balance: 0 },
          'MR': { carryOver: 10, allocation: 80, distributed: 90, balance: 0 },
          'PENTA': { carryOver: 15, allocation: 120, distributed: 135, balance: 0 },
          'YF': { carryOver: 10, allocation: 70, distributed: 80, balance: 0 },
          'ROTA': { carryOver: 15, allocation: 90, distributed: 105, balance: 0 },
          'IPV': { carryOver: 10, allocation: 60, distributed: 70, balance: 0 },
          'PCV': { carryOver: 12, allocation: 85, distributed: 97, balance: 0 },
          'MEN A': { carryOver: 8, allocation: 50, distributed: 58, balance: 0 },
          'HPV': { carryOver: 5, allocation: 40, distributed: 45, balance: 0 },
          'TD': { carryOver: 10, allocation: 60, distributed: 70, balance: 0 },
          'R21': { carryOver: 20, allocation: 150, distributed: 170, balance: 0 },
          'Soloshot 0.05ml': { carryOver: 50, allocation: 200, distributed: 250, balance: 0 },
          'Soloshot 0.5ml': { carryOver: 50, allocation: 250, distributed: 300, balance: 0 },
          'Syringe and needle 2ml': { carryOver: 40, allocation: 200, distributed: 240, balance: 0 },
          'Syringe and needle 5ml': { carryOver: 30, allocation: 150, distributed: 180, balance: 0 }
        }
      },
      {
        id: 'bp_wm_2',
        processing: 'In Progress',
        completed: '',
        facility: 'Kparigu Health Centre',
        subDistrict: 'Kparigu',
        comment: 'Drone delivery drop-zone active. Refrigerator serviced last week.',
        vaccineComments: {
          'OPV': 'Routine monthly replenishment.',
          'PENTA': 'Cold box carrier verified before dispatch.'
        },
        vaccines: {
          'BCG': { carryOver: 5, allocation: 50, distributed: 15, balance: 40 },
          'OPV': { carryOver: 10, allocation: 75, distributed: 25, balance: 60 },
          'MR': { carryOver: 8, allocation: 40, distributed: 15, balance: 33 },
          'PENTA': { carryOver: 10, allocation: 60, distributed: 20, balance: 50 },
          'YF': { carryOver: 5, allocation: 35, distributed: 10, balance: 30 },
          'ROTA': { carryOver: 8, allocation: 45, distributed: 15, balance: 38 },
          'IPV': { carryOver: 5, allocation: 30, distributed: 10, balance: 25 },
          'PCV': { carryOver: 6, allocation: 40, distributed: 15, balance: 31 },
          'MEN A': { carryOver: 4, allocation: 25, distributed: 10, balance: 19 },
          'HPV': { carryOver: 3, allocation: 20, distributed: 5, balance: 18 },
          'TD': { carryOver: 5, allocation: 30, distributed: 10, balance: 25 },
          'R21': { carryOver: 10, allocation: 70, distributed: 25, balance: 55 },
          'Soloshot 0.05ml': { carryOver: 20, allocation: 100, distributed: 40, balance: 80 },
          'Soloshot 0.5ml': { carryOver: 25, allocation: 120, distributed: 45, balance: 100 },
          'Syringe and needle 2ml': { carryOver: 20, allocation: 100, distributed: 35, balance: 85 },
          'Syringe and needle 5ml': { carryOver: 15, allocation: 75, distributed: 25, balance: 65 }
        }
      },
      {
        id: 'bp_wm_3',
        processing: 'Pending',
        completed: '',
        facility: 'Wulugu Health Centre',
        subDistrict: 'Wulugu',
        vaccines: {
          'BCG': { carryOver: 4, allocation: 40, distributed: 10, balance: 34 },
          'OPV': { carryOver: 8, allocation: 60, distributed: 20, balance: 48 },
          'MR': { carryOver: 5, allocation: 30, distributed: 10, balance: 25 },
          'PENTA': { carryOver: 6, allocation: 45, distributed: 15, balance: 36 }
        }
      },
      {
        id: 'bp_wm_4',
        processing: 'In Progress',
        completed: '',
        facility: 'Konkoma SDA Clinic',
        subDistrict: 'Konkoma',
        vaccines: {
          'BCG': { carryOver: 5, allocation: 25, distributed: 5, balance: 25 },
          'OPV': { carryOver: 10, allocation: 40, distributed: 10, balance: 40 },
          'MR': { carryOver: 0, allocation: 20, distributed: 20, balance: 0 },
          'PENTA': { carryOver: 8, allocation: 30, distributed: 10, balance: 28 },
          'YF': { carryOver: 5, allocation: 20, distributed: 5, balance: 20 },
          'ROTA': { carryOver: 5, allocation: 25, distributed: 5, balance: 25 },
          'IPV': { carryOver: 5, allocation: 20, distributed: 5, balance: 20 },
          'PCV': { carryOver: 5, allocation: 25, distributed: 5, balance: 25 },
          'MEN A': { carryOver: 3, allocation: 15, distributed: 3, balance: 15 },
          'HPV': { carryOver: 2, allocation: 10, distributed: 2, balance: 10 },
          'TD': { carryOver: 5, allocation: 20, distributed: 5, balance: 20 },
          'R21': { carryOver: 10, allocation: 40, distributed: 10, balance: 40 },
          'Soloshot 0.05ml': { carryOver: 20, allocation: 50, distributed: 20, balance: 50 },
          'Soloshot 0.5ml': { carryOver: 20, allocation: 60, distributed: 20, balance: 60 },
          'Syringe and needle 2ml': { carryOver: 15, allocation: 50, distributed: 15, balance: 50 },
          'Syringe and needle 5ml': { carryOver: 10, allocation: 40, distributed: 10, balance: 40 }
        }
      },
      {
        id: 'bp_wm_5',
        processing: 'Pending',
        completed: '',
        facility: 'Janga Polyclinic',
        subDistrict: 'Janga',
        vaccines: {
          'BCG': { carryOver: 10, allocation: 80, distributed: 20, balance: 70 },
          'OPV': { carryOver: 15, allocation: 100, distributed: 30, balance: 85 }
        }
      }
    ]
  },
  east_mamprusi: {
    id: 'east_mamprusi',
    district: 'East Mamprusi',
    month: 'September 2026',
    products: [...DEFAULT_BLUEPRINT_PRODUCTS],
    rows: [
      {
        id: 'bp_em_1',
        processing: 'Completed',
        completed: '2026-09-03',
        facility: 'Gambaga Health Centre',
        subDistrict: 'Gambaga',
        vaccines: {
          'BCG': { carryOver: 10, allocation: 80, distributed: 30, balance: 60 },
          'OPV': { carryOver: 15, allocation: 120, distributed: 45, balance: 90 },
          'MR': { carryOver: 8, allocation: 60, distributed: 20, balance: 48 },
          'PENTA': { carryOver: 12, allocation: 90, distributed: 35, balance: 67 },
          'YF': { carryOver: 8, allocation: 50, distributed: 20, balance: 38 },
          'ROTA': { carryOver: 10, allocation: 70, distributed: 25, balance: 55 },
          'IPV': { carryOver: 6, allocation: 50, distributed: 15, balance: 41 },
          'PCV': { carryOver: 8, allocation: 60, distributed: 20, balance: 48 },
          'MEN A': { carryOver: 5, allocation: 40, distributed: 15, balance: 30 },
          'HPV': { carryOver: 4, allocation: 30, distributed: 10, balance: 24 },
          'TD': { carryOver: 8, allocation: 50, distributed: 15, balance: 43 },
          'R21': { carryOver: 15, allocation: 110, distributed: 40, balance: 85 },
          'Soloshot 0.05ml': { carryOver: 35, allocation: 150, distributed: 60, balance: 125 },
          'Soloshot 0.5ml': { carryOver: 40, allocation: 180, distributed: 70, balance: 150 },
          'Syringe and needle 2ml': { carryOver: 30, allocation: 140, distributed: 50, balance: 120 },
          'Syringe and needle 5ml': { carryOver: 20, allocation: 100, distributed: 35, balance: 85 }
        }
      },
      {
        id: 'bp_em_2',
        processing: 'In Progress',
        completed: '',
        facility: 'Nalerigu Baptist Medical Centre',
        subDistrict: 'Nalerigu',
        vaccines: {
          'BCG': { carryOver: 20, allocation: 120, distributed: 50, balance: 90 },
          'OPV': { carryOver: 25, allocation: 180, distributed: 70, balance: 135 },
          'MR': { carryOver: 15, allocation: 90, distributed: 35, balance: 70 },
          'PENTA': { carryOver: 18, allocation: 130, distributed: 55, balance: 93 },
          'YF': { carryOver: 12, allocation: 80, distributed: 30, balance: 62 },
          'ROTA': { carryOver: 15, allocation: 100, distributed: 40, balance: 75 },
          'IPV': { carryOver: 10, allocation: 70, distributed: 25, balance: 55 },
          'PCV': { carryOver: 14, allocation: 95, distributed: 35, balance: 74 },
          'MEN A': { carryOver: 10, allocation: 60, distributed: 25, balance: 45 },
          'HPV': { carryOver: 6, allocation: 50, distributed: 20, balance: 36 },
          'TD': { carryOver: 12, allocation: 70, distributed: 25, balance: 57 },
          'R21': { carryOver: 25, allocation: 160, distributed: 65, balance: 120 },
          'Soloshot 0.05ml': { carryOver: 60, allocation: 220, distributed: 90, balance: 190 },
          'Soloshot 0.5ml': { carryOver: 60, allocation: 260, distributed: 105, balance: 215 },
          'Syringe and needle 2ml': { carryOver: 45, allocation: 210, distributed: 80, balance: 175 },
          'Syringe and needle 5ml': { carryOver: 35, allocation: 160, distributed: 55, balance: 140 }
        }
      },
      {
        id: 'bp_em_3',
        processing: 'Pending',
        completed: '',
        facility: 'Langbinsi Health Centre',
        subDistrict: 'Langbinsi',
        vaccines: {
          'BCG': { carryOver: 5, allocation: 45, distributed: 10, balance: 40 },
          'OPV': { carryOver: 8, allocation: 60, distributed: 15, balance: 53 },
          'MR': { carryOver: 6, allocation: 35, distributed: 10, balance: 31 },
          'PENTA': { carryOver: 8, allocation: 50, distributed: 15, balance: 43 }
        }
      },
      {
        id: 'bp_em_4',
        processing: 'Pending',
        completed: '',
        facility: 'Sakogu Health Centre',
        subDistrict: 'Sakogu',
        vaccines: {
          'BCG': { carryOver: 4, allocation: 40, distributed: 10, balance: 34 },
          'OPV': { carryOver: 6, allocation: 50, distributed: 12, balance: 44 }
        }
      }
    ]
  },
  bunkpurugu_nakpanduri: {
    id: 'bunkpurugu_nakpanduri',
    district: 'Bunkpurugu Nakpanduri',
    month: 'September 2026',
    products: [...DEFAULT_BLUEPRINT_PRODUCTS],
    rows: [
      {
        id: 'bp_bn_1',
        processing: 'In Progress',
        completed: '',
        facility: 'Bunkpurugu Health Centre',
        subDistrict: 'Bunkpurugu',
        vaccines: {
          'BCG': { carryOver: 8, allocation: 70, distributed: 25, balance: 53 },
          'OPV': { carryOver: 12, allocation: 100, distributed: 35, balance: 77 },
          'MR': { carryOver: 6, allocation: 50, distributed: 18, balance: 38 },
          'PENTA': { carryOver: 10, allocation: 80, distributed: 30, balance: 60 },
          'YF': { carryOver: 6, allocation: 45, distributed: 15, balance: 36 },
          'ROTA': { carryOver: 8, allocation: 60, distributed: 20, balance: 48 },
          'IPV': { carryOver: 5, allocation: 40, distributed: 12, balance: 33 },
          'PCV': { carryOver: 6, allocation: 50, distributed: 18, balance: 38 },
          'MEN A': { carryOver: 4, allocation: 35, distributed: 12, balance: 27 },
          'HPV': { carryOver: 3, allocation: 25, distributed: 8, balance: 20 },
          'TD': { carryOver: 6, allocation: 40, distributed: 12, balance: 34 },
          'R21': { carryOver: 12, allocation: 90, distributed: 35, balance: 67 },
          'Soloshot 0.05ml': { carryOver: 30, allocation: 130, distributed: 50, balance: 110 },
          'Soloshot 0.5ml': { carryOver: 35, allocation: 150, distributed: 55, balance: 130 },
          'Syringe and needle 2ml': { carryOver: 25, allocation: 120, distributed: 40, balance: 105 },
          'Syringe and needle 5ml': { carryOver: 18, allocation: 85, distributed: 25, balance: 78 }
        }
      },
      {
        id: 'bp_bn_2',
        processing: 'Pending',
        completed: '',
        facility: 'Nakpanduri Health Centre',
        subDistrict: 'Nakpanduri',
        vaccines: {
          'BCG': { carryOver: 6, allocation: 55, distributed: 15, balance: 46 },
          'OPV': { carryOver: 10, allocation: 80, distributed: 20, balance: 70 },
          'MR': { carryOver: 5, allocation: 40, distributed: 10, balance: 35 },
          'PENTA': { carryOver: 8, allocation: 60, distributed: 15, balance: 53 }
        }
      },
      {
        id: 'bp_bn_3',
        processing: 'Pending',
        completed: '',
        facility: 'Bimbagu Clinic',
        subDistrict: 'Bimbagu',
        vaccines: {
          'BCG': { carryOver: 3, allocation: 30, distributed: 5, balance: 28 },
          'OPV': { carryOver: 5, allocation: 40, distributed: 10, balance: 35 }
        }
      }
    ]
  }
};

let blueprintDistricts: Record<string, DistrictSheetData> = JSON.parse(JSON.stringify(DEFAULT_DISTRICT_SHEETS));
let activeDistrictId: string = 'west_mamprusi';

// Helper: Map vaccine names reliably to Blueprint column product names
function findMatchingVaccineKeyInBlueprint(
  bpVaccines: Record<string, any>,
  targetVaccine: string,
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS
): string {
  if (!targetVaccine) return targetVaccine;
  // 1. Direct match in bpVaccines
  if (bpVaccines[targetVaccine] !== undefined) return targetVaccine;

  const targetCanonical = vaccineService.matchVaccineName(targetVaccine).canonical.toLowerCase();

  // 2. Existing key in bpVaccines matching canonical or lowercase
  for (const existingKey of Object.keys(bpVaccines)) {
    if (existingKey.toLowerCase().trim() === targetVaccine.toLowerCase().trim()) {
      return existingKey;
    }
    if (vaccineService.matchVaccineName(existingKey).canonical.toLowerCase() === targetCanonical) {
      return existingKey;
    }
  }

  // 3. Match against sheet product list (e.g. 'PENTA' in DEFAULT_BLUEPRINT_PRODUCTS)
  for (const prod of productList) {
    if (prod.toLowerCase().trim() === targetVaccine.toLowerCase().trim()) {
      return prod;
    }
    if (vaccineService.matchVaccineName(prod).canonical.toLowerCase() === targetCanonical) {
      return prod;
    }
  }

  return targetVaccine;
}

// Facility status uses the same balance and distribution rule as the Blueprint UI.
function getFacilityBlueprintStatus(
  row: any,
  productList: string[] = DEFAULT_BLUEPRINT_PRODUCTS
): 'completed' | 'in_progress' | 'pending' {
  return getBlueprintProgressStatus(row, productList);
}

function findBlueprintSheetForFacility(facility: any): any | null {
  if (!facility?.facilityName) return null;
  const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
  const facilityName = normalize(facility.facilityName);
  const matchingSheets = Object.values(blueprintDistricts).filter(sheet =>
    (sheet.rows || []).some(row => normalize(row.facility) === facilityName)
  );
  if (matchingSheets.length === 0) return null;

  const district = normalize(facility.district);
  const districtMatches = district
    ? matchingSheets.filter(sheet => normalize(sheet.district) === district)
    : matchingSheets;
  const cycle = normalize(facility.cycle);
  const cycleMatches = cycle
    ? districtMatches.filter(sheet => normalize(sheet.month) === cycle)
    : districtMatches;

  if (cycleMatches.length === 1) return cycleMatches[0];
  if (districtMatches.length === 1) return districtMatches[0];
  if (matchingSheets.length === 1) return matchingSheets[0];
  return null;
}

// Helper: Continuously sync all districts and their 67-column sheets into the order checking engine
function syncAllBlueprintDistrictsToService() {
  const allFlatRows: any[] = [];

  for (const [distId, distSheet] of Object.entries(blueprintDistricts)) {
    const targetDistrict = distSheet.district || 'General District';
    const targetMonth = distSheet.month || 'September 2026';
    const targetRows = distSheet.rows || [];

    for (const r of targetRows) {
      if (!r.facility || !r.facility.trim()) continue;
      const facName = r.facility.trim();
      const sub = r.subDistrict || 'General';
      const vaccinesObj = r.vaccines || {};

      // Consolidate any duplicate or alias vaccine keys per facility row
      const consolidatedVaccines: Record<string, { carryOver: number; allocation: number; distributed: number; balance?: number; takenHistory?: string }> = {};

      for (const [vName, vData] of Object.entries(vaccinesObj)) {
        const d: any = vData || {};
        const alloc = Number(d.allocation);
        const carry = Number(d.carryOver);
        const dist = Number(d.distributed);
        const hasNumbers = !isNaN(alloc) || !isNaN(carry) || !isNaN(dist) || (d.balance !== undefined && d.balance !== '');

        if (hasNumbers) {
          const carryNum = isNaN(carry) ? 0 : carry;
          const allocNum = isNaN(alloc) ? 0 : alloc;
          const distNum = isNaN(dist) ? 0 : dist;
          const balNum = (d.balance !== undefined && d.balance !== '' && !isNaN(Number(d.balance)))
            ? Number(d.balance)
            : Math.max(0, carryNum + allocNum - distNum);

          const canonical = vaccineService.matchVaccineName(vName).canonical;

          if (!consolidatedVaccines[canonical]) {
            consolidatedVaccines[canonical] = {
              carryOver: carryNum,
              allocation: allocNum,
              distributed: distNum,
              balance: balNum,
              takenHistory: d.takenHistory
            };
          } else {
            const existing = consolidatedVaccines[canonical];
            existing.carryOver = Math.max(existing.carryOver, carryNum);
            existing.allocation = Math.max(existing.allocation, allocNum);
            existing.distributed = Math.max(existing.distributed, distNum);
            existing.balance = balNum !== undefined ? balNum : Math.max(0, existing.carryOver + existing.allocation - existing.distributed);
            if (d.takenHistory) existing.takenHistory = d.takenHistory;
          }
        }
      }

      for (const [vCanonical, vVals] of Object.entries(consolidatedVaccines)) {
        allFlatRows.push({
          facility: facName,
          subDistrict: sub,
          district: targetDistrict,
          tabName: `${targetDistrict} Allocation`,
          cycle: targetMonth,
          vaccine: vCanonical,
          carryOver: vVals.carryOver,
          allocation: vVals.allocation,
          taken: vVals.distributed,
          remaining: vVals.balance !== undefined ? vVals.balance : Math.max(0, vVals.carryOver + vVals.allocation - vVals.distributed),
          takenHistory: vVals.takenHistory
        });
      }
    }
  }

  vaccineService.syncAllDistrictsToFacilities(allFlatRows, 'Blueprint 67-Col Multi-District');
}

// Initial sync on server boot across all districts so Order Checking is immediately live
try {
  syncAllBlueprintDistrictsToService();
} catch (e) {
  console.warn('Initial multi-district blueprint sync:', e);
}

// Load persistent blueprint districts/months from Firestore on startup
async function loadDistrictsFromFirestore() {
  try {
    const db = getFirestoreDb();
    const snap = await getDocs(collection(db, 'vaccine_districts'));
    if (!snap.empty) {
      snap.forEach(docSnap => {
        const data = docSnap.data() as DistrictSheetData;
        if (data && data.id) {
          blueprintDistricts[data.id] = data;
        }
      });

      // Ensure standard baseline facilities (like Konkoma SDA Clinic) are always accessible for auditing presets
      const wm = blueprintDistricts['west_mamprusi'];
      if (wm && Array.isArray(wm.rows) && !wm.rows.some(r => r.facility && r.facility.toLowerCase().includes('konkoma'))) {
        const defaultKonkoma = DEFAULT_DISTRICT_SHEETS['west_mamprusi']?.rows?.find(r => r.facility?.toLowerCase().includes('konkoma'));
        if (defaultKonkoma) {
          wm.rows.push(JSON.parse(JSON.stringify(defaultKonkoma)));
        }
      }

      if (!blueprintDistricts[activeDistrictId]) {
        activeDistrictId = Object.keys(blueprintDistricts)[0] || 'west_mamprusi';
      }
      syncAllBlueprintDistrictsToService();
      console.log(`[Firestore] Successfully loaded ${snap.size} allocation sheets from Firestore`);
    }
  } catch (err) {
    console.warn('[Firestore] Initial blueprint load notice:', err);
  }
}
loadDistrictsFromFirestore();

// GET all blueprint district sheets
app.get('/api/vaccine/blueprint-districts', (req, res) => {
  try {
    return res.json({
      districts: Object.values(blueprintDistricts),
      activeDistrictId,
      products: DEFAULT_BLUEPRINT_PRODUCTS
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ADD A NEW ALLOCATION MONTH FOR A DISTRICT (OR ALL DISTRICTS) WITH AUTOMATIC BALANCE ROLLOVER
app.post('/api/vaccine/blueprint-months/add', async (req, res) => {
  try {
    const {
      month,
      scope = 'current', // 'current' or 'all'
      districtId,
      baseSheetId,
      carryOverBalances = true,
      copyFacilities = true
    } = req.body;

    if (!month || !month.trim()) {
      return res.status(400).json({ error: 'Month name is required (e.g. October 2026)' });
    }

    const cleanMonth = month.trim();
    const targetBaseId = baseSheetId || districtId || activeDistrictId;
    const baseSheet = blueprintDistricts[targetBaseId] || Object.values(blueprintDistricts)[0];
    if (!baseSheet) {
      return res.status(404).json({ error: 'Base district allocation sheet not found' });
    }

    const targets: DistrictSheetData[] = [];
    if (scope === 'all') {
      // Find one active/latest sheet for each distinct district name
      const uniqueDistricts = new Map<string, DistrictSheetData>();
      for (const d of Object.values(blueprintDistricts)) {
        uniqueDistricts.set(d.district, d);
      }
      targets.push(...Array.from(uniqueDistricts.values()));
    } else {
      targets.push(baseSheet);
    }

    let newlyActiveId = '';

    for (const src of targets) {
      const distName = src.district;
      const distSlug = distName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const monthSlug = cleanMonth.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      let newSheetId = `${distSlug}_${monthSlug}`;
      let c = 1;
      while (blueprintDistricts[newSheetId]) {
        newSheetId = `${distSlug}_${monthSlug}_${c++}`;
      }

      let newRows: any[] = [];
      if (copyFacilities && Array.isArray(src.rows) && src.rows.length > 0) {
        newRows = src.rows.map((r, rIdx) => {
          const newVaccines: Record<string, any> = {};
          if (r.vaccines) {
            for (const [vName, vData] of Object.entries(r.vaccines)) {
              const vd: any = vData || {};
              const carry = Number(vd.carryOver) || 0;
              const alloc = Number(vd.allocation) || 0;
              const dist = Number(vd.distributed) || 0;
              const prevBal = (vd.balance !== undefined && vd.balance !== '' && !isNaN(Number(vd.balance)))
                ? Number(vd.balance)
                : (carry + alloc - dist);

              if (carryOverBalances) {
                // Ending balance of prev month becomes the starting stock (carryOver) for new month!
                const newCarry = Math.max(0, prevBal);
                newVaccines[vName] = {
                  carryOver: newCarry,
                  allocation: 0,
                  distributed: 0,
                  balance: newCarry
                };
              } else {
                newVaccines[vName] = {
                  carryOver: 0,
                  allocation: 0,
                  distributed: 0,
                  balance: 0
                };
              }
            }
          }

          return {
            id: `bp_${newSheetId}_${rIdx + 1}`,
            processing: '', // Reset start date for fresh distribution cycle
            completed: '',  // Reset completion date
            facility: r.facility || '',
            subDistrict: r.subDistrict || '',
            vaccines: newVaccines
          };
        });
      } else {
        newRows = Array.from({ length: 5 }, (_, idx) => ({
          id: `bp_${newSheetId}_${idx + 1}`,
          processing: '',
          completed: '',
          facility: '',
          subDistrict: '',
          vaccines: {}
        }));
      }

      const newDistrictSheet: DistrictSheetData = {
        id: newSheetId,
        district: distName,
        month: cleanMonth,
        products: src.products ? [...src.products] : [...DEFAULT_BLUEPRINT_PRODUCTS],
        rows: newRows,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      blueprintDistricts[newSheetId] = newDistrictSheet;
      if (!newlyActiveId || src.id === targetBaseId) {
        newlyActiveId = newSheetId;
      }

      // Persist to Cloud Firestore
      try {
        const db = getFirestoreDb();
        await setDoc(doc(db, 'vaccine_districts', newSheetId), cleanFirestorePayload(newDistrictSheet), { merge: true });
      } catch (fErr) {
        console.warn(`Firestore save error for new month sheet ${newSheetId}:`, fErr);
      }
    }

    if (newlyActiveId) {
      activeDistrictId = newlyActiveId;
    }

    syncAllBlueprintDistrictsToService();

    return res.json({
      success: true,
      message: `Created "${cleanMonth}" allocation sheet with automated stock rollover!`,
      districts: Object.values(blueprintDistricts),
      activeDistrictId,
      district: blueprintDistricts[activeDistrictId],
      facilities: vaccineService.getAllFacilities()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ADD a new district with the exact same 67-column sheet structure
app.post('/api/vaccine/blueprint-districts/add', async (req, res) => {
  try {
    const { districtName, month, template, customFacilities } = req.body;
    if (!districtName || !districtName.trim()) {
      return res.status(400).json({ error: 'District name is required' });
    }

    const cleanName = districtName.trim();
    const rawId = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    let distId = rawId || `district_${Date.now()}`;
    let counter = 1;
    while (blueprintDistricts[distId]) {
      distId = `${rawId}_${counter++}`;
    }

    const targetMonth = month?.trim() || blueprintDistricts[activeDistrictId]?.month || 'September 2026';

    // Generate rows with the same 67-column structure
    let initialRows: any[] = [];
    if (Array.isArray(customFacilities) && customFacilities.length > 0) {
      initialRows = customFacilities.map((fac, idx) => ({
        id: `bp_${distId}_${idx + 1}`,
        processing: 'Pending',
        completed: '',
        facility: String(fac).trim(),
        subDistrict: cleanName,
        vaccines: {}
      }));
    } else if (template === 'sample') {
      // 5 sample facilities for this district
      initialRows = [
        `${cleanName} District Hospital`,
        `${cleanName} North Health Centre`,
        `${cleanName} South Health Centre`,
        `${cleanName} Polyclinic`,
        `${cleanName} Community Clinic`
      ].map((fac, idx) => ({
        id: `bp_${distId}_${idx + 1}`,
        processing: idx === 0 ? 'In Progress' : 'Pending',
        completed: '',
        facility: fac,
        subDistrict: `${cleanName} Sub`,
        vaccines: {
          'BCG': { carryOver: 10, allocation: 60, distributed: 15, balance: 55 },
          'OPV': { carryOver: 15, allocation: 80, distributed: 20, balance: 75 },
          'MR': { carryOver: 8, allocation: 40, distributed: 10, balance: 38 },
          'PENTA': { carryOver: 10, allocation: 60, distributed: 15, balance: 55 }
        }
      }));
    } else {
      // Blank 5 rows ready for editing
      initialRows = Array.from({ length: 5 }, (_, idx) => ({
        id: `bp_${distId}_${idx + 1}`,
        processing: 'Pending',
        completed: '',
        facility: '',
        subDistrict: '',
        vaccines: {}
      }));
    }

    const newSheet: DistrictSheetData = {
      id: distId,
      district: cleanName,
      month: targetMonth,
      products: [...DEFAULT_BLUEPRINT_PRODUCTS],
      rows: initialRows,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    blueprintDistricts[distId] = newSheet;
    activeDistrictId = distId;

    // Always sync automatically to vaccine checker
    syncAllBlueprintDistrictsToService();

    // Persist to Firestore in background
    try {
      const db = getFirestoreDb();
      await setDoc(doc(db, 'vaccine_districts', distId), cleanFirestorePayload(newSheet), { merge: true });
    } catch (fErr) {
      console.warn('Background Firestore sync for new district:', fErr);
    }

    return res.json({
      success: true,
      district: newSheet,
      districts: Object.values(blueprintDistricts),
      activeDistrictId,
      facilities: vaccineService.getAllFacilities()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// UPDATE district sheet (or active district selection) and ALWAYS sync to vaccine checker
app.post('/api/vaccine/blueprint-districts', async (req, res) => {
  try {
    const { district, districts, activeId } = req.body;

    if (activeId && blueprintDistricts[activeId]) {
      activeDistrictId = activeId;
    }

    if (district && district.id) {
      blueprintDistricts[district.id] = {
        ...blueprintDistricts[district.id],
        ...district,
        updatedAt: new Date().toISOString()
      };
      activeDistrictId = district.id;
    }

    if (Array.isArray(districts)) {
      for (const d of districts) {
        if (d && d.id) {
          blueprintDistricts[d.id] = {
            ...blueprintDistricts[d.id],
            ...d,
            updatedAt: new Date().toISOString()
          };
        }
      }
    }

    // Always sync all blueprint districts to vaccine checker
    syncAllBlueprintDistrictsToService();

    // Log recent cell edits if client passed them
    if (Array.isArray(req.body.cellEdits) && req.body.cellEdits.length > 0) {
      try {
        const actor = getActiveActor(req.body.user);
        for (const edit of req.body.cellEdits) {
          const rec = activityService.logActivity({
            module: 'vaccine_blueprint',
            actionType: 'blueprint_cell_edit',
            title: `Blueprint Cell Edit: ${edit.facility} - ${edit.product || edit.field}`,
            summary: `${actor.name} (${actor.role.toUpperCase()}) updated ${edit.facility} [${edit.product ? `${edit.product} ` : ''}${edit.field}] from ${edit.oldValue ?? 'empty'} to ${edit.newValue}.`,
            actor,
            facility: edit.facility,
            district: edit.district || district?.district,
            cycle: edit.month || district?.month,
            badgeType: 'purple',
            details: {
              product: edit.product,
              field: edit.field,
              oldValue: edit.oldValue,
              newValue: edit.newValue,
              diff: edit.diff
            }
          });
          persistActivityLogToFirestore(rec);
        }
      } catch (logErr) {
        console.warn('Activity logging for cellEdits warning:', logErr);
      }
    }

    // Background Firestore persist
    try {
      const db = getFirestoreDb();
      if (district && district.id) {
        await setDoc(doc(db, 'vaccine_districts', district.id), cleanFirestorePayload(blueprintDistricts[district.id]), { merge: true });
      }
    } catch (fErr) {
      console.warn('Background Firestore sync for district update:', fErr);
    }

    return res.json({
      success: true,
      districts: Object.values(blueprintDistricts),
      activeDistrictId,
      facilities: vaccineService.getAllFacilities()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE a district (must keep at least 1)
app.delete('/api/vaccine/blueprint-districts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allKeys = Object.keys(blueprintDistricts);
    if (allKeys.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only remaining district sheet.' });
    }

    if (blueprintDistricts[id]) {
      delete blueprintDistricts[id];
      if (activeDistrictId === id) {
        activeDistrictId = Object.keys(blueprintDistricts)[0];
      }
      // Sync immediately
      syncAllBlueprintDistrictsToService();

      // Delete from Firestore
      try {
        const db = getFirestoreDb();
        await deleteDoc(doc(db, 'vaccine_districts', id));
      } catch (fErr) {
        console.warn(`Firestore delete error for district ${id}:`, fErr);
      }
    }

    return res.json({
      success: true,
      districts: Object.values(blueprintDistricts),
      activeDistrictId,
      facilities: vaccineService.getAllFacilities()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// RENAME a district
app.patch('/api/vaccine/blueprint-districts/:id/rename', async (req, res) => {
  try {
    const { id } = req.params;
    const { newDistrictName } = req.body;
    if (!newDistrictName || !newDistrictName.trim()) {
      return res.status(400).json({ error: 'New district name is required' });
    }

    const dist = blueprintDistricts[id];
    if (!dist) {
      return res.status(404).json({ error: 'District not found' });
    }

    dist.district = newDistrictName.trim();
    dist.updatedAt = new Date().toISOString();

    syncAllBlueprintDistrictsToService();

    return res.json({
      success: true,
      district: dist,
      districts: Object.values(blueprintDistricts),
      activeDistrictId
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// SYNC all blueprint districts directly to vaccine checker
app.post('/api/vaccine/blueprint-districts/sync', (req, res) => {
  try {
    syncAllBlueprintDistrictsToService();
    return res.json({
      success: true,
      message: 'All blueprint districts successfully synced to Vaccine Checker',
      districtsCount: Object.keys(blueprintDistricts).length,
      facilities: vaccineService.getAllFacilities()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// CLEAR blueprint data (for the active district or across all districts)
app.post('/api/vaccine/blueprint-districts/clear', async (req, res) => {
  try {
    const { scope = 'current', districtId } = req.body;
    const targetDistrictId = districtId || activeDistrictId;

    const generateBlankRows = (dId: string) => {
      return Array.from({ length: 5 }, (_, idx) => ({
        id: `bp_${dId}_${idx + 1}`,
        processing: '',
        completed: '',
        facility: '',
        subDistrict: '',
        vaccines: {}
      }));
    };

    if (scope === 'all') {
      for (const dId of Object.keys(blueprintDistricts)) {
        blueprintDistricts[dId].rows = generateBlankRows(dId);
        blueprintDistricts[dId].updatedAt = new Date().toISOString();
        try {
          const db = getFirestoreDb();
          await setDoc(doc(db, 'vaccine_districts', dId), cleanFirestorePayload(blueprintDistricts[dId]), { merge: true });
        } catch (fErr) {
          console.warn(`Firestore clear sync error for district ${dId}:`, fErr);
        }
      }
    } else {
      if (blueprintDistricts[targetDistrictId]) {
        blueprintDistricts[targetDistrictId].rows = generateBlankRows(targetDistrictId);
        blueprintDistricts[targetDistrictId].updatedAt = new Date().toISOString();
        try {
          const db = getFirestoreDb();
          await setDoc(doc(db, 'vaccine_districts', targetDistrictId), cleanFirestorePayload(blueprintDistricts[targetDistrictId]), { merge: true });
        } catch (fErr) {
          console.warn(`Firestore clear sync error for district ${targetDistrictId}:`, fErr);
        }
      }
    }

    syncAllBlueprintDistrictsToService();

    return res.json({
      success: true,
      scope,
      districts: Object.values(blueprintDistricts),
      activeDistrictId,
      district: blueprintDistricts[targetDistrictId] || Object.values(blueprintDistricts)[0],
      facilities: vaccineService.getAllFacilities(),
      message: scope === 'all'
        ? 'All data across all blueprint districts has been cleared.'
        : `All allocation data for district "${blueprintDistricts[targetDistrictId]?.district || targetDistrictId}" has been cleared.`
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Backwards-compatible single-district endpoints mapping to the active district
app.get('/api/vaccine/blueprint-sheet', (req, res) => {
  try {
    const active = blueprintDistricts[activeDistrictId] || Object.values(blueprintDistricts)[0];
    return res.json(active);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/vaccine/blueprint-sheet', (req, res) => {
  try {
    const { district, month, products, rows } = req.body;
    const target = blueprintDistricts[activeDistrictId] || Object.values(blueprintDistricts)[0];
    if (district !== undefined) target.district = district;
    if (month !== undefined) target.month = month;
    if (Array.isArray(products)) target.products = products;
    if (Array.isArray(rows)) target.rows = rows;
    target.updatedAt = new Date().toISOString();

    syncAllBlueprintDistrictsToService();

    return res.json({
      success: true,
      state: target,
      districts: Object.values(blueprintDistricts),
      activeDistrictId,
      facilities: vaccineService.getAllFacilities()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/vaccine/blueprint-sheet/sync', (req, res) => {
  try {
    syncAllBlueprintDistrictsToService();
    return res.json({
      success: true,
      facilities: vaccineService.getAllFacilities()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// START FACILITY: Automatically record start date & set to in-progress
app.post('/api/vaccine/blueprint/start-facility', async (req, res) => {
  try {
    const { facilityId, facilityName, districtId, date } = req.body;
    const startDate = date || new Date().toISOString().slice(0, 10);
    let updatedRow: any = null;
    let targetDist: any = null;

    const queryName = (facilityName || '').toLowerCase().trim();
    for (const distSheet of Object.values(blueprintDistricts)) {
      if (districtId && distSheet.id !== districtId) continue;
      const bpRow = distSheet.rows.find(
        r => (facilityId && r.id === facilityId) || 
             (queryName && r.facility && r.facility.toLowerCase().trim() === queryName)
      );
      if (bpRow) {
        const products = distSheet.products || DEFAULT_BLUEPRINT_PRODUCTS;
        const progressStatus = getFacilityBlueprintStatus(bpRow, products);
        if (progressStatus === 'in_progress') {
          const currentProc = (bpRow.processing || '').trim();
          if (!currentProc || currentProc.toLowerCase().includes('pending') || currentProc.toLowerCase().includes('completed')) {
            bpRow.processing = startDate;
          }
          bpRow.completed = '';
        } else if (progressStatus === 'completed') {
          bpRow.completed = bpRow.completed || startDate;
        } else {
          bpRow.processing = '';
          bpRow.completed = '';
        }
        distSheet.updatedAt = new Date().toISOString();
        updatedRow = bpRow;
        targetDist = distSheet;
        break;
      }
    }

    if (targetDist) {
      syncAllBlueprintDistrictsToService();
      try {
        const db = getFirestoreDb();
        await setDoc(doc(db, 'vaccine_districts', targetDist.id), cleanFirestorePayload(targetDist), { merge: true });
      } catch (e) {
        console.warn('Firestore sync failed for start-facility:', e);
      }
    }

    if (updatedRow) {
      try {
        const actor = getActiveActor(req.body.user);
        const rec = activityService.logActivity({
          module: 'vaccine_blueprint',
          actionType: 'blueprint_status_change',
          title: `Facility Processing Started: ${updatedRow.facility}`,
          summary: `${actor.name} (${actor.role.toUpperCase()}) recorded ${updatedRow.facility} dispatch process started on ${startDate}.`,
          actor,
          facility: updatedRow.facility,
          district: targetDist?.district,
          cycle: targetDist?.month,
          badgeType: 'info',
          details: { field: 'processing', newValue: startDate }
        });
        persistActivityLogToFirestore(rec);
      } catch (actErr) {
        console.warn('Activity log for start-facility warning:', actErr);
      }
    }

    return res.json({ success: true, row: updatedRow, startDate, district: targetDist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// COMPLETE FACILITY: Automatically record completion date & highlight green
app.post('/api/vaccine/blueprint/complete-facility', async (req, res) => {
  try {
    const { facilityId, facilityName, districtId, date } = req.body;
    const completedDate = date || new Date().toISOString().slice(0, 10);
    let updatedRow: any = null;
    let targetDist: any = null;

    const queryName = (facilityName || '').toLowerCase().trim();
    for (const distSheet of Object.values(blueprintDistricts)) {
      if (districtId && distSheet.id !== districtId) continue;
      const bpRow = distSheet.rows.find(
        r => (facilityId && r.id === facilityId) || 
             (queryName && r.facility && r.facility.toLowerCase().trim() === queryName)
      );
      if (bpRow) {
        const productList = Array.isArray(distSheet.products) && distSheet.products.length > 0
          ? distSheet.products
          : DEFAULT_BLUEPRINT_PRODUCTS;
        if (getFacilityBlueprintStatus(bpRow, productList) !== 'completed') {
          return res.status(409).json({
            error: 'Facility cannot be completed while any vaccine balance remains.',
            status: getFacilityBlueprintStatus(bpRow, productList)
          });
        }

        // Preserve recorded distributions; completion dates follow zero balances.
        const currentProc = (bpRow.processing || '').trim();
        if (!currentProc || currentProc.toLowerCase().includes('pending')) {
          bpRow.processing = completedDate;
        }
        bpRow.completed = completedDate;
        distSheet.updatedAt = new Date().toISOString();
        updatedRow = bpRow;
        targetDist = distSheet;
        break;
      }
    }

    if (targetDist) {
      syncAllBlueprintDistrictsToService();
      try {
        const db = getFirestoreDb();
        await setDoc(doc(db, 'vaccine_districts', targetDist.id), cleanFirestorePayload(targetDist), { merge: true });
      } catch (e) {
        console.warn('Firestore sync failed for complete-facility:', e);
      }
    }

    if (updatedRow) {
      try {
        const actor = getActiveActor(req.body.user);
        const rec = activityService.logActivity({
          module: 'vaccine_blueprint',
          actionType: 'blueprint_status_change',
          title: `Facility Allocation Completed: ${updatedRow.facility}`,
          summary: `${actor.name} (${actor.role.toUpperCase()}) marked ${updatedRow.facility} allocation completed on ${completedDate}. All quotas distributed.`,
          actor,
          facility: updatedRow.facility,
          district: targetDist?.district,
          cycle: targetDist?.month,
          badgeType: 'success',
          details: { field: 'completed', newValue: completedDate }
        });
        persistActivityLogToFirestore(rec);
      } catch (actErr) {
        console.warn('Activity log for complete-facility warning:', actErr);
      }
    }

    return res.json({ success: true, row: updatedRow, completedDate, district: targetDist });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// USER ROLES & RBAC MANAGEMENT
// ==========================================

interface UserRoleItem {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'warehouse' | 'cca' | 'auditor' | 'dco';
  district: string;
  createdAt: string;
  updatedAt?: string;
  addedBy?: string;
}

const DEFAULT_USER_ROLES: UserRoleItem[] = [
  {
    id: 'ohenedarko2014_gmail_com',
    email: 'ohenedarko2014@gmail.com',
    name: 'Mary Alhassan',
    role: 'admin',
    district: 'All Districts',
    createdAt: new Date().toISOString(),
    addedBy: 'System Bootstrap'
  },
  {
    id: 'warehouse_fulfillment_team',
    email: 'warehouse.team@zipline.com',
    name: 'Warehouse Team Lead',
    role: 'warehouse',
    district: 'All Hubs / Warehouses',
    createdAt: new Date().toISOString(),
    addedBy: 'Mary Alhassan'
  },
  {
    id: 'cca_advocate_zipline',
    email: 'cca.team@zipline.com',
    name: 'Ghana CCC Team',
    role: 'cca',
    district: 'All Districts',
    createdAt: new Date().toISOString(),
    addedBy: 'Mary Alhassan'
  },
  {
    id: 'auditor_compliance',
    email: 'auditor.lead@zipline.com',
    name: 'Compliance Auditor',
    role: 'auditor',
    district: 'All Districts',
    createdAt: new Date().toISOString(),
    addedBy: 'Mary Alhassan'
  }
];

let userRolesList: UserRoleItem[] = JSON.parse(JSON.stringify(DEFAULT_USER_ROLES));
let activeRoleId: string = 'ohenedarko2014_gmail_com';

async function initUserRolesFromFirestore() {
  try {
    const db = getFirestoreDb();
    const snap = await getDocs(collection(db, 'user_roles'));
    if (!snap.empty) {
      const loaded: UserRoleItem[] = [];
      for (const docSnap of snap.docs) {
        const d = docSnap.data() as any;
        const item: UserRoleItem = { ...d, id: docSnap.id };

        // Normalize administrator name to Mary Alhassan for ohenedarko2014@gmail.com
        if (item.email.toLowerCase() === 'ohenedarko2014@gmail.com') {
          item.name = 'Mary Alhassan';
          item.role = 'admin';
          await setDoc(doc(db, 'user_roles', item.id), item, { merge: true }).catch(() => {});
        }

        // Replace DCO with Warehouse Team
        if ((item.role as any) === 'dco' || item.id === 'dco_officer_north') {
          item.role = 'warehouse';
          if (item.name.toLowerCase().includes('dco')) {
            item.name = 'Warehouse Team Lead';
          }
          await setDoc(doc(db, 'user_roles', item.id), item, { merge: true }).catch(() => {});
        }

        loaded.push(item);
      }

      const hasAdmin = loaded.some(u => u.email.toLowerCase() === 'ohenedarko2014@gmail.com');
      if (!hasAdmin) {
        loaded.unshift(DEFAULT_USER_ROLES[0]);
      }

      const hasWarehouse = loaded.some(u => u.role === 'warehouse');
      if (!hasWarehouse) {
        loaded.splice(1, 0, DEFAULT_USER_ROLES[1]);
        await setDoc(doc(db, 'user_roles', DEFAULT_USER_ROLES[1].id), DEFAULT_USER_ROLES[1], { merge: true }).catch(() => {});
      }

      userRolesList = loaded;
      console.log(`Loaded ${userRolesList.length} user roles from Firestore.`);
    } else {
      for (const u of DEFAULT_USER_ROLES) {
        await setDoc(doc(db, 'user_roles', u.id), u, { merge: true });
      }
      console.log('Seeded default user roles to Firestore collection "user_roles".');
    }
  } catch (err) {
    console.warn('Firestore roles sync warning:', err);
  }
}

initUserRolesFromFirestore();

// Helper to determine the active individual who is performing an action or edit
function getActiveActor(customActor?: any) {
  if (customActor && typeof customActor === 'object' && (customActor.name || customActor.email)) {
    const actor: any = {
      id: customActor.id || 'custom_user',
      name: customActor.name || 'Team Member',
      email: customActor.email || 'team@flyzipline.com',
      role: customActor.role || 'cca',
      district: customActor.district || 'All Districts'
    };
    if (customActor.avatar) {
      actor.avatar = customActor.avatar;
    }
    return actor;
  }
  if (typeof customActor === 'string' && customActor.trim()) {
    const trimmed = customActor.trim();
    const found = userRolesList.find(
      r => r.name.toLowerCase() === trimmed.toLowerCase() || r.email.toLowerCase() === trimmed.toLowerCase()
    );
    if (found) {
      const actor: any = {
        id: found.id,
        name: found.name,
        email: found.email,
        role: found.role,
        district: found.district
      };
      if ((found as any).avatar) {
        actor.avatar = (found as any).avatar;
      }
      return actor;
    }
    return {
      id: 'custom_operator',
      name: trimmed,
      email: `${trimmed.toLowerCase().replace(/[^a-z0-9]/g, '.')}@flyzipline.com`,
      role: 'cca',
      district: 'All Districts'
    };
  }
  const current = userRolesList.find(r => r.id === activeRoleId) || userRolesList[0];
  const actor: any = {
    id: current.id,
    name: current.name,
    email: current.email,
    role: current.role,
    district: current.district
  };
  if ((current as any).avatar) {
    actor.avatar = (current as any).avatar;
  }
  return actor;
}

// Hydrate persistent activity logs from Firestore on startup
async function initActivityLogsFromFirestore() {
  try {
    const db = getFirestoreDb();
    const q = query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(150));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      snapshot.forEach(docSnap => {
        const d = docSnap.data() as any;
        if (d && d.id) {
          activityService.logActivity({ ...d });
        }
      });
      console.log(`Loaded ${snapshot.size} activity logs from Firestore.`);
    }
  } catch (err) {
    console.warn('Firestore activity logs sync warning:', err);
  }
}

initActivityLogsFromFirestore();

// GET all roles and current active profile
app.get('/api/roles', (req, res) => {
  try {
    const activeUser = userRolesList.find(r => r.id === activeRoleId) || userRolesList[0];
    return res.json({
      roles: userRolesList,
      activeRoleId,
      activeUser
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET current active user role
app.get('/api/roles/current', (req, res) => {
  try {
    const activeUser = userRolesList.find(r => r.id === activeRoleId) || userRolesList[0];
    return res.json(activeUser);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Switch active operating identity/role
app.post('/api/roles/switch', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'User role id is required.' });
    }
    const found = userRolesList.find(r => r.id === id);
    if (!found) {
      return res.status(404).json({ error: `User with id "${id}" not found.` });
    }
    activeRoleId = id;

    // Log identity switch in audit trail
    const rec = activityService.logActivity({
      module: 'app_system',
      actionType: 'role_switched',
      title: `Operating Identity Switched: ${found.name}`,
      summary: `Operating user session switched to ${found.name} (${found.role.toUpperCase()}) [${found.district || 'All Districts'}].`,
      actor: getActiveActor(found),
      badgeType: 'purple'
    });
    persistActivityLogToFirestore(rec);

    return res.json({
      success: true,
      activeRoleId,
      activeUser: found
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Add or update a user role
app.post('/api/roles', async (req, res) => {
  try {
    const { email, name, role, district = 'All Districts', addedBy } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Valid email is required to assign a role.' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Display name is required.' });
    }
    const validRoles = ['admin', 'warehouse', 'cca', 'auditor', 'dco'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
    }

    const cleanEmail = email.trim().toLowerCase();
    const docId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
    const existingIndex = userRolesList.findIndex(r => r.id === docId || r.email.toLowerCase() === cleanEmail);

    const roleDoc: UserRoleItem = {
      id: docId,
      email: cleanEmail,
      name: name.trim(),
      role,
      district: district || 'All Districts',
      createdAt: existingIndex >= 0 ? userRolesList[existingIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      addedBy: addedBy || userRolesList.find(r => r.id === activeRoleId)?.name || 'Administrator'
    };

    if (existingIndex >= 0) {
      userRolesList[existingIndex] = roleDoc;
    } else {
      userRolesList.push(roleDoc);
    }

    // Persist immediately to Firestore
    try {
      const db = getFirestoreDb();
      await setDoc(doc(db, 'user_roles', docId), cleanFirestorePayload(roleDoc), { merge: true });
    } catch (fErr) {
      console.warn('Firestore role save warning:', fErr);
    }

    return res.json({
      success: true,
      role: roleDoc,
      roles: userRolesList,
      activeRoleId
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete a user role
app.delete('/api/roles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'ohenedarko2014_gmail_com') {
      return res.status(400).json({ error: 'Primary system administrator cannot be deleted.' });
    }
    userRolesList = userRolesList.filter(r => r.id !== id);
    if (activeRoleId === id) {
      activeRoleId = userRolesList[0]?.id || 'ohenedarko2014_gmail_com';
    }

    try {
      const db = getFirestoreDb();
      await deleteDoc(doc(db, 'user_roles', id));
    } catch (fErr) {
      console.warn('Firestore role delete warning:', fErr);
    }

    return res.json({
      success: true,
      roles: userRolesList,
      activeRoleId
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update Unrelieved Top-up for a facility and vaccine
app.post('/api/vaccine/allocations/:facilityId/topup', async (req, res) => {
  try {
    const { facilityId } = req.params;
    const { vaccine, topUp, user, unit } = req.body;
    if (!facilityId || !vaccine) {
      return res.status(400).json({ error: 'facilityId and vaccine are required.' });
    }
    const result = vaccineService.updateVaccineTopUp(facilityId, vaccine, Number(topUp) || 0, user, unit || 'vials');
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update Facility Metadata (Facility Name, District, Sub-District)
app.patch('/api/vaccine/facilities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { facilityName, district, subDistrict, tabName, nest } = req.body;
    const result = vaccineService.updateFacilityDetails(id, { facilityName, district, subDistrict, tabName, nest });
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Add or initialize a new vaccine product for a facility
app.post('/api/vaccine/facilities/:id/vaccines', async (req, res) => {
  try {
    const { id } = req.params;
    const { vaccineName, original, carryOver, topUp, dosesPerVial, unit } = req.body;
    if (!vaccineName) {
      return res.status(400).json({ error: 'vaccineName is required.' });
    }
    const result = vaccineService.addVaccineProductToFacility(id, vaccineName, {
      original: Number(original) || 0,
      carryOver: Number(carryOver) || 0,
      topUp: Number(topUp) || 0,
      dosesPerVial: dosesPerVial ? Number(dosesPerVial) : undefined,
      unit
    });
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Validate Vaccine Order: WhatsApp <-> FS Confirmation <-> Remaining Allocation
app.post('/api/vaccine/validate', async (req, res) => {
  try {
    let { facilityId, orderSource, whatsappMessage, fulfillmentConfirmation, directItems } = req.body;

    // Ensure fresh sync from live Allocation Blueprint sheets
    syncAllBlueprintDistrictsToService();

    // Auto-detect facility if not provided or set to auto
    if (!facilityId || facilityId === 'auto') {
      const textToExtract = orderSource === 'fs_only' ? fulfillmentConfirmation : (whatsappMessage || fulfillmentConfirmation);
      const extractedFacName = vaccineService.extractFacilityFromText(textToExtract);
      if (extractedFacName) {
        const match = vaccineService.getFacilityByName(extractedFacName);
        if (match) {
          facilityId = match.id;
        }
      }
    }

    if (!facilityId) {
      return res.status(400).json({
        error: 'Facility ID is required, or please include the facility name in your FS confirmation message (e.g. "Facility: Walewale District Hospital").'
      });
    }

    const result = vaccineService.validateVaccineOrder({
      facilityId,
      orderSource: orderSource || 'whatsapp',
      whatsappMessage: whatsappMessage || '',
      fulfillmentConfirmation: fulfillmentConfirmation || '',
      directItems
    });

    // Validation is read-only for allocation progress; only confirmed distribution changes status.

    // Log verification to audit activity trail
    try {
      const actor = getActiveActor(req.body.ccaUser || req.body.user);
      const isGreen = result.isValid;
      const rec = activityService.logActivity({
        module: 'vaccine_checker',
        actionType: 'checker_order_verified',
        title: `Order Audit ${isGreen ? 'Verified' : 'Blocked'}: ${result.facilitySelected}`,
        summary: isGreen
          ? `${actor.name} (${actor.role.toUpperCase()}) verified order against DCO monthly quota: 🟢 GREEN LIGHT. All items within allocation limits.`
          : `${actor.name} (${actor.role.toUpperCase()}) checked order: 🔴 DO NOT PROCESS. ${result.errors.length} allocation limit issues detected.`,
        actor,
        facility: result.facilitySelected,
        district: result.district,
        cycle: result.allocationSheet,
        badgeType: isGreen ? 'success' : 'error',
        details: {
          verdict: isGreen ? 'GREEN_LIGHT' : 'DO_NOT_PROCESS',
          orderSource: result.orderSource,
          errorsDetected: result.errors,
          items: result.items
        }
      });
      persistActivityLogToFirestore(rec);
    } catch (actErr) {
      console.warn('Activity log for validate error:', actErr);
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Concurrency-Safe Final Confirmation & Automatic Blueprint Update
app.post('/api/vaccine/confirm', async (req, res) => {
  try {
    const { facilityId, orderSource, items, ccaUser, orderId, rawOrderText, rawFsText } = req.body;
    if (!facilityId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Facility ID and valid order items are required.' });
    }

    // Resolve the authoritative blueprint row before deducting anything.
    syncAllBlueprintDistrictsToService();
    const facilityBeforeConfirm = vaccineService.getFacilityById(facilityId);
    if (!facilityBeforeConfirm) {
      return res.status(404).json({ error: 'Facility allocation was not found. Refresh and try again.' });
    }
    const targetDist = findBlueprintSheetForFacility(facilityBeforeConfirm);
    if (!targetDist) {
      return res.status(409).json({ error: 'Could not uniquely match this facility and allocation cycle to a blueprint sheet. No allocation was changed.' });
    }
    const facilityName = facilityBeforeConfirm.facilityName.trim().toLowerCase();
    const bpRow = (targetDist.rows || []).find(
      (row: any) => row.facility && row.facility.trim().toLowerCase() === facilityName
    );
    if (!bpRow) {
      return res.status(409).json({ error: 'Facility row is missing from the matched allocation blueprint. No allocation was changed.' });
    }

    const result = await vaccineService.confirmVaccineOrder({
      facilityId,
      orderSource: orderSource || 'whatsapp',
      items,
      ccaUser: ccaUser || 'CCA Advocate',
      orderId,
      rawOrderText,
      rawFsText
    });

    if (!result.success || !result.updatedFacility) {
      return res.status(409).json({ error: result.error || 'The facility allocation could not be updated.' });
    }

    // Write the confirmed totals to the exact district/month blueprint row.
    if (!bpRow.vaccines) bpRow.vaccines = {};
    const productList = Array.isArray(targetDist.products) && targetDist.products.length > 0
      ? targetDist.products
      : DEFAULT_BLUEPRINT_PRODUCTS;

    for (const [vName, vAlloc] of Object.entries(result.updatedFacility.vaccines)) {
      const allocation: any = vAlloc;
      const targetKey = findMatchingVaccineKeyInBlueprint(bpRow.vaccines, vName, productList);
      if (!bpRow.vaccines[targetKey]) {
        bpRow.vaccines[targetKey] = {
          carryOver: allocation.carryOver || 0,
          allocation: allocation.original || 0,
          distributed: allocation.taken,
          balance: allocation.remaining
        };
      } else {
        bpRow.vaccines[targetKey].distributed = allocation.taken;
        bpRow.vaccines[targetKey].balance = allocation.remaining;
        if ((bpRow.vaccines[targetKey].allocation === undefined || bpRow.vaccines[targetKey].allocation === '') && allocation.original !== undefined) {
          bpRow.vaccines[targetKey].allocation = allocation.original;
        }
        if ((bpRow.vaccines[targetKey].carryOver === undefined || bpRow.vaccines[targetKey].carryOver === '') && allocation.carryOver !== undefined) {
          bpRow.vaccines[targetKey].carryOver = allocation.carryOver;
        }
      }

      // Remove duplicate aliases so a single vaccine is represented by one blueprint column.
      for (const existingKey of Object.keys(bpRow.vaccines)) {
        if (
          existingKey !== targetKey &&
          vaccineService.matchVaccineName(existingKey).canonical.toLowerCase() ===
            vaccineService.matchVaccineName(targetKey).canonical.toLowerCase()
        ) {
          delete bpRow.vaccines[existingKey];
        }
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const progressStatus = getFacilityBlueprintStatus(bpRow, productList);
    const currentProc = (bpRow.processing || '').trim();
    const hasProcessingDate = currentProc.length > 0 &&
      !currentProc.toLowerCase().includes('pending') &&
      !currentProc.toLowerCase().includes('completed');
    if (progressStatus === 'completed') {
      bpRow.processing = hasProcessingDate ? currentProc : todayStr;
      bpRow.completed = bpRow.completed || todayStr;
    } else if (progressStatus === 'in_progress') {
      bpRow.processing = hasProcessingDate ? currentProc : todayStr;
      bpRow.completed = '';
    } else {
      bpRow.processing = '';
      bpRow.completed = '';
    }
    targetDist.updatedAt = new Date().toISOString();

    // Keep the live audit ledger and the persisted blueprint sheet in sync.
    syncAllBlueprintDistrictsToService();
    try {
      const db = getFirestoreDb();
      const writes: Promise<unknown>[] = [
        setDoc(doc(db, 'vaccine_districts', targetDist.id), cleanFirestorePayload(targetDist), { merge: true }),
        setDoc(doc(db, 'vaccine_allocations', result.updatedFacility.id), cleanFirestorePayload(result.updatedFacility), { merge: true })
      ];
      if (result.transaction) {
        writes.push(setDoc(doc(db, 'vaccine_transactions', result.transaction.id), cleanFirestorePayload(result.transaction)));
      }
      const writeResults = await Promise.allSettled(writes);
      writeResults.forEach(writeResult => {
        if (writeResult.status === 'rejected') {
          console.warn('Firestore write failed after confirmed vaccine order:', writeResult.reason);
        }
      });
    } catch (fErr) {
      console.warn('Firestore sync for confirmed vaccine order:', fErr);
    }

    try {
      const actor = getActiveActor(ccaUser);
      const deductedSummary = (result.transaction?.items || [])
        .map(i => i.vaccine + ' (-' + i.currentOrder + ' v)')
        .join(', ');
      const rec = activityService.logActivity({
        module: 'vaccine_checker',
        actionType: 'checker_order_confirmed',
        title: 'Order Deduction Confirmed: ' + result.updatedFacility.facilityName,
        summary: actor.name + ' (' + actor.role.toUpperCase() + ') confirmed delivery order for ' + result.updatedFacility.facilityName + ': ' + deductedSummary + '. Balances deducted in live ledger.',
        actor,
        facility: result.updatedFacility.facilityName,
        district: result.updatedFacility.district,
        cycle: result.updatedFacility.cycle || result.updatedFacility.tabName,
        badgeType: 'success',
        details: { transactionId: result.transaction?.id, orderSource: orderSource || 'whatsapp', items: result.transaction?.items }
      });
      persistActivityLogToFirestore(rec);
    } catch (actErr) {
      console.warn('Activity log for confirm error:', actErr);
    }

    return res.json({
      ...result,
      updatedBlueprint: {
        districtId: targetDist.id,
        district: targetDist.district,
        month: targetDist.month,
        row: bpRow
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Record DCO Quota Adjustment (+/- without overwriting original historical allocation)
app.post('/api/vaccine/adjust', async (req, res) => {
  try {
    const { facilityId, vaccine, adjustment, unit, reason, user } = req.body;
    if (!facilityId || !vaccine || isNaN(adjustment)) {
      return res.status(400).json({ error: 'Facility ID, vaccine, and numeric adjustment are required.' });
    }

    const result = vaccineService.recordAllocationAdjustment({
      facilityId,
      vaccine,
      adjustment: Number(adjustment),
      unit: unit || 'vials',
      reason: reason || 'Warehouse authorized quota update',
      user: user || 'Warehouse Team'
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Persist adjustment to Firestore
    if (result.updatedFacility) {
      try {
        const db = getFirestoreDb();
        await setDoc(doc(db, 'vaccine_allocations', result.updatedFacility.id), cleanFirestorePayload(result.updatedFacility), { merge: true });
      } catch (fErr) {
        console.warn('Background Firestore sync for vaccine adjustment:', fErr);
      }
    }

    // Log quota adjustment to activity audit trail
    if (result.success && result.updatedFacility) {
      try {
        const actor = getActiveActor(user);
        const adj = (result as any).adjustment;
        const rec = activityService.logActivity({
          module: 'vaccine_checker',
          actionType: 'checker_quota_adjusted',
          title: `Quota Authorization Adjusted: ${result.updatedFacility.facilityName} - ${vaccine}`,
          summary: `${actor.name} (${actor.role.toUpperCase()}) adjusted quota for ${result.updatedFacility.facilityName} [${vaccine}]: ${adj?.previousAllocation ?? 'prev'} -> ${adj?.newAllocation ?? 'new'} (Reason: ${reason}).`,
          actor,
          facility: result.updatedFacility.facilityName,
          district: result.updatedFacility.district,
          badgeType: 'warning',
          details: {
            product: vaccine,
            oldValue: adj?.previousAllocation,
            newValue: adj?.newAllocation,
            diff: Number(adjustment) > 0 ? `+${adjustment}` : `${adjustment}`,
            metadata: { reason }
          }
        });
        persistActivityLogToFirestore(rec);
      } catch (actErr) {
        console.warn('Activity log for adjust error:', actErr);
      }
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fetch transaction history
app.get('/api/vaccine/transactions', async (req, res) => {
  try {
    const transactions = vaccineService.getTransactions();
    return res.json(transactions);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fetch adjustments history
app.get('/api/vaccine/adjustments', async (req, res) => {
  try {
    const adjustments = vaccineService.getAdjustments();
    return res.json(adjustments);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fetch product aliases
app.get('/api/vaccine/aliases', async (req, res) => {
  try {
    return res.json(vaccineService.getAliases());
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update product aliases
app.post('/api/vaccine/aliases', async (req, res) => {
  try {
    const { aliases } = req.body;
    if (!aliases || typeof aliases !== 'object') {
      return res.status(400).json({ error: 'Valid aliases dictionary required' });
    }
    const updated = vaccineService.updateAliases(aliases);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Vaccine Dashboard Metrics - synchronized with Allocation Blueprint
app.get('/api/vaccine/dashboard', async (req, res) => {
  try {
    const metrics = vaccineService.getDashboardMetrics();

    // Enrich with Blueprint multi-district metadata
    const districtValues = Object.values(blueprintDistricts);
    let totalBlueprintFacilities = 0;
    let completedFacilities = 0;
    let inProgressFacilities = 0;
    let pendingFacilities = 0;

    const districtSummaries = districtValues.map(d => {
      let facCount = 0;
      let comp = 0;
      let inProg = 0;
      let pend = 0;
      let distCarry = 0;
      let distAlloc = 0;
      let distDistr = 0;
      let distBal = 0;
      let vaccineCarry = 0;
      let vaccineAlloc = 0;
      let vaccineDistr = 0;
      let vaccineBal = 0;
      let deviceCarry = 0;
      let deviceAlloc = 0;
      let deviceDistr = 0;
      let deviceBal = 0;

      for (const r of (d.rows || [])) {
        if (r.facility && r.facility.trim()) {
          facCount++;
          const st = getFacilityBlueprintStatus(r, d.products || DEFAULT_BLUEPRINT_PRODUCTS);
          if (st === 'completed') comp++;
          else if (st === 'in_progress') inProg++;
          else pend++;

          for (const [vName, vData] of Object.entries(r.vaccines || {})) {
            const vi: any = vData || {};
            const isDev = vaccineService.isDeviceProduct(vName);
            const c = Number(vi.carryOver) || 0;
            const a = Number(vi.allocation) || 0;
            const ds = Number(vi.distributed) || 0;
            const b = Number(vi.balance) || 0;

            distCarry += c;
            distAlloc += a;
            distDistr += ds;
            distBal += b;

            if (isDev) {
              deviceCarry += c;
              deviceAlloc += a;
              deviceDistr += ds;
              deviceBal += b;
            } else {
              vaccineCarry += c;
              vaccineAlloc += a;
              vaccineDistr += ds;
              vaccineBal += b;
            }
          }
        }
      }

      totalBlueprintFacilities += facCount;
      completedFacilities += comp;
      inProgressFacilities += inProg;
      pendingFacilities += pend;

      return {
        id: d.id,
        district: d.district,
        month: d.month,
        facilitiesCount: facCount,
        completedCount: comp,
        inProgressCount: inProg,
        pendingCount: pend,
        totalCarryOver: distCarry,
        totalAllocation: distAlloc,
        totalDistributed: distDistr,
        totalBalance: distBal,
        vaccineCarryOver: vaccineCarry,
        vaccineAllocation: vaccineAlloc,
        vaccineDistributed: vaccineDistr,
        vaccineBalance: vaccineBal,
        deviceCarryOver: deviceCarry,
        deviceAllocation: deviceAlloc,
        deviceDistributed: deviceDistr,
        deviceBalance: deviceBal,
        updatedAt: d.updatedAt
      };
    });

    const blueprintSyncInfo = {
      totalDistricts: districtValues.length,
      districts: districtSummaries,
      activeDistrictId,
      totalBlueprintFacilities,
      completedFacilities,
      inProgressFacilities,
      pendingFacilities,
      lastSyncedAt: new Date().toISOString()
    };

    return res.json({
      ...metrics,
      blueprintSyncInfo
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Fetch vaccine audit logs history
app.get('/api/vaccine/audit-logs', async (req, res) => {
  try {
    const logs = vaccineService.getAuditLogs();
    return res.json(logs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Clear vaccine audit logs history
app.post('/api/vaccine/audit-logs/clear', async (req, res) => {
  try {
    vaccineService.clearAuditLogs();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// UNIFIED ACTIVITY AUDIT LOG & APP USAGE ENDPOINTS
// ==========================================

// GET activity logs with multi-dimensional filtering
app.get('/api/activity/logs', (req, res) => {
  try {
    const { module, actionType, actor, facility, district, search, dateRange, limit } = req.query as any;
    const logs = activityService.getActivityLogs({
      module,
      actionType,
      actor,
      facility,
      district,
      search,
      dateRange,
      limit: limit ? parseInt(limit, 10) : 250
    });
    return res.json({ logs, total: logs.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET app usage analytics & individual contributor breakdown
app.get('/api/activity/usage', (req, res) => {
  try {
    const usage = activityService.getAppUsageMetrics();
    return res.json(usage);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST log custom activity (e.g. Blueprint cell edit, page visit, note)
app.post('/api/activity/log', async (req, res) => {
  try {
    const { module, actionType, title, summary, actor, facility, district, cycle, badgeType, details } = req.body;
    const resolvedActor = getActiveActor(actor);
    const record = activityService.logActivity({
      module: module || 'vaccine_blueprint',
      actionType: actionType || 'blueprint_cell_edit',
      title: title || 'Activity Event',
      summary: summary || 'System activity recorded.',
      actor: resolvedActor,
      facility,
      district,
      cycle,
      badgeType: badgeType || 'purple',
      details
    });

    // Asynchronously write to Firestore with undefined-safety
    await persistActivityLogToFirestore(record);

    return res.json({ success: true, record });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST clear activity audit logs
app.post('/api/activity/logs/clear', (req, res) => {
  try {
    activityService.clearActivityLogs();
    return res.json({ success: true, message: 'Activity audit logs reset to baseline.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});


// Compile companion Chrome extension into packaged ZIP on the fly
app.get('/api/download-extension', async (req, res) => {
  try {
    // Robustly determine correct secure protocol.
    // Remote servers deployed on Cloud Run are strictly HTTPS, regardless of internal proxy routing.
    let protocol = 'https';
    const hostHeader = req.headers.host || '';
    if (hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') || hostHeader.includes('3000')) {
      protocol = 'http';
    }
    const hostUrl = req.headers.host ? `${protocol}://${req.headers.host}` : 'https://ais-dev-ksv3oiifrmnhdib3nb7awh-944779874869.europe-west2.run.app';
    
    const extDir = path.join(process.cwd(), 'extension');
    
    let manifestStr: string;
    let popupHtml: string;
    let popupJs: string;
    let contentJs: string;
    let iconBuffer: Buffer;

    try {
      manifestStr = await fs.readFile(path.join(extDir, 'manifest.json'), 'utf-8');
      popupHtml = await fs.readFile(path.join(extDir, 'popup.html'), 'utf-8');
      
      const rawPopupJs = await fs.readFile(path.join(extDir, 'popup.js'), 'utf-8');
      // Replace hardcoded development SERVER_URL with the active dynamic hostUrl
      popupJs = rawPopupJs.replace(/const SERVER_URL = '.*';/, `const SERVER_URL = '${hostUrl}';`);
      
      contentJs = await fs.readFile(path.join(extDir, 'content.js'), 'utf-8');
      iconBuffer = await fs.readFile(path.join(extDir, 'icon.png'));
    } catch (fsErr) {
      console.warn("Fell back to built-in extension assets:", fsErr);
      
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
      manifestStr = JSON.stringify(manifest, null, 2);

      // 2. Extension popup.html
      popupHtml = `<!DOCTYPE html>
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
      <input type="text" id="backendUrlInput" style="flex: 1; min-width: 0; font-size: 9px; padding: 2px 4px; border: 1px solid #D6C2EB; border-radius: 3px;" value="https://ais-dev-ksv3oiifrmnhdib3nb7awh-944779874869.europe-west2.run.app" />
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
      popupJs = `
const SERVER_URL = '${hostUrl}';

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
      contentJs = `
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
      const base64PixelImage = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR42mP8z8AARjYGBgY2NDVMyPhfG0fVUA2MqmECmEC6AmSgK0AGRskwVAMEAABqXg4NshdF9gAAAABJRU5ErkJggg==";
      iconBuffer = Buffer.from(base64PixelImage, 'base64');
    }

    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(manifestStr));
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

// Error handling middleware (e.g. PayloadTooLargeError)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    console.error('Payload too large error:', err);
    return res.status(413).json({
      error: 'Payload Too Large: The uploaded data exceeds the server size limit. Please ensure file or payload is within 50MB.',
      type: 'entity.too.large'
    });
  }
  if (err) {
    console.error('Unhandled server error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
  next();
});


// Setup static file serving & dev environment Vite handling
async function startServer() {
  // Ensure extension directory and icon.png exist so the workspace is fully complete
  try {
    const extDir = path.join(process.cwd(), 'extension');
    await fs.mkdir(extDir, { recursive: true });
    const iconPath = path.join(extDir, 'icon.png');
    try {
      await fs.access(iconPath);
    } catch {
      const base64PixelImage = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR42mP8z8AARjYGBgY2NDVMyPhfG0fVUA2MqmECmEC6AmSgK0AGRskwVAMEAABqXg4NshdF9gAAAABJRU5ErkJggg==";
      await fs.writeFile(iconPath, Buffer.from(base64PixelImage, 'base64'));
    }
  } catch (err) {
    console.error("Failed to ensure extension folder or icon.png on start:", err);
  }

  // Explicitly prevent unmatched /api/* requests from falling through to Vite or serving index.html
  app.all('/api/*all', (req, res) => {
    return res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`
    });
  });
  app.all('/api/*', (req, res) => {
    return res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`
    });
  });

  // Global unhandled error middleware guaranteeing JSON
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[Global Unhandled Server Error]:', err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(err.status || err.statusCode || 500).json({
      error: err.message || 'An unexpected internal server error occurred.'
    });
  });

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
