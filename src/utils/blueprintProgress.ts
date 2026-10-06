export interface BlueprintProgressVaccine {
  carryOver?: number | string | null;
  allocation?: number | string | null;
  distributed?: number | string | null;
}

export interface BlueprintProgressRow {
  facility?: string | null;
  processing?: string | null;
  vaccines?: Record<string, BlueprintProgressVaccine | undefined>;
}

export type BlueprintProgressStatus = 'completed' | 'in_progress' | 'pending';

function quantity(value: number | string | null | undefined): number {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A named facility is complete once every entered vaccine balance is zero,
 * in progress after quantity entry or a start date, and pending otherwise.
 */
export function getBlueprintProgressStatus(
  row: BlueprintProgressRow | null | undefined,
  products: string[]
): BlueprintProgressStatus {
  if (!row?.facility?.trim()) return 'pending';

  const active = products.flatMap(product => {
    const vaccine = row.vaccines?.[product];
    if (!vaccine) return [];
    const hasQuantity = [vaccine.carryOver, vaccine.allocation, vaccine.distributed].some(
      value => value !== null && value !== undefined && String(value).trim() !== ''
    );
    if (!hasQuantity) return [];
    const carryOver = quantity(vaccine.carryOver);
    const allocation = quantity(vaccine.allocation);
    const distributed = quantity(vaccine.distributed);
    return [{ carryOver, allocation, distributed }];
  });

  if (active.length === 0) {
    const processing = row.processing?.trim().toLowerCase();
    return processing && !processing.includes('pending') && !processing.includes('completed')
      ? 'in_progress' : 'pending';
  }

  const allBalancesZero = active.every(({ carryOver, allocation, distributed }) =>
    carryOver + allocation - distributed === 0
  );
  if (allBalancesZero) return 'completed';

  return 'in_progress';
}
