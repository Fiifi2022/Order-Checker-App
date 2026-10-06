import { generalProductDisplayName } from '../utils/generalAuditor';
import type { GeneralAuditDetails as Details } from '../utils/generalAuditTypes';

export default function GeneralAuditDetails({ details }: { details: Details }) {
  const fields = [
    { unavailable: 'Not available', label: 'Facility Name', customer: details.facility.whatsappValue, system: details.facility.fulfillmentValue, status: details.facility.status },
    { unavailable: 'Not found', label: 'Name of Orderer', customer: details.orderer.whatsappValue, system: details.orderer.fulfillmentValue, status: details.orderer.status },
    ...(details.phone.whatsappValue !== 'N/A' || details.phone.fulfillmentValue !== 'N/A' ? [{ unavailable: 'Not available', label: 'Phone Number (optional)', customer: details.phone.whatsappValue, system: details.phone.fulfillmentValue, status: details.phone.status }] : []),
    { unavailable: 'Not available', label: 'Product Count', customer: details.productCount.requested, system: details.productCount.found, status: details.productCount.status }
  ];
  return <section className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm space-y-4" aria-label="General audit field results">
    <h4 className="text-sm font-bold text-[#3B1A5E]">Identity and order checks</h4>
    {details.semanticReviews?.map((review, index) => <div key={index} className="text-xs text-red-800 bg-red-50 border border-red-200 p-3 rounded-xl space-y-1">
      <p className="font-semibold">AMBIGUOUS PRODUCT</p>
      <p>{generalProductDisplayName(review.originalText)}</p>
      <p>{review.reason}</p>
      {!!review.possibleMatches.length && <p>Possible matches: {review.possibleMatches.join(' • ')}</p>}
    </div>)}
    {fields.map(field => <div key={field.label} className="space-y-1 text-xs">
      <div className="flex flex-wrap justify-between gap-2 font-semibold">
        <span>{field.label}</span>
        <span className={field.status === 'match' ? 'text-green-700' : field.status === 'mismatch' || field.status === 'not available in system entry' && field.label !== 'Phone Number (optional)' ? 'text-red-700' : 'text-slate-600'}>
          {field.status === 'mismatch' ? `${field.label === 'Name of Orderer' ? 'ORDERER NAME' : field.label.toUpperCase()} MISMATCH` : field.status !== 'match' && (field.label === 'Name of Orderer' || field.label === 'Facility Name') ? `${field.label === 'Name of Orderer' ? 'ORDERER NAME' : 'FACILITY'} NOT FOUND` : field.status.toUpperCase()}
        </span>
      </div>
      {(field.label === 'Name of Orderer' || field.label === 'Facility Name') && (field.status === 'mismatch' || field.status === 'not available in system entry') && <div className="text-red-800 space-y-1">
        <p>{field.status === 'mismatch'
          ? `${field.label === 'Name of Orderer' ? 'Orderer name' : 'Facility name'} does not match between the Customer Request and Fulfilment Confirmation.`
          : `${field.label === 'Name of Orderer' ? 'Orderer name' : 'Facility name'} was not found in the Fulfilment Confirmation. Review required.`}</p>
        <p className="font-semibold">{field.label === 'Name of Orderer' ? "Verify the orderer's name before dispatch." : 'Verify the facility before dispatch.'}</p>
      </div>}
      <div className="bg-slate-50 p-2 rounded-lg space-y-1">
        <p>Customer Request: {field.customer === 'N/A' ? 'Not available' : field.customer}</p>
        <p>System Entry: {field.system === 'N/A' ? field.unavailable : field.system}</p>
      </div>
    </div>)}
    {details.discrepancies.length > 0 && <div className="text-xs text-red-800">
      <h4 className="font-bold">DISCREPANCY FOUND</h4>
      <ul className="list-disc pl-4 mt-2 space-y-1">{details.discrepancies.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
    </div>}
  </section>;
}
