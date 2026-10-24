export interface GeneralAuditSources { whatsappMessage: string; fulfillmentConfirmation: string }
export function canonicalGeneralSource(value: string) {
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').split('\n')
    .map(line => line.replace(/[\t \u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
}
export function sameGeneralAuditSources(left: GeneralAuditSources, right: GeneralAuditSources) {
  return canonicalGeneralSource(left.whatsappMessage) === canonicalGeneralSource(right.whatsappMessage) &&
    canonicalGeneralSource(left.fulfillmentConfirmation) === canonicalGeneralSource(right.fulfillmentConfirmation);
}
/** Stable source identity, independent of audit timestamps and verification state.
 * This is not an authentication hash; mutations also compare canonical sources. */
export function generalInputFingerprint(inputs: GeneralAuditSources) {
  const text = JSON.stringify([canonicalGeneralSource(inputs.whatsappMessage), canonicalGeneralSource(inputs.fulfillmentConfirmation)]);
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < text.length; index++) {
    for (let word = 0; word < words.length; word++) words[word] = Math.imul(words[word] ^ text.charCodeAt(index), 0x01000193 + word * 2) >>> 0;
  }
  return `general-v1-${text.length}-${words.map(word => word.toString(16).padStart(8, '0')).join('')}`;
}
