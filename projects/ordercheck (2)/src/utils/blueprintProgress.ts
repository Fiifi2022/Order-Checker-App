export interface BlueprintProgressVaccine {
  carryOver?: number | string | null;
  allocation?: number | string | null;
  distributed?: number | string | null;
}

export interface BlueprintProgressRow {
  facility?: string | null;
  vaccines?: Record<string, BlueprintProgressVaccine | undefined>;
}

export type BlueprintProgressStatus = 'completed' | 'in_progress' | 'pending';

function quantity(value: number | string | null | undefined): number {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Derive blueprint progress from vaccine movement only.
 * A named facility is complete once every active vaccine balance is zero,
 * in progress after any stock has been distributed, and pending otherwise.
 */
export function getBlueprintProgressStatus(
  row: BlueprintProgressRow | null | undefined,
  products: string[]
): BlueprintProgressStatus {
  if (!row?.facility?.trim()) return 'pending';

  const active = products.flatMap(product => {
    const vaccine = row.vaccines?.[product];
    if (!vaccine) return [];
    const carryOver = quantity(vaccine.carryOver);
    const allocation = quantity(vaccine.allocation);
    const distributed = quantity(vaccine.distributed);
    if (carryOver <= 0 && allocation <= 0 && distributed <= 0) return [];
    return [{ carryOver, allocation, distributed }];
  });

  if (active.length === 0) return 'pending';

  const allBalancesZero = active.every(({ carryOver, allocation, distributed }) =>
    carryOver + allocation - distributed === 0
  );
  if (allBalancesZero) return 'completed';

  return active.some(vaccine => vaccine.distributed > 0) ? 'in_progress' : 'pending';
}
