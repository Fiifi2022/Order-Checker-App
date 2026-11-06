// Examples transcribed from the user-supplied Scenarios fot Testing.pdf.
// Preserve source quantities and absent requests; these are demos, not catalogue mappings.
export interface DispatchAuditScenario {
  id: string;
  title: string;
  category: string;
  description: string;
  sourcePages: number[];
  customerRequest: string;
  fulfillmentConfirmation: string;
}

export const dispatchAuditScenarios: DispatchAuditScenario[] = [
  {
    "id": "nominal-order",
    "title": "Nominal Order",
    "category": "Matched orders",
    "description": "Two requested products with matching fulfilment quantities.",
    "sourcePages": [
      1
    ],
    "customerRequest": "Date*: 26th June, 2026\nName of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nDelivery/ Drop area: Gbimsi\nDistrict: West Mamprusi\nProducts and Quantities:\n1. Multivitamin Syrup -5\n2. Paracetamol 120mg/5mL Syrup, 100mL - 5",
    "fulfillmentConfirmation": "Thank you Isaac Awuyem from Gbimsi CHPS for ordering with Zipline. We have\nreceived your order (ID: BY537XPG5D). We will now prepare the following items for\ndelivery:\n- Multivitamin Syrup [5/5]\n- Paracetamol 120mg/5mL Syrup, 100mL [5/5]\nExpected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM. Let\nus know if any changes are required or contact 0800719102 if any questions.\nYou will receive your flight notifications via SMS"
  },
  {
    "id": "out-of-stock",
    "title": "Out Of Stock",
    "category": "Stock availability",
    "description": "Both requested products are recorded as out of stock with [0/1].",
    "sourcePages": [
      1,
      2
    ],
    "customerRequest": "Date*: 19th June, 2026\nName of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nDelivery/ Drop area: Gbimsi\nDistrict: West Mamprusi\nProducts and Quantities:\n1. Multivitamin Syrup -5\n2. Paracetamol 120mg/5mL Syrup, 100mL - 5",
    "fulfillmentConfirmation": "Thank you Isaac Awuyem from Gbimsi CHPS for ordering with Zipline. We have\nreceived your order (ID: JJIBVL7I3S). We are currently out of stock for the following\nitems:\n- Multivitamin Syrup [0/1]\n- Paracetamol 120mg/5mL Syrup, 100mL [0/1]\n\nPlease reach out to the nearest stock for the rest of the order. Once re-stocked, we will\nnotify you and be able to deliver the rest, if still needed. Let us know if any changes are\nrequired or contact +0800719102 if any questions.\nYou will receive your flight notifications via SMS"
  },
  {
    "id": "partial-out-of-stock",
    "title": "Partial Out Of Stock",
    "category": "Stock availability",
    "description": "Four requested products: two stockouts and two supplied at reduced quantities.",
    "sourcePages": [
      2
    ],
    "customerRequest": "Date*: 19th June, 2026\nName of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nDelivery/ Drop area: Gbimsi\nDistrict: West Mamprusi\nProducts and Quantities:\n1. Multivitamin Syrup -15\n2. Paracetamol 120mg/5mL Syrup, 100mL - 15\n3.Simple Linctus 125mg/5ml Syrup (Adult) -5\n4.Simple Linctus 31.25mg/5ml Syrup (Paediatric) -5",
    "fulfillmentConfirmation": "Thank you Isaac Awuyem from Gbimsi CHPS for ordering with Zipline. We have\nreceived your order (ID: JJIBVL7I3S). We are currently out of stock for the following\nitems:\n- Simple Linctus 125mg/5ml Syrup (Adult) [0/1]\n- Simple Linctus 31.25mg/5ml Syrup (Paediatric) [0/1]\nWe can prepare the following items we have in stock for delivery:\n- Multivitamin Syrup [5/5]\n- Paracetamol 120mg/5mL Syrup, 100mL [5/5]\nPlease reach out to the nearest stock for the rest of the order. Once re-stocked, we will\nnotify you and be able to deliver the rest, if still needed. Let us know if any changes are\nrequired or contact +0800719102 if any questions.\nYou will receive your flight notifications via SMS"
  },
  {
    "id": "order-mismatch",
    "title": "Order Mismatch",
    "category": "Product discrepancies",
    "description": "Multivitamin Syrup is requested; Ringers Lactate appears in fulfilment.",
    "sourcePages": [
      3
    ],
    "customerRequest": "Date*: 19th June, 2026\nName of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nDelivery/ Drop area: Gbimsi\nDistrict: West Mamprusi\nProducts and Quantities:\n1. Multivitamin Syrup -5\n2. Paracetamol 120mg/5mL Syrup, 100mL - 5",
    "fulfillmentConfirmation": "Thank you Isaac Awuyem from Gbimsi CHPS for ordering with Zipline. We have\nreceived your order (ID: BY537XPG5D). We will now prepare the following items for\ndelivery:\n- Ringers Lactate [5/5]\n- Paracetamol 120mg/5mL Syrup, 100mL [5/5]\nExpected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM. Let\nus know if any changes are required or contact 0800719102 if any questions.\nYou will receive your flight notifications via SMS"
  },
  {
    "id": "facility-mismatch",
    "title": "Facility Mismatch",
    "category": "Facility discrepancies",
    "description": "The request names Gbimsi CHPS; fulfilment names Karaga CHPS.",
    "sourcePages": [
      3
    ],
    "customerRequest": "Date*: 19th June, 2026\nName of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nDelivery/ Drop area: Gbimsi\nDistrict: West Mamprusi\nProducts and Quantities:\n1. Multivitamin Syrup -5\n2. Paracetamol 120mg/5mL Syrup, 100mL - 5",
    "fulfillmentConfirmation": "Thank you Isaac Awuyem from Karaga CHPS for ordering with Zipline. We have\nreceived your order (ID: BY537XPG5D). We will now prepare the following items for\ndelivery:\n- Multivitamin Syrup [5/5]\n- Paracetamol 120mg/5mL Syrup, 100mL [5/5]\nExpected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM. Let\nus know if any changes are required or contact 0800719102 if any questions.\nYou will receive your flight notifications via SMS"
  },
  {
    "id": "katigri-vaccines",
    "title": "Katigri Vaccine Order",
    "category": "Vaccine aliases",
    "description": "Vaccine acronyms alongside full product names, quantities, diluents and droppers.",
    "sourcePages": [
      4
    ],
    "customerRequest": "Name: Hellen Awosi\nFacility: Katigri CHPS\nProducts:\nBCG - 2\nTD -1\nOPV -2\nPenta -4\nPCV -15\nRota - 3\nYF - 2",
    "fulfillmentConfirmation": "Thank you Hellen Awosi from Katigri CHPS for ordering with Zipline. We have received\nyour order (ID: 2GF58FX242). Use this link to track your order:\nhttps://orders.zipline.com/t/8/2GF58FX242 We will now prepare the following items for\ndelivery:\n- Bacille Calmette-Guerin Vaccine [2/2]\n- Bacille Calmette-Guerin Vaccine Diluent [2/2]\n- Diphtheria & Tetanus Vaccine [1/1]\n- Inactivated Polio Vaccine [2/2]\n- Oral Polio Vaccine Dropper [3/3]\n- Oral Polio Vaccine (1&3) [3/3]\n- Pentavalent (5-in-1) Vaccine [4/4]\n- Pneumococcal Conjugate Vaccine [15/15]\n- Rotavirus Vaccine Dropper [3/3]\n- Rotavirus Vaccine [3/3]\n- Yellow Fever Vaccine [2/2]\n- Yellow Fever Vaccine Diluent [2/2]\nExpected delivery: between September 24, 2026 08:00 AM and September 24, 2026\n03:00 PM. Let us know if any changes are required or contact +0800719102 if any\nquestions.\nYou will receive your flight notifications via SMS"
  },
  {
    "id": "asv-arv",
    "title": "ASV & ARV Order",
    "category": "Vaccine aliases",
    "description": "ASV and ARV abbreviations compared with the fulfilment descriptions in the PDF.",
    "sourcePages": [
      5,
      6
    ],
    "customerRequest": "Date*: 26th June, 2026\nName of Orderer: Isaac Awuyem\nName of Health Facility: Gbimsi CHPS\nDelivery/ Drop area: Gbimsi\nDistrict: West Mamprusi\n\nProducts and Quantities:\n1. ASV -5\n2. ARV - 5",
    "fulfillmentConfirmation": "Thank you Isaac Awuyem from Gbimsi CHPS for ordering with Zipline. We have\nreceived your order (ID: BY537XPG5D). We will now prepare the following items for\ndelivery:\n- Anti snake vaccine [5/5]\n- Anti rabies vaccine [5/5]\nExpected delivery: between June 26, 2026 10:38 AM and June 26, 2026 12:38 PM. Let\nus know if any changes are required or contact 0800719102 if any questions.\nYou will receive your flight notifications via SMS"
  }
];
