/** General-only structural parsing. No product identities or quantities are inferred here. */
export type GeneralDocumentKind = 'HEADING' | 'FIELD_LABEL' | 'FIELD_VALUE' | 'PRODUCT_ENTRY' | 'CUSTOMER_NOTE' | 'INTRODUCTORY_TEXT' | 'ADMINISTRATIVE_HEADING' | 'FULFILMENT_NOTIFICATION' | 'ADMINISTRATIVE_TEXT' | 'AMBIGUOUS_CONTENT';
export type GeneralDocumentField = 'orderer' | 'facility' | 'delivery' | 'district' | 'date' | 'products' | 'quantity';
export interface GeneralDocumentLine {
  line: number; originalText: string; kind: GeneralDocumentKind; auditText: string;
  field?: GeneralDocumentField; labelLine?: number; section?: string;
}
export interface GeneralDocument { originalText: string; lines: GeneralDocumentLine[]; auditText: string }
const canonicalLabels: Record<GeneralDocumentField, string> = {
  orderer: 'Orderer', facility: 'Facility', delivery: 'Delivery/Drop Area', district: 'District', date: 'Date', products: 'Products', quantity: 'Qty',
};
const plain = (value: string) => value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const labelWords = ['products', 'product', 'quantities', 'quantity', 'medicines', 'medicine', 'requested', 'orderer', 'facility', 'district', 'delivery'];
function oneEdit(a: string, b: string) {
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) return [...a].filter((char, i) => char !== b[i]).length === 1;
  const shorter = a.length < b.length ? a : b, longer = a.length < b.length ? b : a;
  return [...longer].some((_, i) => longer.slice(0, i) + longer.slice(i + 1) === shorter);
}
function labelKey(value: string) {
  const abbreviations: Record<string, string> = { prod: 'products', prods: 'products', meds: 'medicines', qty: 'quantity', qtys: 'quantities', req: 'requested', reqd: 'requested' };
  return plain(value).split(' ').map(token => {
    const word = abbreviations[token] || token;
    if (labelWords.includes(word)) return word;
    const corrected = word.replace(/0/g, 'o').replace(/1/g, 'i');
    if (labelWords.includes(corrected)) return corrected;
    const matches = labelWords.filter(known => oneEdit(corrected, known));
    return matches.length === 1 ? matches[0] : word;
  }).join(' ');
}
function labelField(value: string): GeneralDocumentField | undefined {
  const key = labelKey(value);
  if (/^(?:name of (?:the )?orderer|orderer(?: name)?|ordered by|requested by|requester|recipient|customer name)$/.test(key)) return 'orderer';
  if (/^(?:name of (?:the )?(?:health )?facility|(?:health )?facility(?: name| id)?|hospital|clinic)$/.test(key)) return 'facility';
  if (/^(?:delivery(?: and)? drop(?: off)? area|delivery(?: area| location)?|drop(?: off)? (?:area|location|site))$/.test(key)) return 'delivery';
  if (/^district(?: name)?$/.test(key)) return 'district';
  if (/^(?:order )?date$/.test(key)) return 'date';
  if (/^(?:quantity|quantities|qty|amount)$/.test(key)) return 'quantity';
  if (/^(?:(?:requested|ordered|requisitioned) )?(?:products?|medicines?|items?|drugs?|vaccines?|supplies)(?: (?:and )?(?:quantit(?:y|ies)|qty|requested|ordered|requisition|details|list|needed|for delivery)){0,3}$/.test(key) || /^(?:order|requisition|request) (?:details|items|list)$/.test(key)) return 'products';
}
const productSignal = /\b(?:\d+(?:\.\d+)?\s*(?:mg|mcg|ml|miu|iu|g|vials?|vails?|bottles?|packs?|tablets?|doses?)|injection|infusion|tablets?|capsules?|syrup|suspension|vaccine|syringes?|needles?|cream|ointment|diluent|dropper)\b/i;
function productLike(value: string) { return /[a-z]/i.test(value) && (/\d/.test(value) || productSignal.test(value) || /\s(?:[-–—:=]\s*)?(?:(?:currently )?out of stock|(?:not )?(?:currently )?in stock|(?:currently )?unavailable|oos)[.!]?$/i.test(value)); }
const stockHeading = /^(?:(?:we are )?(?:currently )?(?:out of stock|not currently in stock|not in stock|currently unavailable|unavailable|oos)(?: for (?:the )?following (?:items|products))?|we (?:will now|can) prepare the following items(?: we have in stock)? for delivery|available(?: products| items)?|in stock|(?:items|products) (?:in stock|available))\s*[:.!]?$/i;
const note = /^(?:(?:please|pls|kindly)\s+)?(?:deliver(?: it| the order| these items)?|make (?:it|the order) available)\s+(?:on time|(?:by|on|at|before|after)\s+)?(?:tomorrow|today|tonight|(?:this |next )?(?:morning|afternoon|evening)|as soon as possible)(?:\s+(?:morning|afternoon|evening))?(?:[, ]+(?:please|thanks|thank you))?[.!]?$/i;
/** Closed grammatical phrases, never keyword-based medicine suppression. */
export function generalNonProductPhrase(raw: string): { kind: GeneralDocumentKind; boundary?: boolean; value?: string } | undefined {
  const text = raw.trim().replace(/^[*#_`•\s]+|[*_`\s]+$/g, '');
  const intro = /^(?:(?:please|pls|kindly)\s+)?(?:(?:we|i)\s+)?(?:(?:urgently|kindly|please)\s+)*(?:need|want|request|require)(?:\s+(?:the\s+following|the|these|following))?(?:\s+(?:items|products|medicines|supplies))?(?:\s+(?:urgently|please))?\s*[:.!]?$/i;
  if (intro.test(text)) return { kind: 'INTRODUCTORY_TEXT' };
  const inline = text.match(/^(.+?):\s*(.+)$/);
  if (inline && intro.test(inline[1])) return { kind: 'INTRODUCTORY_TEXT', value: inline[2] };
  if (/^(?:fulfilment|fulfillment|dispatch|delivery|order|system|fs)(?:\s+(?:system|confirmation|entry|message|audit|record|log|details)){1,4}\s*[:.!]?$/i.test(text) || /^(?:expected|estimated|scheduled)\s+(?:delivery|arrival)(?:\s+(?:time|date|window))?\s*[:.!]?$/i.test(text)) return { kind: 'ADMINISTRATIVE_HEADING' };
  if (/^(?:thank you|thanks)\s+for\s+(?:ordering(?: with zipline)?|your order)\s*[.!]?$/i.test(text)) return { kind: 'FULFILMENT_NOTIFICATION' };
  if (/^we\s+(?:will(?: now)?|can)\s+prepare\s+(?:your|the)\s+(?:items|products|order)(?:\s+for\s+(?:delivery|dispatch))?\s*[:.!]?$/i.test(text)) return { kind: 'FULFILMENT_NOTIFICATION', boundary: true };
  if (/^(?:(?:please|pls|kindly)\s+)?(?:(?:deliver|dispatch)(?:\s+(?:it|the order|these items))?\s+(?:urgently|promptly|on time|as soon as possible)|(?:expedite|prioritize)\s+(?:the\s+)?delivery)\s*[.!]?$/i.test(text)) return { kind: 'CUSTOMER_NOTE' };
}
/** A label is recognized by its role and grammar, not exact presentation. */
export function generalDocumentLabel(raw: string): { field: GeneralDocumentField; value: string } | undefined {
  const text = raw.trim().replace(/^(?:[-•*]\s+|\d+[.)]\s+)/, '').replace(/^[*#_`•\s]+|[*_`\s]+$/g, '');
  const separator = text.match(/^(.+?)\s*[:;=：–—]\s*(.*)$/);
  if (separator) {
    const field = labelField(separator[1]);
    if (field) return { field, value: separator[2].trim() };
  }
  const field = labelField(text.replace(/[.!]+$/, ''));
  if (field) return { field, value: '' };
  // Multiword role labels can precede values even when OCR drops punctuation.
  // Do not strip a lone 'Product' from legitimate names such as 'Product A'.
  const words = [...text.matchAll(/\S+/g)];
  for (let length = Math.min(8, words.length - 1); length >= 2; length--) {
    const end = words[length].index!;
    const prefix = text.slice(0, end).trim();
    const field = (prefix.match(/[a-z]+/gi) || []).length >= 2 ? labelField(prefix) : undefined;
    if (field) return { field, value: text.slice(end).trim() };
  }
  // Missing punctuation: require an unmistakable role prefix, not a medicine word.
  const inline = text.match(/^(name\s+of\s+(?:(?:health\s+)?facility|orderer)|orderer(?:\s+name)?|health\s+facility|district|delivery\s*\/\s*drop\s+area|products?\s+(?:and|&)\s+quantities)\s+(.+)$/i);
  if (inline) {
    const field = labelField(inline[1]);
    if (field) return { field, value: inline[2].trim() };
  }
}

/** Retain original lines and relationships; auditText is a position-preserving projection. */
export function recognizeGeneralDocument(text: string, classify?: (line: string) => { category: string; orderChange?: boolean }): GeneralDocument {
  const raw = text.split(/\r?\n/);
  const lines: GeneralDocumentLine[] = [];
  let section: string | undefined;
  let pending: { field: GeneralDocumentField; label: string; labelLine: number; values: GeneralDocumentLine[] } | undefined;
  const finish = () => {
    if (pending?.values.length) {
      pending.values[0].auditText = `${pending.label}: ${pending.values.map(line => line.originalText.trim()).join(' ')}`;
      for (const line of pending.values.slice(1)) line.auditText = '';
    }
    pending = undefined;
  };
  for (let i = 0; i < raw.length; i++) {
    const originalText = raw[i], value = originalText.trim().replace(/^(?:\*{1,2}|_{1,2})(.+?)(?:\*{1,2}|_{1,2})$/g, '$1');
    const classified = classify?.(value);
    const label = generalDocumentLabel(value);
    const line: GeneralDocumentLine = { line: i + 1, originalText, kind: 'AMBIGUOUS_CONTENT', auditText: originalText, section };
    lines.push(line);
    if (!value) { line.kind = 'ADMINISTRATIVE_TEXT'; continue; }
    // Explicit amendments remain auditable even inside a notes section.
    if (classified?.orderChange) { finish(); continue; }
    const phrase = generalNonProductPhrase(value);
    if (phrase) {
      finish(); line.kind = phrase.value ? 'PRODUCT_ENTRY' : phrase.kind;
      line.auditText = phrase.value || (phrase.boundary ? 'Available products:' : '');
      if (phrase.boundary || phrase.kind === 'INTRODUCTORY_TEXT') section = 'products';
      continue;
    }
    if (pending && !productSignal.test(value) && !/[:;=：]|[-–—]\s*\d|\d\s*\/\s*\d/.test(value) && !stockHeading.test(value) && !note.test(value) && classified?.category !== 'administrative' && (!label || pending.field === 'delivery' && /^facility$/i.test(value))) {
      line.kind = 'FIELD_VALUE'; line.field = pending.field; line.labelLine = pending.labelLine;
      pending.values.push(line); continue;
    }
    if (label) {
      finish(); line.field = label.field;
      if (label.field === 'products') {
        section = 'products'; line.section = section;
        if (/^\d+(?:\/\d+)?$/.test(label.value) && /^(?:vaccine|medicine|drug|item|product)\s*[:;=：]/i.test(value)) {
          line.kind = 'PRODUCT_ENTRY'; continue; // A generic medicine plus a quantity remains ambiguous clinical evidence.
        }
        const annotation = /^\d+\s*\/\s*\d+$/.test(label.value) || /^\(?\s*(?:all(?:\s+(?:quantities|items|products))?\s+|quantities\s+)?in\s+[a-z ]+\)?$/i.test(label.value);
        line.kind = label.value && !annotation ? 'PRODUCT_ENTRY' : 'HEADING';
        line.auditText = line.kind === 'PRODUCT_ENTRY' ? label.value : '';
      } else if (label.field === 'quantity') {
        line.kind = label.value ? 'FIELD_VALUE' : 'FIELD_LABEL'; line.auditText = `Qty: ${label.value}`;
      } else {
        section = label.field; line.section = section;
        line.kind = label.value ? 'FIELD_VALUE' : 'FIELD_LABEL';
        const writtenLabel = value.match(/^(.+?)\s*[:;=：–—]/)?.[1].trim();
        const stableLabel = writtenLabel && plain(writtenLabel) === labelKey(writtenLabel) ? writtenLabel : canonicalLabels[label.field];
        line.auditText = label.field === 'date' ? '' : label.value ? writtenLabel && plain(writtenLabel) === labelKey(writtenLabel) ? originalText : `${stableLabel}: ${label.value}` : '';
        if (!label.value) pending = { field: label.field, label: stableLabel, labelLine: i + 1, values: [] };
      }
      continue;
    }
    if (classified?.category === 'administrative' || note.test(value)) {
      finish(); line.kind = note.test(value) ? 'CUSTOMER_NOTE' : 'ADMINISTRATIVE_TEXT'; line.auditText = ''; continue;
    }
    if (/^(?:customer|orderer|facility|delivery|district|order|administrative)(?:\s+and\s+(?:customer|orderer|facility|delivery|district|order))?\s+(?:details|information|section|request)\s*[:：.!]?$/i.test(value)) { finish(); section = value; line.section = section; line.kind = 'HEADING'; line.auditText = ''; continue; }
    if (/^(?:(?:additional|customer|administrative|delivery|order)\s+)?(?:notes?|instructions?|comments?)\s*[:：.!]?$/i.test(value)) { finish(); section = 'notes'; line.section = section; line.kind = 'HEADING'; line.auditText = ''; continue; }
    if (stockHeading.test(value)) { finish(); section = 'products'; line.section = section; line.kind = 'HEADING'; continue; }
    const next = raw.slice(i + 1).find(next => next.trim())?.trim() || '';
    // An unfamiliar short caption needs structural evidence: punctuation plus
    // a following product, no clinical specifications or quantities of its own.
    if ((/[:：]$/.test(value) || /\b(?:overview|summary|list|requisition|requirements|supplies)\b/i.test(value)) && !productLike(value) && value.split(/\s+/).length <= 10 && !/^(?:please|pls|kindly|we|i|send|deliver|supply|thank|thanks|once|when)\b/i.test(value) && productLike(next)) {
      finish(); section = value; line.section = section; line.kind = 'HEADING'; line.auditText = ''; continue;
    }
    finish();
    if (productLike(value) || section === 'products' && /^[\p{L}][\p{L}\s&()/.'-]{1,100}$/u.test(value.replace(/^(?:[-*•]\s*|\d+[.)]\s*)/, ''))) line.kind = 'PRODUCT_ENTRY';
  }
  finish();
  return { originalText: text, lines, auditText: lines.map(line => line.auditText).join('\n') };
}
