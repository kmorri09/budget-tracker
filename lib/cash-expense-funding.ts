import type { DashboardData } from "./workspace-types";

type FundingTransaction = { id: string; accountId: string; categoryId: string | null; kind: string; status: string; pending: boolean; effectiveDate: string; amountCents: number };

export function calculateCashExpenseFunding(
  accounts: { id: string; type: string }[],
  categories: { id: string; active: boolean }[],
  allocations: { categoryId: string; amountCents: number; effectiveDate: string }[],
  transactions: FundingTransaction[],
  throughDate: string,
) {
  const cashAccounts = new Set(accounts.filter(account => account.type !== "credit_card").map(account => account.id));
  const activeCategories = new Set(categories.filter(category => category.active).map(category => category.id));
  const cashSpent = new Map<string, number>();
  const funding = new Map<string, number>();
  const uncategorizedIds: string[] = [];
  for (const allocation of allocations) {
    if (allocation.effectiveDate > throughDate) continue;
    funding.set(allocation.categoryId, (funding.get(allocation.categoryId) ?? 0) + allocation.amountCents);
  }
  for (const entry of transactions) {
    if (entry.pending || !["posted", "cleared"].includes(entry.status) || entry.effectiveDate > throughDate) continue;
    if (entry.kind === "refund" && entry.categoryId) {
      funding.set(entry.categoryId, (funding.get(entry.categoryId) ?? 0) + entry.amountCents);
    }
    if (entry.kind !== "expense" || !cashAccounts.has(entry.accountId)) continue;
    if (!entry.categoryId || !activeCategories.has(entry.categoryId)) {
      uncategorizedIds.push(entry.id);
      continue;
    }
    cashSpent.set(entry.categoryId, (cashSpent.get(entry.categoryId) ?? 0) + entry.amountCents);
  }
  // Give spending that already left cash priority over credit-card purchases.
  const shortfalls = [...cashSpent].map(([categoryId, cashSpentCents]) => ({
    categoryId, cashSpentCents, amountCents: Math.max(0, cashSpentCents - (funding.get(categoryId) ?? 0)),
  })).filter(item => item.amountCents > 0);
  return { shortfalls, uncategorizedIds };
}

export function dashboardCashExpenseFunding(dashboard: Pick<DashboardData, "managedAccounts" | "managedCategories" | "allocations" | "activity">, throughDate: string) {
  return calculateCashExpenseFunding(
    dashboard.managedAccounts, dashboard.managedCategories,
    dashboard.allocations.map(entry => ({ categoryId: entry.categoryId, amountCents: Math.round(entry.amount * 100), effectiveDate: entry.date })),
    dashboard.activity.map(entry => ({ ...entry, amountCents: Math.round(entry.amount * 100), effectiveDate: entry.date })),
    throughDate,
  );
}
