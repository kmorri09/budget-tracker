import type { Account, DashboardData } from "./workspace-types";

export function cashAccountAvailability(account: Account, now = Date.now()) {
  const ledger = Math.round(account.ledgerBalance * 100);
  const available = account.providerAvailableBalance;
  const balanceAt = account.providerAvailableBalanceAt ?? account.providerBalanceAt;
  const updated = balanceAt ? Date.parse(balanceAt) : NaN;
  const verified = available != null && Number.isFinite(updated) && now - updated <= 48 * 60 * 60 * 1000 && updated <= now + 60_000;
  // The ledger already includes pending withdrawals. Taking the lower balance
  // avoids subtracting them twice or using a bank's larger current balance.
  // Retain a known lower bank balance even when it is old; staleness must never
  // increase a suggestion. A new sync can replace it with current information.
  const bankLimit = available ?? account.providerBalance;
  return { accountId: account.id, name: account.name, availableCents: Math.min(ledger, bankLimit == null ? ledger : Math.round(bankLimit * 100)), verified, updatedAt: balanceAt };
}

export function paymentAffordability(dashboard: Pick<DashboardData, "accounts" | "managedCategories"> & Partial<Pick<DashboardData, "remainingToBudget">>, sourceAccountId?: string, now = Date.now()) {
  const accounts = dashboard.accounts.filter(a => a.active && a.type !== "credit_card").map(a => cashAccountAvailability(a, now));
  const cashCents = accounts.reduce((sum, a) => sum + a.availableCents, 0);
  // Positive balances are money left for other uses after purchases. Obligations
  // funded in those categories must not be reserved a second time.
  const reservedCents = dashboard.managedCategories.reduce((sum, c) => sum + Math.max(0, Math.round((c.cardFundingAvailable ?? c.available) * 100)), 0);
  // Category-backed purchases must not quietly consume the unassigned pool.
  // Allocate that money first so the budget cannot promise it again afterward.
  const unassignedCents = Math.max(0, Math.round((dashboard.remainingToBudget ?? 0) * 100));
  const totalAffordableCents = Math.max(0, cashCents - reservedCents - unassignedCents);
  const source = accounts.find(a => a.accountId === sourceAccountId);
  const affordableCents = sourceAccountId ? Math.max(0, Math.min(totalAffordableCents, source?.availableCents ?? 0)) : totalAffordableCents;
  return { accounts, cashCents, reservedCents, unassignedCents, totalAffordableCents, affordableCents, needsBankVerification: accounts.some(a => !a.verified) };
}
