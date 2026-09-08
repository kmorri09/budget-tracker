import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, allocations, budgetAdjustments, cardCoverageAdjustments, cardPaymentApplications, cardPayments, categories, obligations, reviewItems, transactions } from "../../../lib/schema";
import { calculateCategoryBalance } from "../../../lib/category-balance";
import { calculateAvailableToAssignCents } from "../../../lib/budget-balance";

const centsToAmount = (cents: number) => Math.round(cents) / 100;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDatabase();
  const [accountRows, categoryRows, transactionRows, allocationRows, budgetAdjustmentRows, obligationRows, reviewRows, paymentRows, paymentApplicationRows, coverageAdjustmentRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, user.id)),
    db.select().from(categories).where(eq(categories.userId, user.id)),
    db.select().from(transactions).where(eq(transactions.userId, user.id)).orderBy(desc(transactions.effectiveDate), desc(transactions.createdAt)),
    db.select().from(allocations).where(eq(allocations.userId, user.id)),
    db.select().from(budgetAdjustments).where(eq(budgetAdjustments.userId, user.id)),
    db.select().from(obligations).where(and(eq(obligations.userId, user.id), eq(obligations.active, true))),
    db.select().from(reviewItems).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open"))),
    db.select().from(cardPayments).where(eq(cardPayments.userId, user.id)),
    db.select().from(cardPaymentApplications).where(eq(cardPaymentApplications.userId, user.id)),
    db.select().from(cardCoverageAdjustments).where(eq(cardCoverageAdjustments.userId, user.id)),
  ]);

  const accountById = new Map(accountRows.map((account) => [account.id, account]));
  const activeTransactionRows = transactionRows.filter((transaction) => transaction.status !== "removed");
  const activeAccountRows = accountRows.filter((account) => account.active);
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const activeCategoryRows = categoryRows.filter((category) => category.active);
  const paymentAppliedByTransaction = new Map<string, number>();
  const paymentAppliedByPayment = new Map<string, number>();
  for (const application of paymentApplicationRows) {
    paymentAppliedByTransaction.set(application.transactionId, (paymentAppliedByTransaction.get(application.transactionId) ?? 0) + application.amountCents);
    paymentAppliedByPayment.set(application.paymentId, (paymentAppliedByPayment.get(application.paymentId) ?? 0) + application.amountCents);
  }
  for (const adjustment of coverageAdjustmentRows) paymentAppliedByTransaction.set(adjustment.transactionId, (paymentAppliedByTransaction.get(adjustment.transactionId) ?? 0) + adjustment.amountCents);
  const signedCashFor = (transaction: typeof transactionRows[number]) => {
    if (transaction.kind === "income" || transaction.kind === "refund") return transaction.amountCents;
    if (transaction.kind === "transfer_in") return transaction.amountCents;
    if (transaction.kind === "adjustment") return transaction.amountCents;
    return -transaction.amountCents;
  };
  const ledgerByAccount = activeAccountRows.map((account) => ({
    ...account,
    ledgerBalanceCents: account.openingBalanceCents
      + activeTransactionRows.filter((transaction) => transaction.accountId === account.id).reduce((sum, transaction) => sum + signedCashFor(transaction), 0)
      + paymentRows.reduce((sum, payment) => sum + (payment.fromAccountId === account.id ? -payment.amountCents : payment.toAccountId === account.id ? payment.amountCents : 0), 0),
  }));
  const ledgerBalanceCents = ledgerByAccount.filter((account) => account.type !== "credit_card").reduce((sum, account) => sum + account.ledgerBalanceCents, 0);
  const cashAccounts = ledgerByAccount.filter((account) => account.type !== "credit_card");
  const providerCashRows = cashAccounts.filter((account) => account.providerBalanceCents !== null);
  const providerBalanceCents = providerCashRows.length === cashAccounts.length && cashAccounts.length > 0 ? providerCashRows.reduce((sum, account) => sum + (account.providerBalanceCents ?? 0), 0) : null;
  const available = calculateAvailableToAssignCents(activeTransactionRows, allocationRows, budgetAdjustmentRows);
  const allocationBaseCents = available.incomeCents + available.adjustmentCents;
  const allocationPercent = allocationBaseCents > 0 ? Math.max(0, Math.min(100, Math.round((available.allocatedCents / allocationBaseCents) * 100))) : 0;
  const categoryBalances = activeCategoryRows.map((category) => {
    const balance = calculateCategoryBalance(category.id, allocationRows, transactionRows);
    return { id: category.id, name: category.name, icon: category.icon ?? "", target: centsToAmount(category.targetCents), allocated: centsToAmount(balance.allocatedCents), spent: centsToAmount(balance.spendingCents - balance.refundCents), available: centsToAmount(balance.availableCents) };
  });
  const cutoff = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
  const trailingRows = activeTransactionRows.filter((transaction) => transaction.effectiveDate >= isoDate(cutoff) && transaction.effectiveDate <= isoDate(new Date()));
  const trailingIncomeCents = trailingRows.filter((transaction) => transaction.kind === "income").reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const trailingSpendCents = trailingRows.filter((transaction) => transaction.kind === "expense").reduce((sum, transaction) => sum + transaction.amountCents, 0);

  return NextResponse.json({
    user: { id: user.id, displayName: user.displayName, email: user.email },
    accounts: ledgerByAccount.map((account) => ({ id: account.id, name: account.name, institution: account.institution, type: account.type, syncEnabled: account.syncEnabled, isDefaultCash: account.isDefaultCash, active: account.active, openingBalance: centsToAmount(account.openingBalanceCents), providerBalance: account.providerBalanceCents === null ? null : centsToAmount(account.providerBalanceCents), providerBalanceAt: account.providerBalanceAt, ledgerBalance: centsToAmount(account.ledgerBalanceCents) })),
    ledgerBalance: centsToAmount(ledgerBalanceCents),
    providerBalance: providerBalanceCents === null ? null : centsToAmount(providerBalanceCents),
    remainingToBudget: centsToAmount(available.availableCents),
    availableBreakdown: { income: centsToAmount(available.incomeCents), adjustments: centsToAmount(available.adjustmentCents), allocations: centsToAmount(available.allocatedCents), available: centsToAmount(available.availableCents) },
    availableAdjustments: budgetAdjustmentRows.map(adjustment => ({ id: adjustment.id, date: adjustment.effectiveDate, amount: centsToAmount(adjustment.amountCents), note: adjustment.note })),
    allocationPercent,
    trailing30: { income: centsToAmount(trailingIncomeCents), spending: centsToAmount(trailingSpendCents), startDate: isoDate(cutoff), endDate: isoDate(new Date()) },
    categories: categoryBalances,
    allocations: allocationRows.map((row) => ({ id: row.id, date: row.effectiveDate, amount: centsToAmount(row.amountCents), note: row.note ?? "", category: categoryById.get(row.categoryId)?.name ?? "Uncategorized" })),
    obligations: obligationRows.map((obligation) => ({ id: obligation.id, name: obligation.name, dueDate: obligation.dueDate, amount: centsToAmount(obligation.amountCents), category: categoryById.get(obligation.categoryId)?.name ?? "Uncategorized", categoryId: obligation.categoryId, account: accountById.get(obligation.accountId)?.name ?? "Account" })),
    reviews: reviewRows.map((review) => ({ id: review.id, kind: review.kind, title: review.title, details: review.details })),
    payments: [
      ...paymentRows.map((payment) => {
      const applied = paymentAppliedByPayment.get(payment.id) ?? 0;
      const coveredPurchases = paymentApplicationRows.filter(application => application.paymentId === payment.id).map(application => {
        const transaction = transactionRows.find(row => row.id === application.transactionId);
        return transaction ? `${transaction.description} (${centsToAmount(application.amountCents).toFixed(2)})` : null;
      }).filter((description): description is string => Boolean(description));
      return { id: payment.id, description: payment.description, amount: centsToAmount(payment.amountCents), date: payment.effectiveDate, fromAccount: accountById.get(payment.fromAccountId)?.name ?? "Account", toAccount: accountById.get(payment.toAccountId)?.name ?? "Credit card", applied: centsToAmount(applied), remaining: centsToAmount(payment.amountCents - applied), status: applied >= payment.amountCents ? "Applied" : applied > 0 ? "Partially applied" : "Unapplied", covered: coveredPurchases.join(", ") || "No purchases applied" };
      }),
      ...activeTransactionRows.filter(transaction => transaction.kind === "card_payment").map(transaction => ({ id: `legacy-${transaction.id}`, description: transaction.description, amount: centsToAmount(transaction.amountCents), date: transaction.effectiveDate, fromAccount: accountById.get(transaction.accountId)?.name ?? "Account", toAccount: "Legacy payment", applied: 0, remaining: centsToAmount(transaction.amountCents), status: "Legacy — not linked", covered: "Imported payment; purchase coverage was not linked" })),
    ],
    activity: activeTransactionRows.map((transaction) => {
      const account = accountById.get(transaction.accountId);
      const applied = Math.max(0, Math.min(transaction.amountCents, paymentAppliedByTransaction.get(transaction.id) ?? 0));
      const paymentStatus = transaction.kind === "expense" && account?.type === "credit_card" ? applied >= transaction.amountCents ? "Paid" : applied > 0 ? "Partially paid" : "Unpaid" : "Not applicable";
      return { id: transaction.id, description: transaction.description, amount: centsToAmount(transaction.amountCents), source: transaction.source, kind: transaction.kind, status: transaction.status, pending: transaction.pending, date: transaction.effectiveDate, category: transaction.categoryId ? categoryById.get(transaction.categoryId)?.name : null, categoryId: transaction.categoryId, account: account?.name ?? "Account", accountId: transaction.accountId, paymentStatus, remainingToPay: centsToAmount(Math.max(0, transaction.amountCents - applied)) };
    }),
  });
}

