import type { GeneralProductEvidence as Evidence } from './generalAuditor';
import type { GeneralProductMatch } from './generalProductMatching';
import { canonicalGeneralSource, generalInputFingerprint } from '../../shared/generalAuditFingerprint';

export const generalSourceEntryId = (source: Evidence['source'], originalText: string, occurrence = 0, documentId = source as string) =>
  `${documentId}:${source}:${generalInputFingerprint({ whatsappMessage: canonicalGeneralSource(originalText), fulfillmentConfirmation: String(occurrence) })}`;

const unbound = new WeakMap<Evidence, string>();
let unboundSequence = 0;

/** Audit-scoped origin, independent of interpreted names and card positions. */
export function generalEvidenceOrigin(product: Evidence): string {
  if (!product.sourceEntryId && !product.sourceLineId && (!Number.isInteger(product.line) || product.line < 1)) {
    if (!unbound.has(product)) unbound.set(product, `unbound:${product.source}:${++unboundSequence}`);
    return unbound.get(product)!;
  }
  return product.sourceEntryId ? JSON.stringify([product.documentId || product.source, product.source, product.sourceEntryId]) : JSON.stringify([product.documentId || product.source, product.source, product.sourceLineId || product.line, canonicalGeneralSource(product.originalText)]);
}
export const sameGeneralEvidenceOrigin = (left: Evidence, right: Evidence) =>
  left.source === right.source && (left.documentId || left.source) === (right.documentId || right.source) && generalEvidenceOrigin(left) === generalEvidenceOrigin(right);

/** Duplicate recognitions never add quantity. Separate source occurrences survive. */
export function canonicalizeGeneralEvidence(products: Evidence[], match: (a: string, b: string) => GeneralProductMatch): Evidence[] {
  const result: Evidence[] = [];
  for (const product of products) {
    const duplicate = result.find(existing => sameGeneralEvidenceOrigin(existing, product) && existing.quantity === product.quantity && existing.unit === product.unit && existing.ratioRequestedQuantity === product.ratioRequestedQuantity && match(existing.name, product.name).confident);
    const recognitions = product.extractionProvenance || [{ method: product.customerVerified ? 'customer confirmation' : 'deterministic', name: product.name, originalText: product.originalText, line: product.line }];
    if (!duplicate) {
      const uncertain = !product.sourceEntryId && !product.sourceLineId && (!Number.isInteger(product.line) || product.line < 1);
      result.push(uncertain ? { ...product, sourceReview: 'The source line is uncertain. Verify whether this is a separate order entry before comparison.', extractionProvenance: recognitions } : product.extractionProvenance ? product : { ...product, extractionProvenance: recognitions }); continue;
    }
    const extractionProvenance = [...new Map([...(duplicate.extractionProvenance || []), ...recognitions].map(recognition => [JSON.stringify(recognition), recognition])).values()];
    result[result.indexOf(duplicate)] = { ...(product.customerVerified && !duplicate.customerVerified ? product : duplicate), extractionProvenance };
  }
  return result;
}
