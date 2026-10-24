import { parseGeneralProducts, normalizeGeneralProductName, type GeneralProductEvidence, type GeneralProductSource } from './generalAuditor';
import { canonicalizeGeneralEvidence, generalSourceEntryId } from './generalProductEvidence';
import { matchGeneralClinicalProducts } from './generalProductMatching';

/** Bind every recognition to the original document BEFORE pairing or scoring.
 * Reconciliation requires an original entry with compatible clinical details
 * and quantity, or a consumed text span. Separate occurrences and independent
 * products on one line survive.
 */
export function bindGeneralExtractionSources(products: GeneralProductEvidence[], raw: string, source: GeneralProductSource): GeneralProductEvidence[] {
  const originals = parseGeneralProducts(raw, source);
  const lines = raw.split(/\r?\n/);
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + (raw.slice(offset + line.length).startsWith('\r\n') ? 2 : 1); }
  const allocated = new Map<string, string>();
  const consumed = new Set<string>();
  const allocatedSpans = new Map<string, { line: number; start: number; end: number }>();
  const consumedSpans = new Set<number>();
  const match = (a: string, b: string) => matchGeneralClinicalProducts(a, b, normalizeGeneralProductName);
  const entries = products.map(product => {
    if (product.source !== source || product.documentId && product.documentId !== source) return product;
    const direct = originals.filter(original => original.sourceEntryId === product.sourceEntryId && original.quantity === product.quantity && original.unit === product.unit && match(original.name, product.name).confident);
    const candidates = direct.length ? direct : originals.filter(original =>
      original.quantity === product.quantity && original.unit === product.unit &&
      match(original.name, product.name).confident);
    const available = candidates.filter(original => !consumed.has(original.sourceEntryId!));
    const previouslyBound = allocated.get(product.sourceEntryId!);
    const original = candidates.find(original => original.sourceEntryId === previouslyBound) ||
      (available.length === 1 ? available[0] : available.find(original => original.line === product.line)) ||
      (candidates.length === 1 ? candidates[0] : undefined);
    if (original) {
      consumed.add(original.sourceEntryId!);
      allocated.set(product.sourceEntryId!, original.sourceEntryId!);
      const start = offsets[original.line - 1] + Math.max(0, lines[original.line - 1]?.indexOf(original.originalText) ?? 0);
      return { ...original, documentId: source, sourceLineId: `${source}:line:${original.line}`, sourceSpan: { start, end: start + original.originalText.length },
        extractionProvenance: product.name === original.name && product.originalText === original.originalText && product.line === original.line ? product.extractionProvenance : [...(product.extractionProvenance || []), { method: 'source-bound extraction', name: product.name, originalText: product.originalText, line: product.line }] };
    }
    // Inline lists have distinct consumed spans within a shared source line.
    const spans = lines.flatMap((line, index) => {
      const needle = product.originalText.trim();
      if (!needle) return [];
      const found: { line: number; start: number; end: number }[] = [];
      for (let at = line.indexOf(needle); at >= 0; at = line.indexOf(needle, at + needle.length)) {
        found.push({ line: index + 1, start: offsets[index] + at, end: offsets[index] + at + needle.length });
      }
      return found;
    });
    const availableSpans = spans.filter(span => !consumedSpans.has(span.start));
    const span = allocatedSpans.get(product.sourceEntryId!) || (spans.length === 1 ? spans[0] : availableSpans.find(span => span.line === product.line) || availableSpans[0]);
    if (!span) return product;
    allocatedSpans.set(product.sourceEntryId!, span);
    consumedSpans.add(span.start);
    const id = generalSourceEntryId(source, product.originalText, spans.findIndex(candidate => candidate === span));
    return { ...product, sourceEntryId: id, documentId: source, sourceLineId: `${source}:line:${span.line}`, line: span.line, sourceSpan: { start: span.start, end: span.end } };
  });
  return canonicalizeGeneralEvidence(entries, match);
}
