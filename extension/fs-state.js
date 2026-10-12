export function quantityStatus(quantity, balance, committed = 0) {
  if (quantity === '' || quantity === null || quantity === undefined) return 'Enter a requested quantity.';
  const n = Number(quantity);
  if (!Number.isSafeInteger(n) || n <= 0) return 'Invalid quantity. Enter a positive whole number.';
  if (!Number.isFinite(balance) || balance < 0) return 'Allocation balance unavailable.';
  const available = Math.max(0, balance - committed);
  return n <= available ? 'Within available allocation.' : `Requested quantity exceeds allocation. Available: ${available}.`;
}
export function confirmedAddition(before, after, draft) {
  if (!draft?.name || !Number.isSafeInteger(Number(draft.quantity)) || Number(draft.quantity) <= 0) return false;
  const same = p => draft.id && p.id ? p.id === draft.id : p.name === draft.name;
  const total = rows => rows.filter(same).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
  return total(after) - total(before) === Number(draft.quantity);
}
export function cleanSelection(raw) {
  const str = v => typeof v === 'string' ? v.trim().slice(0, 160) : '';
  const product = p => ({ id: str(p?.id), name: str(p?.name), quantity: str(p?.quantity) });
  return { facility: { id: str(raw?.facility?.id), name: str(raw?.facility?.name), district: str(raw?.facility?.district), region: str(raw?.facility?.region) },
    draft: raw?.draft?.name ? product(raw.draft) : null, order: Array.isArray(raw?.order) ? raw.order.slice(0, 100).map(product).filter(p => p.name) : [],
    ...(raw?.script ? { script: { orderKey: str(raw.script.orderKey), text: typeof raw.script.text === 'string' ? raw.script.text : null } } : {}) };
}
export function selectionProducts(selection) { return [...selection.order, ...(selection.draft ? [selection.draft] : [])]; }
