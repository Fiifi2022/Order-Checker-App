import { findGeneralFacilityNames, normalizeGeneralFacilityName, type GeneralFacilityContext } from './generalFacility';

const person = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length <= 6 && /^[\p{L}][\p{L}'’ .-]*$/u.test(name) &&
    !/\b(?:patient|client|recipient|nurse|officer|doctor|facility|hospital|centre|center|chps|hc|please|need|send|we|from|at|and)\b/i.test(name);
};
const title = '(?:Dr|Mr|Mrs|Ms|Nurse|Officer)\\.?';
const name = `((?:${title}\\s+)?[\\p{L}][\\p{L}'’ .-]{0,100}?)`;
const withoutTitle = (value: string) => value.trim().replace(new RegExp(`^${title}\\s+`, 'i'), '');
const boundary = '(?=\\s*[,;.!?\\n]|\\s+(?:and\\s+)?(?:(?:please|pls|kindly)\\s+)?(?:we|i|send|supply|request|need|want|require|would|deliver)\\b|$)';

/** Grammatical projection only: values remain source substrings, never inferred identities.
 * Unknown clauses and competing introductions survive for independent validation. */
export function projectGeneralOrderSentences(raw: string, context: GeneralFacilityContext = {}, protectedLine: (line: string) => boolean = () => false): string {
  return raw.split('\n').map(line => protectedLine(line) ? line : projectLine(line,context)).join('\n');
}
function projectLine(raw: string, context: GeneralFacilityContext): string {
  let text = raw;
  const titledRequest = new RegExp(`^\\s*(${title}\\s+[\\p{L}][\\p{L}'’ .-]{1,100}?)\\s+(?:urgently\\s+)?needs?\\s+(.+)$`, 'iu');
  text = text.replace(titledRequest, (whole, orderer: string, products: string) => {
    orderer = withoutTitle(orderer);
    return person(orderer) && orderer.split(/\s+/).length >= 2 ? `\nOrderer: ${orderer}\nWe need ${products}` : whole;
  });
  const introduction = new RegExp(`(?:\\b(?:i am|i['’]m|this is|my name is|calling is)\\s+|^(?=${title}\\s+))${name}\\s+(?:calling\\s+)?(?:from|at|of|on behalf of)\\s+([^;\\n.!?]+?)${boundary}`, 'giu');
  text = text.replace(introduction, (whole, orderer: string, facility: string, offset: number, input: string) => {
    // A quoted/reported patient introduction is not the orderer's identity.
    orderer = withoutTitle(orderer);
    if (/\b(?:patient|client|recipient)\b[^.!?;\n]*$/i.test(input.slice(0, offset)) || !person(orderer)) return whole;
    const names = findGeneralFacilityNames(facility, context.records);
    if (names.length !== 1 || normalizeGeneralFacilityName(names[0]) !== normalizeGeneralFacilityName(facility.trim())) return whole;
    return `\nOrderer: ${orderer.trim()}\nFacility: ${facility.trim()}\n`;
  });
  // A comma-separated sender/facility introduction still needs a recognisable
  // ordering clause; an arbitrary person mentioned beside a hospital is not enough.
  const commaIntroduction = new RegExp(`^\\s*${name}\\s*,\\s*([^,;\\n.!?]+),\\s*(?=(?:(?:please|kindly)\\s+)?(?:send|supply|we\\s+need|i\\s+need)\\b)`, 'iu');
  text = text.replace(commaIntroduction, (whole, orderer: string, facility: string) => {
    orderer = withoutTitle(orderer);
    const names = findGeneralFacilityNames(facility, context.records);
    return person(orderer) && names.length === 1 && normalizeGeneralFacilityName(names[0]) === normalizeGeneralFacilityName(facility.trim())
      ? `\nOrderer: ${orderer}\nFacility: ${facility.trim()}\n` : whole;
  });
  // Facility-led requests contain no orderer. Split the two clauses without
  // interpreting the facility's name as the sender or as part of a product.
  text = text.replace(/(^|\n)(?:we\s+at\s+)?([^;\n.!?]+?)\s+(?:urgently\s+)?needs?\s+(.+)$/gim, (whole, prefix: string, facility: string, products: string) => {
    const names = findGeneralFacilityNames(facility, context.records);
    return names.length === 1 && normalizeGeneralFacilityName(names[0]) === normalizeGeneralFacilityName(facility.trim())
      ? `${prefix}Facility: ${facility.trim()}\nWe need ${products}` : whole;
  });
  const facilityIntro = /\b(?:we are ordering from|we are calling from|ordering on behalf of|ordering from|calling from|our facility is)\s+([^;\n.!?]+?)(?=\s*[,;.!?\n]|\s+(?:and\s+)?(?:(?:please|kindly)\s+)?(?:we|i|send|supply|need|require)\b|$)/gi;
  text = text.replace(facilityIntro, (whole, facility: string) => {
    const names = findGeneralFacilityNames(facility, context.records);
    return names.length === 1 && normalizeGeneralFacilityName(names[0]) === normalizeGeneralFacilityName(facility.trim())
      ? `\nFacility: ${facility.trim()}\n` : whole;
  });
  // Explicit orderer roles outrank an unrelated person mentioned in the message.
  const standalone = new RegExp(`(^|[;\\n.!?]\\s*|,\\s*)(?:my name is|i am|i['’]m|the orderer is|ordered by|requested by)\\s+${name}${boundary}`, 'gimu');
  text = text.replace(standalone, (whole, prefix: string, orderer: string) => person(withoutTitle(orderer))
    ? `${prefix}\nOrderer: ${withoutTitle(orderer)}\n` : whole);
  // Separate grammatical clauses, without splitting decimal numbers or product punctuation.
  text = text.replace(/,\s*(?=(?:(?:and\s+)?(?:please|pls|kindly)\s+)?(?:(?:we|i)\s+(?:need|want|require|request|would like)|(?:send|supply|deliver)\b))/gi, '\n')
    .replace(/\s+and\s+(?:please|pls|kindly)\s+(?=(?:send|supply|deliver)\b)/gi, '\nPlease ');
  text = text.replace(/\b(?:please\s+)?deliver\s+(?:it\s+|them\s+|the order\s+)?to\s+([^;\n.!?]+)([.!?]?)/gi,
    (whole, destination: string, mark: string) => {
      // Never turn additional product instructions into optional location text.
      if (/\d|\b(?:and|with|plus|include|add|send|supply|need|request|instead|change|different|another)\b/i.test(destination)) return whole;
      return `\nDelivery area: ${destination.trim()}${mark}\n`;
    });
  return text;
}
