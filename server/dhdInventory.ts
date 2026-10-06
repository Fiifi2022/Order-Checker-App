export interface DhdInventoryEntry {
  id: string;
  requestId: string;
  type: 'top_up' | 'stock_adjustment';
  timestamp: string;
  district: string;
  cycle?: string;
  facility?: string;
  facilityRowId?: string;
  vaccine: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  distributedAfter?: number;
  user: string;
  note?: string;
}

export interface DhdInventory {
  district: string;
  stocks: Record<string, number>;
  history: DhdInventoryEntry[];
  updatedAt: string;
}

export interface BlueprintTopUpSheet {
  id: string;
  district: string;
  month: string;
  products: string[];
  deletedColumnKeys?: string[];
  rows: Array<{ id: string; facility: string; vaccines: Record<string, { carryOver?: number | string; allocation?: number | string; distributed?: number | string; balance?: number | string; dhdTopUpTotal?: number }> }>;
  [key: string]: unknown;
}

export type DhdTopUpResult =
  | { success: true; inventory: DhdInventory; sheet: BlueprintTopUpSheet; entry: DhdInventoryEntry; duplicate: boolean }
  | { success: false; error: string; status: number; available?: number };

export function preserveDhdTopUpsOnStaleSheet<T extends BlueprintTopUpSheet>(incoming: T, current: BlueprintTopUpSheet): T {
  const rows = incoming.rows.map(row => {
    const priorRow = current.rows.find(item => item.id === row.id);
    if (!priorRow) return row;
    const vaccines = { ...row.vaccines };
    for (const [product, priorValue] of Object.entries(priorRow.vaccines || {})) {
      if (!incoming.products.includes(product)) continue;
      const latestTotal = Number(priorValue.dhdTopUpTotal) || 0;
      const incomingValue = vaccines[product] || {};
      const incomingTotal = Number(incomingValue.dhdTopUpTotal) || 0;
      if (latestTotal <= incomingTotal) continue;
      const currentAllocation = Number(priorValue.allocation) || 0;
      const incomingAllocation = Number(incomingValue.allocation) || 0;
      const missingAllocation = Math.max(0, currentAllocation - incomingAllocation);
      const distributed = Number(priorValue.distributed) || 0;
      const carryOver = Number(incomingValue.carryOver) || 0;
      const allocation = incomingAllocation + missingAllocation;
      const safeDistributed = Math.max(distributed, Number(incomingValue.distributed) || 0);
      vaccines[product] = {
        ...incomingValue,
        allocation,
        distributed: safeDistributed,
        balance: carryOver + allocation - safeDistributed,
        dhdTopUpTotal: latestTotal
      };
      for (const field of ['carryOver', 'allocation', 'distributed', 'balance'] as const) {
        if (incoming.deletedColumnKeys?.includes(`vaccine:${product}:${field}`)) vaccines[product][field] = '';
      }
    }
    return { ...row, vaccines };
  });
  return { ...incoming, rows } as T;
}

export function applyConfirmedDhdTopUp(input: {
  inventory: DhdInventory;
  sheet: BlueprintTopUpSheet;
  rowId: string;
  vaccine: string;
  quantity: number;
  distributedAfter: number;
  requestId: string;
  user: string;
  now?: string;
}): DhdTopUpResult {
  const { inventory, sheet, rowId, vaccine, quantity, distributedAfter, requestId } = input;
  const prior = inventory.history.find(entry => entry.requestId === requestId);
  if (prior?.type === 'top_up') return { success: true, inventory, sheet, entry: prior, duplicate: true };
  if (!requestId || !rowId || !vaccine || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(distributedAfter) || distributedAfter < 0) {
    return { success: false, error: 'A valid facility, vaccine, quantity, and request ID are required.', status: 400 };
  }
  if (!sheet.products.includes(vaccine)) return { success: false, error: 'The vaccine is not on this allocation sheet.', status: 400 };
  const row = sheet.rows.find(item => item.id === rowId && item.facility?.trim());
  if (!row) return { success: false, error: 'Facility row not found on this allocation sheet.', status: 404 };
  const current = row.vaccines?.[vaccine] || {};
  const carryOver = Number(current.carryOver) || 0;
  const allocation = Number(current.allocation) || 0;
  const availableBefore = carryOver + allocation;
  const required = Math.max(0, distributedAfter - availableBefore);
  if (required <= 0 || Math.abs(required - quantity) > 1e-9) {
    return { success: false, error: 'The top-up quantity no longer matches the facility overage. Refresh and try again.', status: 409 };
  }
  const stockBefore = Number(inventory.stocks[vaccine]) || 0;
  if (stockBefore < quantity) return { success: false, error: `DHD stock has ${stockBefore} available; ${quantity} is required.`, status: 409, available: stockBefore };

  const now = input.now || new Date().toISOString();
  const stockAfter = stockBefore - quantity;
  const entry: DhdInventoryEntry = {
    id: requestId,
    requestId,
    type: 'top_up',
    timestamp: now,
    district: sheet.district,
    cycle: sheet.month,
    facility: row.facility,
    facilityRowId: row.id,
    vaccine,
    quantity,
    stockBefore,
    stockAfter,
    distributedAfter,
    user: input.user || 'Unknown user'
  };
  const nextInventory: DhdInventory = {
    ...inventory,
    stocks: { ...inventory.stocks, [vaccine]: stockAfter },
    history: [...inventory.history, entry],
    updatedAt: now
  };
  const nextRows = sheet.rows.map(item => {
    if (item.id !== rowId) return item;
    const before = item.vaccines?.[vaccine] || {};
    const nextAllocation = (Number(before.allocation) || 0) + quantity;
    return {
      ...item,
      vaccines: {
        ...item.vaccines,
        [vaccine]: {
          ...before,
          allocation: nextAllocation,
          distributed: distributedAfter,
          balance: carryOver + nextAllocation - distributedAfter,
          dhdTopUpTotal: (Number(before.dhdTopUpTotal) || 0) + quantity
        }
      }
    };
  });
  const nextSheet = { ...sheet, rows: nextRows, updatedAt: now };
  return { success: true, inventory: nextInventory, sheet: nextSheet, entry, duplicate: false };
}
