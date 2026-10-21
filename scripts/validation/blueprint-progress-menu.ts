// Isolated browser coverage for the facility-specific progress reset menu.
import assert from 'node:assert/strict';
export async function validateBlueprintProgressMenu(page: any, base: string) {
  const saved = async () => (await (await fetch(base + '/api/vaccine/blueprint-districts/validation-sheet/current', { headers: { Authorization: 'Bearer validation-token:0' } })).json()).sheet;
  const saveAction = async (action: () => Promise<any>) => {
    const response = page.waitForResponse((response: any) => response.url().endsWith('/api/vaccine/blueprint-districts') && response.request().method() === 'POST');
    response.catch(() => {}); await action(); assert.equal((await response).status(), 200);
  };
  const cell = (rowId: string, col: number) => page.locator(`[data-grid-cell-row="${rowId}"][data-grid-cell-col="${col}"]`).first();
  const initialSheet = await saved();
  const reset = page.getByRole('menuitem', { name: 'Move progress back to Start', exact: true });
  const checkReset = async () => {
    const before = await saved();
    const original = before.rows.find((row: any) => row.id === 'validation-row');
    await cell('validation-row', 2).click({ button: 'right' });
    await saveAction(() => reset.click());
    assert.equal(await page.getByRole('menu').count(), 0);
    const after = await saved();
    for (const row of after.rows) {
      if (row.id !== original.id) {
        assert.deepEqual(row, before.rows.find((item: any) => item.id === row.id)); continue;
      }
      assert.equal(row.processing, ''); assert.equal(row.completed, '');
      for (const product of before.products) {
        assert.equal(row.vaccines[product].distributed, '');
        assert.equal(row.vaccines[product].allocation, original.vaccines[product].allocation);
        assert.equal(row.vaccines[product].carryOver, original.vaccines[product].carryOver);
        assert.equal(Number(row.vaccines[product].balance), Number(original.vaccines[product].carryOver || 0) + Number(original.vaccines[product].allocation || 0));
      }
    }
    await saveAction(() => page.getByTitle('Undo', { exact: true }).click());
    assert.deepEqual((await saved()).rows, before.rows);
  };
  assert.equal(await page.getByRole('button', { name: 'To Start', exact: true }).count(), 0);
  assert.equal(await page.getByTitle('Move back to Start', { exact: true }).count(), 0);
  const blank = (await saved()).rows.find((row: any) => row.rowKind === 'blank');
  await cell(blank.id, 2).click({ button: 'right' });
  assert.equal(await reset.count(), 0, 'Blank rows must not offer a progress reset');
  await page.getByRole('button', { name: 'Close Freeze menu', exact: true }).click({ position: { x: 2, y: 2 } });
  await saveAction(() => cell('validation-row', 7).locator('input').fill('1'));
  assert.equal(await cell('validation-row', 2).locator('xpath=ancestor::tr').getAttribute('data-progress-status'), 'in_progress');
  await checkReset();
  const beforeCompletion = await saved();
  for (let index = 0; index < beforeCompletion.products.length; index++) {
    const vaccine = beforeCompletion.rows.find((row: any) => row.id === 'validation-row').vaccines[beforeCompletion.products[index]];
    await saveAction(() => cell('validation-row', 7 + index * 4).locator('input').fill(String(Number(vaccine.carryOver || 0) + Number(vaccine.allocation || 0))));
  }
  assert.equal(await cell('validation-row', 2).locator('xpath=ancestor::tr').getAttribute('data-progress-status'), 'completed');
  assert.equal(await page.getByTitle('Move back to Start', { exact: true }).count(), 0);
  await checkReset();
  // Restore the isolated fixture so the subsequent Vaccine Checker still has stock.
  const restored = await fetch(base + '/api/vaccine/blueprint-districts', { method: 'POST', headers: { Authorization: 'Bearer validation-token:0', 'Content-Type': 'application/json' }, body: JSON.stringify({ district: initialSheet, activeId: initialSheet.id }) });
  assert.equal(restored.status, 200);
  assert.deepEqual((await saved()).rows, initialSheet.rows);
  return { inProgressMenu: true, completedMenu: true, noInlineResetButtons: true, blankRowsExcluded: true, clickedFacilityOnly: true, allocationsPreserved: true, undoRestoresProgress: true };
}
