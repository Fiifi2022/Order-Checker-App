import { generalFacilityDisplayStatus } from '../utils/generalFacility';
import { generalEssentialReviewNotices } from '../utils/generalAuditReviews';
import type { GeneralAuditDetails as Details } from '../utils/generalAuditTypes';

export default function GeneralAuditDetails({ details }: { details: Details }) {
  const reviewNotices = generalEssentialReviewNotices(details.semanticReviews).filter(notice => notice.field !== 'facilityName');
  const optionalAbsent = { whatsappValue: 'N/A', fulfillmentValue: 'N/A', status: 'optional not provided' as const };
  const productStatus = details.productCount.requested === 0 || details.productCount.found === 0 ? 'missing from customer request'
    : details.products.some(product => product.fulfillmentStatus === 'discrepancy') ? 'mismatch'
    : details.pendingOrderLimitCount || reviewNotices.some(notice => notice.field === 'products' || notice.field === 'quantity') ? 'review required' : 'match';
  const fields = [
    { unavailable: 'Not available', label: 'Facility Name', required: true, customer: details.facility.whatsappValue, system: details.facility.fulfillmentValue, status: generalFacilityDisplayStatus(details.facility) },
    { unavailable: 'Not found', label: 'Name of Orderer', required: true, customer: details.orderer.whatsappValue, system: details.orderer.fulfillmentValue, status: details.orderer.status },
    ...([['Delivery/Drop Area', details.dropArea], ['District', details.district]] as const).map(([label, field]) => ({ unavailable: 'Not provided — optional', label, required: false, customer: (field || optionalAbsent).whatsappValue, system: (field || optionalAbsent).fulfillmentValue, status: (field || optionalAbsent).status })),
    { unavailable: 'Not available', label: 'Products and Quantities', required: true, customer: `${details.productCount.requested} products`, system: `${details.productCount.found} products`, status: productStatus }
  ];
  const statusText = (field: typeof fields[number]) => {
    if (field.status === 'optional not provided' || !field.required && (field.status === 'missing from customer request' || field.status === 'not available in system entry')) return field.customer === 'N/A' && field.system === 'N/A' ? 'OPTIONAL — NOT PROVIDED'
      : `OPTIONAL — NOT PROVIDED IN ${field.customer === 'N/A' ? 'CUSTOMER REQUEST' : 'FULFILMENT'}`;
    if (field.required && (field.status === 'missing from customer request' || field.status === 'not available in system entry')) return 'MISSING REQUIRED INFORMATION';
    if (field.status === 'review required') return field.label === 'Facility Name' ? 'NOT COMPARED' : 'MANUAL REVIEW REQUIRED';
    if (field.status === 'match') return field.label === 'Facility Name' ? 'MATCH' : 'VERIFIED MATCH';
    if (field.label === 'Delivery/Drop Area') return 'LOCATION MISMATCH — MANUAL REVIEW REQUIRED';
    if (field.label === 'District') return 'DISTRICT MISMATCH — MANUAL REVIEW REQUIRED';
    return 'DISCREPANCY';
  };
  return <section className="bg-white p-5 rounded-2xl border border-purple-100 shadow-sm space-y-4" aria-label="General audit field results">
    <h4 className="text-sm font-bold text-[#3B1A5E]">Identity and order checks</h4>
    {reviewNotices.map(notice => <p key={notice.field} role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl">{notice.message}</p>)}
    {fields.map(field => <div key={field.label} className="space-y-1 text-xs">
      <div className="flex flex-wrap justify-between gap-2 font-semibold">
        <span>{field.label}{field.required ? ' (mandatory)' : field.label === 'Delivery/Drop Area' || field.label === 'District' ? ' (optional)' : ''}</span>
        <span className={field.status === 'match' ? 'text-green-700' : field.status === 'mismatch' ? 'text-red-700' : field.status === 'optional not provided' || field.label === 'Facility Name' && field.status === 'review required' ? 'text-slate-600' : 'text-amber-800'}>{statusText(field)}</span>
      </div>
      {(field.label === 'Name of Orderer' || field.label === 'Facility Name') && (field.status === 'mismatch' || field.status === 'not available in system entry' || field.status === 'missing from customer request') && <div className="text-red-800 space-y-1">
        {field.status !== 'mismatch' && <p>{field.label === 'Name of Orderer' ? 'ORDERER NAME NOT FOUND' : 'FACILITY NOT FOUND'}</p>}
        <p>{field.status === 'mismatch'
          ? `${field.label === 'Name of Orderer' ? 'Orderer name' : 'Facility name'} does not match between the Customer Request and Fulfilment Confirmation.`
          : `${field.label === 'Name of Orderer' ? 'Orderer name' : 'Facility name'} was not found in the ${field.status === 'missing from customer request' ? 'Customer Request' : 'Fulfilment Confirmation'}. Missing required information. Review required.`}</p>
        <p className="font-semibold">{field.label === 'Name of Orderer' ? "Verify the orderer's name before dispatch." : 'Enter the facility name.'}</p>
      </div>}
      {field.status === 'mismatch' && <p>{field.label === 'Name of Orderer' ? 'ORDERER NAME MISMATCH' : field.label === 'Facility Name' ? 'FACILITY NAME MISMATCH' : ''}</p>}
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
