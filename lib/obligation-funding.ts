export type FundableObligation = { id: string; categoryId: string; name: string; amountCents: number };
export type CategoryBalance = { id: string; name: string; availableCents: number };

export function calculateObligationFunding(obligations: FundableObligation[], categories: CategoryBalance[]) {
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const grouped = new Map<string, { categoryId: string; category: string; obligationIds: string[]; obligationNames: string[]; obligationCents: number; availableCents: number }>();
  for (const obligation of obligations) {
    const category = categoryById.get(obligation.categoryId);
    if (!category) continue;
    const group = grouped.get(category.id) ?? { categoryId: category.id, category: category.name, obligationIds: [], obligationNames: [], obligationCents: 0, availableCents: category.availableCents };
    group.obligationIds.push(obligation.id);
    group.obligationNames.push(obligation.name);
    group.obligationCents += obligation.amountCents;
    grouped.set(category.id, group);
  }
  return [...grouped.values()].map(group => ({ ...group, allocationCents: Math.max(0, group.obligationCents - group.availableCents) }));
}
