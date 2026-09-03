import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, allocations, categories, obligations, reviewItems, transactions } from "../../../lib/schema";

const centsToAmount = (cents: number) => Math.round(cents) / 100;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDatabase();
  const [accountRows, categoryRows, transactionRows, allocationRows, obligationRows, reviewRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, user.id)),
    db.select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.active, true))),
    db.select().from(transactions).where(eq(transactions.userId, user.id)).orderBy(desc(transactions.effectiveDate), desc(transactions.createdAt)),
    db.select().from(allocations).where(eq(allocations.userId, user.id)),
    db.select().from(obligations).where(and(eq(obligations.userId, user.id), eq(obligations.active, true))),
    db.select().from(reviewItems).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open"))),
  ]);

  const accountById = new Map(accountRows.map((account) => [account.id, account]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const signedCashFor = (transaction: typeof transactionRows[number]) => {
    if (transaction.kind === "income" || transaction.kind === "refund") return transaction.amountCents;
    if (transaction.kind === "transfer_in") return transaction.amountCents;
    return -transaction.amountCents;
  };
  const ledgerByAccount = accountRows.map((account) => ({
    ...account,
    ledgerBalanceCents: account.openingBalanceCents + transactionRows.filter((transaction) => transaction.accountId === account.id).reduce((sum, transaction) => sum + signedCashFor(transaction), 0),
  }));
  const ledgerBalanceCents = ledgerByAccount.filter((account) => account.type !== "credit_card").reduce((sum, account) => sum + account.ledgerBalanceCents, 0);
  const budgetableIncomeCents = transactionRows.filter((transaction) => transaction.kind === "income").reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const allocatedCents = allocationRows.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const remainingToBudgetCents = budgetableIncomeCents - allocatedCents;
  const allocationPercent = budgetableIncomeCents > 0 ? Math.max(0, Math.min(100, Math.round((allocatedCents / budgetableIncomeCents) * 100))) : 0;
  const categoryBalances = categoryRows.map((category) => {
    const allocated = allocationRows.filter((allocation) => allocation.categoryId === category.id).reduce((sum, allocation) => sum + allocation.amountCents, 0);
    const spending = transactionRows.filter((transaction) => transaction.categoryId === category.id && transaction.kind === "expense").reduce((sum, transaction) => sum + transaction.amountCents, 0);
    const refunds = transactionRows.filter((transaction) => transaction.categoryId === category.id && transaction.kind === "refund").reduce((sum, transaction) => sum + transaction.amountCents, 0);
    return { id: category.id, name: category.name, icon: category.icon ?? "$", target: centsToAmount(category.targetCents), available: centsToAmount(allocated - spending + refunds) };
  });
  const cutoff = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
  const trailingRows = transactionRows.filter((transaction) => transaction.effectiveDate >= isoDate(cutoff));
  const trailingIncomeCents = trailingRows.filter((transaction) => transaction.kind === "income").reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const trailingSpendCents = trailingRows.filter((transaction) => transaction.kind === "expense").reduce((sum, transaction) => sum + transaction.amountCents, 0);

  return NextResponse.json({
    user: { id: user.id, displayName: user.displayName, email: user.email },
    accounts: ledgerByAccount.map((account) => ({ id: account.id, name: account.name, institution: account.institution, type: account.type, syncEnabled: account.syncEnabled, ledgerBalance: centsToAmount(account.ledgerBalanceCents) })),
    ledgerBalance: centsToAmount(ledgerBalanceCents),
    providerBalance: null,
    remainingToBudget: centsToAmount(remainingToBudgetCents),
    allocationPercent,
    trailing30: { income: centsToAmount(trailingIncomeCents), spending: centsToAmount(trailingSpendCents), startDate: isoDate(cutoff), endDate: isoDate(new Date()) },
    categories: categoryBalances,
    obligations: obligationRows.map((obligation) => ({ id: obligation.id, name: obligation.name, dueDate: obligation.dueDate, amount: centsToAmount(obligation.amountCents), category: categoryById.get(obligation.categoryId)?.name ?? "Uncategorized", account: accountById.get(obligation.accountId)?.name ?? "Account" })),
    reviews: reviewRows.map((review) => ({ id: review.id, kind: review.kind, title: review.title, details: review.details })),
    activity: transactionRows.slice(0, 8).map((transaction) => ({ id: transaction.id, description: transaction.description, amount: centsToAmount(transaction.amountCents), kind: transaction.kind, status: transaction.status, pending: transaction.pending, date: transaction.effectiveDate, category: transaction.categoryId ? categoryById.get(transaction.categoryId)?.name : null, account: accountById.get(transaction.accountId)?.name ?? "Account" })),
  });
}

