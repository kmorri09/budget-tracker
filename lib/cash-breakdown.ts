export type CashCategory = { id: string; name: string; availableCents: number };

export function calculateCashBreakdown(cashCents: number, availableToAssignCents: number, categories: CashCategory[]) {
  const flexCategory = categories.find(category => ["bonustaxrefund", "bonusrefund"].includes(category.name.toLowerCase().replace(/\band\b/g, "").replace(/[^a-z0-9]/g, "")));
  const fundedCategories = categories
    .filter(category => category.availableCents > 0)
    .sort((a, b) => Number(b.id === flexCategory?.id) - Number(a.id === flexCategory?.id) || b.availableCents - a.availableCents || a.name.localeCompare(b.name));
  const reservedCents = fundedCategories.reduce((sum, category) => sum + category.availableCents, 0);
  const unassignedCents = Math.max(0, availableToAssignCents);
  const plannedCents = reservedCents + unassignedCents;
  const positiveCashCents = Math.max(0, cashCents);
  const unmatchedCents = Math.max(0, positiveCashCents - plannedCents);
  const shortfallCents = Math.max(0, plannedCents - positiveCashCents);
  const overspentCents = categories.reduce((sum, category) => sum + Math.max(0, -category.availableCents), 0);
  const overassignedCents = Math.max(0, -availableToAssignCents);
  // Cash and budget deficits can describe the same gap; do not count it twice.
  const flexNeededCents = Math.max(shortfallCents, overassignedCents);
  const flexLimitCents = Math.max(0, flexCategory?.availableCents ?? 0);
  return {
    fundedCategories,
    reservedCents,
    unassignedCents,
    unmatchedCents,
    shortfallCents,
    overspentCents,
    overassignedCents,
    flex: flexCategory ? {
      categoryId: flexCategory.id,
      categoryName: flexCategory.name,
      limitCents: flexLimitCents,
      neededCents: flexNeededCents,
      usedCents: Math.min(flexNeededCents, flexLimitCents),
      remainingCents: Math.max(0, flexLimitCents - flexNeededCents),
      excessCents: Math.max(0, flexNeededCents - flexLimitCents),
      scaleCents: Math.max(flexLimitCents, flexNeededCents),
    } : null,
    scaleCents: Math.max(positiveCashCents, plannedCents),
    positiveCashCents,
  };
}
