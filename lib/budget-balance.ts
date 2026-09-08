type TransactionAmount = { kind: string; amountCents: number; status?: string };
type Amount = { amountCents: number };

export function calculateAvailableToAssignCents(transactions: TransactionAmount[], allocations: Amount[], adjustments: Amount[]) {
  const incomeCents = transactions
    .filter(transaction => transaction.status !== "removed" && transaction.kind === "income")
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const allocatedCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const adjustmentCents = adjustments.reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
  return { incomeCents, allocatedCents, adjustmentCents, availableCents: incomeCents + adjustmentCents - allocatedCents };
}
