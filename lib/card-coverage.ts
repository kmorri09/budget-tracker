export type CoverageState = "paid" | "unpaid";

export function coverageReconciliation(transactionAmountCents: number, currentCoverageCents: number, state: CoverageState) {
  const currentCents = Math.max(0, currentCoverageCents);
  const desiredCents = state === "paid" ? transactionAmountCents : 0;
  return { currentCents, desiredCents, deltaCents: desiredCents - currentCents };
}
