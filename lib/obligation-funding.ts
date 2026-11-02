export type FundableObligation = { id: string; categoryId: string; name: string; amountCents: number };
export type CategoryBalance = { id: string; name: string; availableCents: number; cashReserveCents?: number; cashReserveShortfallCents?: number };

export function calculateObligationFunding(obligations: FundableObligation[], categories: CategoryBalance[]) {
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const grouped = new Map<string, { categoryId: string; category: string; obligationIds: string[]; obligationNames: string[]; obligationCents: number; availableCents: number; cashReserveCents: number; cashReserveShortfallCents: number; pooledReserve: boolean }>();
  for (const obligation of obligations) {
    if (obligation.amountCents === 0) continue;
    const category = categoryById.get(obligation.categoryId);
    if (!category) continue;
    const group = grouped.get(category.id) ?? { categoryId: category.id, category: category.name, obligationIds: [], obligationNames: [], obligationCents: 0, availableCents: category.availableCents, cashReserveCents: category.cashReserveCents ?? 0, cashReserveShortfallCents: category.cashReserveShortfallCents ?? 0, pooledReserve: category.cashReserveCents !== undefined };
    group.obligationIds.push(obligation.id);
    group.obligationNames.push(obligation.name);
    group.obligationCents += obligation.amountCents;
    grouped.set(category.id, group);
  }
  return [...grouped.values()].map(group => {
    const requestedCents = group.cashReserveCents + group.cashReserveShortfallCents;
    const reserveCents = Math.max(0, group.obligationCents - requestedCents);
    const restoreCents = Math.max(0, Math.min(group.obligationCents, requestedCents) - group.cashReserveCents);
    const freeCents = Math.max(0, group.availableCents - group.cashReserveCents);
    return { ...group, reserveCents, allocationCents: group.pooledReserve ? restoreCents + Math.max(0, reserveCents - freeCents) : Math.max(0, group.obligationCents - group.availableCents) };
  });
}
