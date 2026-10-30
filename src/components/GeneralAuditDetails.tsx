import { generalFacilityDisplayStatus } from '../utils/generalFacility';
import { generalAuditClarifications, generalReviewEvidence, generalReviewExplanation, generalFourParameterStatuses } from '../utils/generalAuditReviews';
import type { GeneralAuditDetails as Details } from '../utils/generalAuditTypes';

export default function GeneralAuditDetails({ details, onConfirmProduct, confirmationDisabled = false }: {
  details: Details; onConfirmProduct?: (key: string, productKey: string) => Promise<void>; confirmationDisabled?: boolean;
}) {
  const reviewNotices = generalAuditClarifications({ ...details, semanticReviews: details.semanticReviews?.filter(review => !review.dosageFormKey) });
  // Older summaries combine product and quantity wording. Keep the actual
  // review evidence separate in the interface without changing legacy payloads.
  if (generalReviewEvidence(details.semanticReviews?.filter(review => !review.dosageFormKey), 'quantity').length && !reviewNotices.some(notice => notice.field === 'quantity')) {
    reviewNotices.push({ field: 'quantity', message: 'QUANTITY REVIEW' });
  }
  const statuses = generalFourParameterStatuses(details);
  const fields = [
    { unavailable: 'Not available', label: 'Facility Name', required: true, customer: details.facility.whatsappValue, system: details.facility.fulfillmentValue, status: generalFacilityDisplayStatus(details.facility) },
    { unavailable: 'Not found', label: 'Name of Orderer', required: true, customer: details.orderer.whatsappValue, system: details.orderer.fulfillmentValue, status: details.orderer.status, reason: details.orderer.reason },
    { unavailable: 'Not available', label: 'Products', required: true, customer: `${details.productCount.requested} products`, system: `${details.productCount.found} products`, status: statuses.products },
    { unavailable: 'Not available', label: 'Quantities', required: true,
      customer: details.products.map(product => `${product.name}: ${product.requested} ${product.requestedUnit || ''}`.trim()).join('; '),
      system: details.products.map(product => `${product.name}: ${product.supplied} ${product.suppliedUnit || ''}`.trim()).join('; '),
      status: statuses.quantities }
  ];
  const statusText = (field: typeof fields[number]) => {
    if(field.status==='informational') return 'OPTIONAL — INFORMATION ONLY';
    if (field.status === 'optional not provided' || !field.required && (field.status === 'missing from customer request' || field.status === 'not available in system entry')) return field.customer === 'N/A' && field.system === 'N/A' ? 'OPTIONAL — NOT PROVIDED'
      : `OPTIONAL — NOT PROVIDED IN ${field.customer === 'N/A' ? 'CUSTOMER REQUEST' : 'FULFILMENT'}`;
    if (field.required && (field.status === 'missing from customer request' || field.status === 'not available in system entry')) return 'REVIEW REQUIRED';
    if (field.label === 'Name of Orderer' && field.status === 'review required') return 'REVIEW REQUIRED';
    if (field.label === 'Name of Orderer' && field.status === 'match') return 'MATCH';
    if (field.status === 'review required') return 'REVIEW REQUIRED';
    if (field.status === 'match') return field.label === 'Facility Name' ? 'MATCH' : ['Products', 'Quantities'].includes(field.label) ? 'ALL MATCHED' : 'VERIFIED MATCH';
    if (field.label === 'Delivery/Drop Area') return 'LOCATION MISMATCH';
    if (field.label === 'District') return 'DISTRICT MISMATCH';
    return 'DISCREPANCY';
  };
  return <section className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm space-y-4" aria-label="General audit field results">
    <h4 className="text-sm font-bold text-[#3B1A5E]">Identity and order checks</h4>
    {details.extraction && <details className="rounded-xl border border-purple-100 p-3 text-xs">
      <summary className="cursor-pointer font-semibold">What we understood</summary>
      <p className="mt-2 text-slate-600">Check these details. To correct them, edit the original message and run the audit again.</p>
      {(['customer', 'fulfillment'] as const).map(source => {
        const message = details.extraction![source];
        return <div key={source} className="mt-3 space-y-1">
          <p className="font-semibold">{source === 'customer' ? 'Customer request' : 'Fulfilment confirmation'}</p>
          <p>Orderer: {message.ordererName || 'Needs clarification'}</p>
          <p>Facility: {message.facilityName || 'Needs clarification'}</p>
          <ul>{message.products.map((product,index) => <li key={index}>{product.name} — {product.quantity ?? 'Quantity needed'} {product.unit || ''}</li>)}</ul>
          {message.unresolvedFields.length > 0 && <p className="text-amber-800">Some details need clarification; check the findings below.</p>}
        </div>;
      })}
    </details>}
    {reviewNotices.map(notice => {
      const evidence = generalReviewEvidence(details.semanticReviews?.filter(review => !review.dosageFormKey), notice.field);
      return <div key={notice.field} role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl space-y-2">
        <p className="font-semibold">{notice.field === 'products' ? 'PRODUCT IDENTIFICATION REVIEW' : notice.field === 'quantity' ? 'QUANTITY REVIEW' : notice.message}</p>
        {evidence.map((review, index) => <div key={`${review.source}:${index}`} className="space-y-1">
          <p className="font-medium">{review.source === 'customer_request' ? 'Customer Request' : 'Fulfilment Confirmation'} — text requiring review:</p>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-amber-300 pl-2">{review.originalText}</blockquote>
          <p>Reason: {generalReviewExplanation(review)}</p>
          {review.possibleMatches?.length > 0 && <p>Possible matches: {review.possibleMatches.join(', ')}</p>}
        </div>)}
      </div>;
    })}
    {fields.map(field => <div key={field.label} className="space-y-1 text-xs">
      <div className="flex flex-wrap justify-between gap-2 font-semibold">
        <span>{field.label}{field.required ? ' (mandatory)' : field.label === 'Delivery/Drop Area' || field.label === 'District' ? ' (optional)' : ''}</span>
        <span className={field.status === 'match' ? 'text-green-700' : field.status === 'mismatch' ? 'text-red-700' : ['optional not provided','informational'].includes(field.status) || field.label === 'Facility Name' && field.status === 'review required' ? 'text-slate-600' : 'text-amber-800'}>{statusText(field)}</span>
      </div>
      {(field.label === 'Name of Orderer' || field.label === 'Facility Name') && field.status === 'mismatch' && <p className="text-red-800">
        {field.label === 'Name of Orderer' ? 'Orderer name' : 'Facility name'} does not match between the Customer Request and Fulfilment Confirmation.
      </p>}
      {field.status === 'mismatch' && <p>{field.label === 'Name of Orderer' ? 'ORDERER NAME MISMATCH' : field.label === 'Facility Name' ? 'FACILITY NAME MISMATCH' : ''}</p>}
      <div className="bg-slate-50 p-2 rounded-lg space-y-1">
        <p>Customer Request: {field.customer === 'N/A' ? 'Not available' : field.customer}</p>
        <p>{field.label === 'Name of Orderer' ? 'Fulfilment Confirmation' : 'System Entry'}: {field.system === 'N/A' ? field.unavailable : field.system}</p>
      </div>
      {'reason' in field && field.reason && <p>Reason: {field.reason}</p>}
    </div>)}
    {details.discrepancies.length > 0 && <div className="text-xs text-red-800">
      <h4 className="font-bold">DISCREPANCY FOUND</h4>
      <ul className="list-disc pl-4 mt-2 space-y-1">{details.discrepancies.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
    </div>}
  </section>;
}
