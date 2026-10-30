import type {GeneralComparisonItem} from './generalAuditor';
import {classifyGeneralAuditLine, generalOrderRelevantText} from './generalTextClassification';

/** The final rendering boundary must never accept metadata as a product. */
export function assertGeneralProductEvidence(items: GeneralComparisonItem[]) {
  const assigned = new Set<string>();
  for (const item of items) for (const evidence of item.provenance) {
    const text = generalOrderRelevantText(evidence.originalText).trim();
    if (!text || ['optional_metadata', 'administrative', 'product_quantity'].includes(classifyGeneralAuditLine(text))) {
      throw new Error('Audit product evidence contains a non-product line. Run the current messages through the auditor again.');
    }
    const key = JSON.stringify([evidence.source, evidence.line, evidence.originalText]);
    if (assigned.has(key)) throw new Error('Audit product evidence was assigned more than once. Run the audit again.');
    assigned.add(key);
  }
}

/** Same expandable evidence in the website and extension; never an AI rationale. */
export function generalProductDecisionEvidence(items: GeneralComparisonItem[]): {label: string; value: string}[] {
  const evidence = items.flatMap(item => item.provenance);
  const sourceText = (source: string) => [...new Set(evidence.filter(row => row.source === source).map(row => row.sourceOriginalText || row.originalText))].join('\n') || 'Not provided';
  const quantity = items.find(item => item.provenance.some(row => row.source === 'customer_request'))?.fulfillment || items[0]?.fulfillment;
  const ids = [...new Set([...items.flatMap(item => item.catalogProductId ? [item.catalogProductId] : []),
    ...evidence.flatMap(row => row.canonicalId ? [row.canonicalId] : [])])];
  return [
    {label: 'Original customer product text', value: sourceText('customer_request')},
    {label: 'Original FS product text', value: sourceText('fulfillment_confirmation')},
    {label: 'Canonical product ID', value: ids.join(', ') || 'Unresolved'},
    {label: 'Matching method', value: [...new Set(evidence.map(row => row.catalogMatchMethod || row.matchingStage).filter(Boolean))].join(', ') || 'Source evidence review'},
    {label: 'Requested quantity', value: !quantity || quantity.requestedQuantityMissing ? 'Not provided' : `${quantity.requested} ${quantity.requestedUnit || ''}`.trim()},
    {label: 'FS recorded requested quantity', value: quantity?.confirmationRequested === undefined ? 'Not separately stated' : String(quantity.confirmationRequested)},
    {label: 'Fulfilled quantity', value: !quantity || quantity.suppliedQuantityMissing ? 'Not provided' : `${quantity.supplied} ${quantity.suppliedUnit || ''}`.trim()},
    {label: 'Operational exception', value: quantity?.stockStatus || (quantity?.fulfillmentStatus === 'order limit applied' ? 'Approved order limit' : 'None')},
    {label: 'Decision reason', value: quantity?.identityError || quantity?.quantityError || items.map(item => item.action).filter(action => action && action !== 'None').join('; ') || (items.length && items.every(item=>['match','out of stock','order limit applied'].includes(item.status)) ? 'Catalogue identity and quantity verified' : 'Product identity or quantity requires review')},
  ];
}
