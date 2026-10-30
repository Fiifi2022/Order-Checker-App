// Turns audit results into plain-language "what went wrong / how to fix it" notes.
// Everything is derived from fields the backend already returns; nothing is guessed.

const clean = (value) => String(value ?? '').trim();
const isBlank = (value) => !clean(value) || clean(value).toUpperCase() === 'N/A';
const toNumber = (value) => {
  const n = Number(clean(value).replace(/,/g, ''));
  return Number.isFinite(n) && clean(value) !== '' ? n : null;
};
const quoted = (value) => (isBlank(value) ? 'nothing' : `\u201c${clean(value)}\u201d`);

// Explanation for a single product line, or null when the line needs none.
export function explainItem(item) {
  const name = clean(item.name) || 'This product';
  const requested = clean(item.requested);
  const found = clean(item.found);
  const r = toNumber(requested);
  const f = toNumber(found);
  const gap = r !== null && f !== null ? Math.abs(r - f) : null;
  const action = clean(item.action);

  switch (item.status) {
    case 'quantity mismatch': {
      const direction = gap === null ? '' : (f < r ? ` That is ${gap} short.` : ` That is ${gap} too many.`);
      return {
        type: 'Quantity mismatch',
        wrong: `The client asked for ${requested} of ${name}, but the Fulfillment System entry shows ${found}.${direction}`,
        fix: action || `Change the ${name} quantity in the system entry to ${requested}. If the client changed their request, or an order limit applies, note that instead.`,
      };
    }
    case 'product identity discrepancy':
      return { type: 'Product identity discrepancy', wrong: `${name}: ${action || 'Product identity unresolved.'}`, fix: 'Confirm the product mapping in the existing repository.' };
    case 'missing item':
      return {
        type: 'Missing item',
        wrong: `${name} (${requested}) is in the client's WhatsApp order, but it is not in the Fulfillment System entry.`,
        fix: action || `Add ${name} (${requested}) to the system entry, or confirm with the client that they dropped it.`,
      };
    case 'extra item':
      return {
        type: 'Extra item',
        wrong: `${name} (${found}) is in the Fulfillment System entry, but the client did not ask for it.`,
        fix: action || `Remove ${name} from the system entry, or confirm with the client that they want it added.`,
      };
    case 'out of stock':
      return {
        type: 'Out of stock',
        wrongLabel: 'What happened',
        wrong: `${name} is currently out of stock, so the full request could not be supplied. This is not an entry error.`,
        fix: action || 'Let the client know it is unavailable for now and confirm how they want to proceed.',
      };
    case undefined:
    case 'match':
    case 'order limit applied':
    case 'pending order limit':
      return null;
    default: {
      // A status this app has no special wording for (for example an allocation check).
      const status = clean(item.status);
      return {
        type: status ? status[0].toUpperCase() + status.slice(1) : 'Needs attention',
        wrong: `${name}: the audit reported \u201c${status || 'a problem'}\u201d. Requested ${requested || 'N/A'}, system ${found || 'N/A'}.`,
        fix: action || 'Review this line in the Fulfillment System against the order, then correct it.',
      };
    }
  }
}

function explainField(label, field) {
  if (!field) return null;
  const lower = label.toLowerCase();
  if (field.status === 'mismatch') {
    return {
      type: `${label} mismatch`,
      subject: '',
      wrong: `The ${lower} doesn't match. WhatsApp has ${quoted(field.whatsappValue)}; the Fulfillment System has ${quoted(field.fulfillmentValue)}.`,
      fix: `Check the WhatsApp message and correct the ${lower} in the system entry so both match.`,
    };
  }
  if (field.status === 'not available in system entry') {
    return {
      type: `${label} not found`,
      subject: '',
      wrong: `The WhatsApp order gives ${quoted(field.whatsappValue)}, but no ${lower} was found in the Fulfillment System entry.`,
      fix: `Add the ${lower} from the WhatsApp message to the system entry.`,
    };
  }
  return null;
}

const PRODUCT_DISCREPANCIES = ['quantity mismatch', 'missing item', 'extra item', 'product identity discrepancy'];

// Every discrepancy on the order, header details first and then products.
export function buildIssues(result) {
  const audit = result.generalAudit ?? {};
  const issues = [
    explainField('Orderer name', audit.orderer),
    explainField('Facility name', audit.facility),
    explainField('Phone number', audit.phone),
  ].filter(Boolean);

  for (const review of audit.semanticReviews ?? []) {
    const text = clean(review.originalText);
    issues.push({
      type: 'Ambiguous product',
      subject: text,
      wrong: `${text ? `\u201c${text}\u201d` : 'A line'} in the order could refer to more than one product, so it could not be matched with certainty.`,
      fix: 'Confirm the exact product (strength and form) with the client, then enter its full name in the system entry.',
    });
  }

  for (const item of result.items ?? []) {
    const stage = item.fulfillment?.fulfillmentStatus;
    const isDiscrepancy = stage ? stage === 'discrepancy' : PRODUCT_DISCREPANCIES.includes(item.status);
    if (!isDiscrepancy) continue;
    const explained = explainItem(item);
    if (explained) issues.push({ ...explained, subject: clean(item.name) });
  }
  return issues;
}
