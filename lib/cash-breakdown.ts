export type CashCategory = { id: string; name: string; availableCents: number };

export function calculateCashBreakdown(cashCents: number, availableToAssignCents: number, categories: CashCategory[]) {
  const fundedCategories = categories
    .filter(category => category.availableCents > 0)
    .sort((a, b) => b.availableCents - a.availableCents || a.name.localeCompare(b.name));
  const reservedCents = fundedCategories.reduce((sum, category) => sum + category.availableCents, 0);
  const unassignedCents = Math.max(0, availableToAssignCents);
  const plannedCents = reservedCents + unassignedCents;
  const positiveCashCents = Math.max(0, cashCents);
  const unmatchedCents = Math.max(0, positiveCashCents - plannedCents);
  const shortfallCents = Math.max(0, plannedCents - positiveCashCents);
  const overspentCents = categories.reduce((sum, category) => sum + Math.max(0, -category.availableCents), 0);
  return {
    fundedCategories,
    reservedCents,
    unassignedCents,
    unmatchedCents,
    shortfallCents,
    overspentCents,
    overassignedCents: Math.max(0, -availableToAssignCents),
    scaleCents: Math.max(positiveCashCents, plannedCents),
    positiveCashCents,
  };
}
