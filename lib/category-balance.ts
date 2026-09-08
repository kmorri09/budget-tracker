export type AllocationAmount = { categoryId: string; amountCents: number };
export type CategoryTransactionAmount = { categoryId: string | null; kind: string; amountCents: number; status?: string };

export function calculateCategoryBalance(categoryId: string, allocations: AllocationAmount[], transactions: CategoryTransactionAmount[]) {
  const allocatedCents = allocations.filter(row => row.categoryId === categoryId).reduce((sum, row) => sum + row.amountCents, 0);
  const active = transactions.filter(row => row.status !== "removed");
  const spendingCents = active.filter(row => row.categoryId === categoryId && row.kind === "expense").reduce((sum, row) => sum + row.amountCents, 0);
  const refundCents = active.filter(row => row.categoryId === categoryId && row.kind === "refund").reduce((sum, row) => sum + row.amountCents, 0);
  return { allocatedCents, spendingCents, refundCents, availableCents: allocatedCents - spendingCents + refundCents };
}

export function categoryReconciliationDeltaCents(desiredAvailable: number, currentAvailableCents: number) {
  return Math.round(desiredAvailable * 100) - currentAvailableCents;
}
