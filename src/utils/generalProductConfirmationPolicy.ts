import type { GeneralProductVerification, GeneralProductReviewState } from './generalAuditTypes';
import { recognizeGeneralDocument } from './generalDocumentStructure';
import { classifyGeneralText, generalOrderRelevantText } from './generalTextClassification';
import { generalCatalogSupports, generalProductIdentityEstablished, matchGeneralClinicalProducts } from './generalProductMatching';
import { resolveGeneralProductLogName } from './generalProductLog';

/** Shared by audit rebuilding, server confirmation and interactive controls.
 * Neither an AI label nor a supplied candidate establishes customer intent. */
export function generalConfirmationPolicy(product: GeneralProductVerification, normalize: (name: string) => string): {
  state: GeneralProductReviewState; options: GeneralProductVerification['options']; productEvidence: boolean;
} {
  const sources = product.requestedProducts || [];
  const productEvidence = sources.length > 0 && sources.every(source => recognizeGeneralDocument(generalOrderRelevantText(source.originalText), classifyGeneralText)
    .lines.some(line => line.kind === 'PRODUCT_ENTRY'));
  const result = (state: GeneralProductReviewState, options: GeneralProductVerification['options'] = []) => ({ state, options, productEvidence });
  if (!productEvidence) return result('product identification review');
  if (sources.some(source => source.quantityReview || !Number.isFinite(source.quantity) || source.quantity <= 0)) return result('quantity review');
  if (sources.some(source => resolveGeneralProductLogName(source.name)?.conflict)) return result('product identification review');
  if (!generalProductIdentityEstablished(product.productName, normalize) || sources.some(source =>
    !generalProductIdentityEstablished(source.name, normalize) || !generalProductIdentityEstablished(generalOrderRelevantText(source.originalText), normalize))) return result('product identification review');
  if (product.confirmation && product.status === 'customer verified' && generalCatalogSupports(product.confirmation.productName, normalize)) return result(product.fulfillmentProducts.some(source => normalize(source.name) === product.confirmation!.productKey) ? 'product match' : 'product discrepancy', product.options);
  const competing = new Set((product.fulfillmentProducts || []).map(source => source.normalizedName)).size > 1;
  const options = (product.options || []).filter(option => generalCatalogSupports(option.name, normalize) &&
    normalize(option.name) === option.key && (() => {
      const match = matchGeneralClinicalProducts(product.productName, option.name, normalize);
      return match.plausible && (match.stage === 'verification' || competing);
    })());
  return options.length ? result('dosage/formulation confirmation required', options) : result('product identification review');
}
