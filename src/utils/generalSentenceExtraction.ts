import { findGeneralFacilityNames, normalizeGeneralFacilityName, type GeneralFacilityContext } from './generalFacility';

const person = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length <= 6 && /^[\p{L}][\p{L}'’ .-]*$/u.test(name) &&
    !/\b(?:patient|client|recipient|nurse|officer|doctor|facility|hospital|centre|center|chps|hc|please|need|send|we|from|at|and)\b/i.test(name);
};
const name = "((?:(?:Dr|Mr|Mrs|Ms)\\.\\s+)?[\\p{L}][\\p{L}'’ .-]{0,100}?)";
const boundary = '(?=\\s*[,;.!?\\n]|\\s+(?:and\\s+)?(?:(?:please|pls|kindly)\\s+)?(?:we|i|send|supply|request|need|want|require|would|deliver)\\b|$)';

/** Grammatical projection only: values remain source substrings, never inferred identities.
 * Unknown clauses and competing introductions survive for independent validation. */
export function projectGeneralOrderSentences(raw: string, context: GeneralFacilityContext = {}, protectedLine: (line: string) => boolean = () => false): string {
  return raw.split('\n').map(line => protectedLine(line) ? line : projectLine(line,context)).join('\n');
}
function projectLine(raw: string, context: GeneralFacilityContext): string {
  let text = raw;
  const introduction = new RegExp(`\\b(?:i am|i['’]m|this is|my name is|calling is)\\s+${name}\\s+(?:calling\\s+)?(?:from|at|on behalf of)\\s+([^;\\n.!?]+?)${boundary}`, 'giu');
  text = text.replace(introduction, (whole, orderer: string, facility: string, offset: number, input: string) => {
    // A quoted/reported patient introduction is not the orderer's identity.
    if (/\b(?:patient|client|recipient)\b[^.!?;\n]*$/i.test(input.slice(0, offset)) || !person(orderer)) return whole;
    const names = findGeneralFacilityNames(facility, context.records);
    if (names.length !== 1 || normalizeGeneralFacilityName(names[0]) !== normalizeGeneralFacilityName(facility.trim())) return whole;
    return `\nOrderer: ${orderer.trim()}\nFacility: ${facility.trim()}\n`;
  });
  const facilityIntro = /\b(?:we are ordering from|we are calling from|ordering on behalf of|ordering from|calling from|our facility is)\s+([^;\n.!?]+?)(?=\s*[,;.!?\n]|\s+(?:and\s+)?(?:(?:please|kindly)\s+)?(?:we|i|send|supply|need|require)\b|$)/gi;
  text = text.replace(facilityIntro, (whole, facility: string) => {
    const names = findGeneralFacilityNames(facility, context.records);
    return names.length === 1 && normalizeGeneralFacilityName(names[0]) === normalizeGeneralFacilityName(facility.trim())
      ? `\nFacility: ${facility.trim()}\n` : whole;
  });
  // Explicit orderer roles outrank an unrelated person mentioned in the message.
  const standalone = new RegExp(`(^|[;\\n.!?]\\s*|,\\s*)(?:my name is|i am|i['’]m|the orderer is|ordered by|requested by)\\s+${name}${boundary}`, 'gimu');
  text = text.replace(standalone, (whole, prefix: string, orderer: string) => person(orderer)
    ? `${prefix}\nOrderer: ${orderer.trim()}\n` : whole);
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
