import { suggestCardPayments } from "./card-payment-suggestions";
import { paymentAffordability } from "./payment-affordability";
import type { DashboardData } from "./workspace-types";

export type CashCategory = { id: string; name: string; availableCents: number };

export function calculateCashBreakdown(cashCents: number, availableToAssignCents: number, categories: CashCategory[], cardReserves: { postedCents?: number; pendingCents?: number } = {}) {
  const flexCategory = categories.find(category => ["bonustaxrefund", "bonusrefund"].includes(category.name.toLowerCase().replace(/\band\b/g, "").replace(/[^a-z0-9]/g, "")));
  const fundedCategories = categories
    .filter(category => category.availableCents > 0)
    .sort((a, b) => Number(b.id === flexCategory?.id) - Number(a.id === flexCategory?.id) || b.availableCents - a.availableCents || a.name.localeCompare(b.name));
  const reservedCents = fundedCategories.reduce((sum, category) => sum + category.availableCents, 0);
  const unassignedCents = Math.max(0, availableToAssignCents);
  const postedCardReserveCents = Math.max(0, cardReserves.postedCents ?? 0);
  const pendingCardReserveCents = Math.max(0, cardReserves.pendingCents ?? 0);
  const cardReserveCents = postedCardReserveCents + pendingCardReserveCents;
  const plannedCents = reservedCents + unassignedCents + cardReserveCents;
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
    postedCardReserveCents,
    pendingCardReserveCents,
    cardReserveCents,
    plannedCents,
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

// Explain the same cash and effective allocation funding used by payment review.
// A pending card charge still needs its allocated cash held; it is not payable
// yet. Separate that hold from its category balance so it appears only once.
export function dashboardCashBreakdown(dashboard: Pick<DashboardData, "accounts" | "managedCategories" | "activity" | "payments" | "remainingToBudget">, date: string) {
  const cash = paymentAffordability(dashboard).cashCents;
  const cards = new Set(dashboard.accounts.filter(a => a.type === "credit_card").map(a => a.id));
  const pendingByCategory = new Map<string, number>();
  for (const entry of dashboard.activity) {
    if (entry.kind !== "expense" || ["removed", "void"].includes(entry.status) || !(entry.pending || entry.status === "pending") || entry.date > date || !cards.has(entry.accountId) || !entry.categoryId) continue;
    pendingByCategory.set(entry.categoryId, (pendingByCategory.get(entry.categoryId) ?? 0) + Math.round(entry.amount * 100));
  }
  let pendingCents = 0;
  const categories = dashboard.managedCategories.map(category => {
    const effective = Math.round((category.cardFundingAvailable ?? category.available) * 100);
    const afterPending = effective - (pendingByCategory.get(category.id) ?? 0);
    pendingCents += Math.max(0, effective) - Math.max(0, afterPending);
    return { id: category.id, name: category.name, availableCents: afterPending };
  });
  const postedCents = suggestCardPayments(dashboard, date).reduce((n, card) => n + card.amountCents, 0);
  return calculateCashBreakdown(cash, Math.round(dashboard.remainingToBudget * 100), categories, { postedCents, pendingCents });
}
