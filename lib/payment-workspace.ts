import { calculateAvailableToAssignCents } from "./budget-balance";
import { budgetToday } from "./budget-date";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "./db";
import { accounts, allocations, categories, transactions, cardPayments, cardPaymentApplications, cardCoverageAdjustments, cardRefundMatches, providerAccounts, budgetAdjustments } from "./schema";
import { calculateCategoryBalance } from "./category-balance";
import { calculateAccountLedgerCents } from "./account-ledger";
import { calculateCardPurchaseCoverage } from "./card-refunds";

export function paymentReviewToken(data: unknown[]) {
  return createHash("sha256").update(JSON.stringify(data.map(value => Array.isArray(value) ? [...value].sort((a, b) => String(a.id ?? JSON.stringify(a)).localeCompare(String(b.id ?? JSON.stringify(b)))) : value))).digest("hex");
}

// Also accepts a Drizzle transaction so validation and payment writes share one
// serializable snapshot. Use exactly the dashboard's coverage and cash math.
export async function loadPaymentWorkspace(db: Pick<Database, "select">, userId: string, throughDate: string, excludePaymentId?: string) {
  const [accountRows, categoryRows, transactionRows, allocationRows, allPayments, allApplications, coverageRows, refundDecisions, providerRows, adjustmentRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)), db.select().from(categories).where(eq(categories.userId, userId)),
    db.select().from(transactions).where(eq(transactions.userId, userId)), db.select().from(allocations).where(eq(allocations.userId, userId)),
    db.select().from(cardPayments).where(eq(cardPayments.userId, userId)), db.select().from(cardPaymentApplications).where(eq(cardPaymentApplications.userId, userId)),
    db.select().from(cardCoverageAdjustments).where(eq(cardCoverageAdjustments.userId, userId)), db.select().from(cardRefundMatches).where(eq(cardRefundMatches.userId, userId)),
    db.select().from(providerAccounts).where(eq(providerAccounts.userId, userId)), db.select().from(budgetAdjustments).where(eq(budgetAdjustments.userId, userId)),
  ]);
  const paymentRows = allPayments.filter(p => p.id !== excludePaymentId && p.effectiveDate <= throughDate);
  const applicationRows = allApplications.filter(a => paymentRows.some(p => p.id === a.paymentId));
  const cardIds = new Set(accountRows.filter(a => a.type === "credit_card").map(a => a.id));
  const cardCoverage = calculateCardPurchaseCoverage(transactionRows, cardIds, refundDecisions, [...applicationRows, ...coverageRows.filter(c => c.effectiveDate <= throughDate)], throughDate);
  const cashThroughDate = budgetToday();
  const viewAccounts = accountRows.map(account => {
    const provider = providerRows.find(p => p.localAccountId === account.id);
    return { ...account, openingBalance: account.openingBalanceCents / 100, providerBalance: account.providerBalanceCents === null ? null : account.providerBalanceCents / 100, providerAvailableBalance: provider?.availableBalanceCents == null ? null : provider.availableBalanceCents / 100, providerAvailableBalanceAt: provider?.balanceAt?.toISOString() ?? null, providerBalanceAt: account.providerBalanceAt?.toISOString() ?? null, ledgerBalance: calculateAccountLedgerCents(account.id, account.openingBalanceCents, transactionRows.filter(t => t.accountId === account.id && t.effectiveDate <= cashThroughDate), allPayments.filter(p => p.id !== excludePaymentId && p.effectiveDate <= cashThroughDate)) / 100 };
  });
  const managedCategories = categoryRows.map(c => ({ ...c, icon: c.icon ?? "", target: c.targetCents / 100, available: calculateCategoryBalance(c.id, allocationRows, transactionRows).availableCents / 100, allocated: 0, spent: 0 }));
  const activity = transactionRows.filter(t => !["removed", "void"].includes(t.status)).map(t => ({ ...t, date: t.effectiveDate, amount: t.amountCents / 100, account: accountRows.find(a => a.id === t.accountId)?.name ?? "", category: categoryRows.find(c => c.id === t.categoryId)?.name ?? null, remainingToPay: (cardCoverage.coverage.get(t.id)?.remainingCents ?? t.amountCents) / 100, paymentStatus: cardCoverage.coverage.get(t.id)?.status ?? "Not applicable" }));
  const payments = paymentRows.map(p => ({ ...p, date: p.effectiveDate, amount: p.amountCents / 100, fromAccount: accountRows.find(a => a.id === p.fromAccountId)?.name ?? "", toAccount: accountRows.find(a => a.id === p.toAccountId)?.name ?? "", applied: applicationRows.filter(a => a.paymentId === p.id).reduce((sum, a) => sum + a.amountCents, 0) / 100, remaining: (p.amountCents - applicationRows.filter(a => a.paymentId === p.id).reduce((sum, a) => sum + a.amountCents, 0)) / 100, status: "Recorded", covered: "", applications: applicationRows.filter(a => a.paymentId === p.id).map(a => ({ transactionId: a.transactionId, amount: a.amountCents / 100 })), providerLinked: Boolean(p.providerTransactionId || p.destinationProviderTransactionId), editable: true }));
  const token = paymentReviewToken([throughDate, accountRows.map(a => ({ id: a.id, active: a.active, type: a.type, openingBalanceCents: a.openingBalanceCents, providerBalanceCents: a.providerBalanceCents })), providerRows.map(p => ({ id: p.id, available: p.availableBalanceCents })), transactionRows.map(t => ({ id: t.id, amount: t.amountCents, kind: t.kind, status: t.status, pending: t.pending, category: t.categoryId, account: t.accountId, date: t.effectiveDate, description: t.description })), allocationRows.map(a => ({ id: a.id, amount: a.amountCents, category: a.categoryId })), allPayments, allApplications, coverageRows, refundDecisions, adjustmentRows]);
  return { remainingToBudget: calculateAvailableToAssignCents(transactionRows, allocationRows, adjustmentRows).availableCents / 100, accounts: viewAccounts, managedCategories, activity, payments, cardCoverage, paymentReviewToken: token };
}
