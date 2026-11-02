import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "./db";
import { obligationFundingSchema } from "./api-validation";
import { calculateCategoryBalance } from "./category-balance";
import { calculateObligationFunding } from "./obligation-funding";
import { planObligations, type ObligationCoverage } from "./obligation-status";
import { budgetToday } from "./budget-date";
import { loadPaymentWorkspace } from "./payment-workspace";
import { accounts, allocations, auditEvents, cardPayments, cashReserveAdjustments, categories, obligationMatchDecisions, obligations, transactions } from "./schema";

export async function fundObligations(database: Pick<Database, "transaction">, userId: string, input: z.infer<typeof obligationFundingSchema>) {
  const ids = input.obligations.map(obligation => obligation.id);
  const amountById = new Map(input.obligations.map(obligation => [obligation.id, obligation.amountCents]));
  if (new Set(ids).size !== ids.length) return NextResponse.json({ error: "Each obligation can only be selected once" }, { status: 400 });
  const db = database;
  if (input.date !== budgetToday()) return NextResponse.json({ error: "Cash reserves can only be funded as of today." }, { status: 400 });
  try {
  return await db.transaction(async tx => {
  const [obligationRows, categoryRows, allocationRows, transactionRows, paymentRows, decisionRows, accountRows] = await Promise.all([
    tx.select().from(obligations).where(and(eq(obligations.userId, userId), eq(obligations.active, true))),
    tx.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.active, true))),
    tx.select().from(allocations).where(eq(allocations.userId, userId)),
    tx.select().from(transactions).where(eq(transactions.userId, userId)),
    tx.select().from(cardPayments).where(eq(cardPayments.userId, userId)),
    tx.select().from(obligationMatchDecisions).where(eq(obligationMatchDecisions.userId, userId)),
    tx.select().from(accounts).where(eq(accounts.userId, userId)),
  ]);
  const selected = obligationRows.filter(obligation => ids.includes(obligation.id));
  if (selected.length !== ids.length) return NextResponse.json({ error: "One or more obligations were not found" }, { status: 404 });
  if (selected.some(row => !categoryRows.some(category => category.id === row.categoryId))) return NextResponse.json({ error: "Assign an active category to each selected obligation." }, { status: 400 });
  if (selected.some(row => accountRows.find(account => account.id === row.accountId)?.type === "credit_card")) return NextResponse.json({ error: "Cash reserves are for obligations paid from a cash account. Deselect card charges to continue." }, { status: 400 });
  const candidates: ObligationCoverage[] = [
    ...transactionRows.filter(row => row.status === "posted" && !row.pending && ["expense", "transfer_out", "card_payment"].includes(row.kind)).map(row => ({ id: row.id, type: "transaction" as const, amountCents: row.amountCents, description: row.description, effectiveDate: row.effectiveDate, accountId: row.accountId })),
    ...paymentRows.map(row => ({ id: row.id, type: "payment" as const, amountCents: row.amountCents, description: `${row.description} ${accountRows.find(account => account.id === row.toAccountId)?.name ?? ""}`.trim(), effectiveDate: row.effectiveDate, fromAccountId: row.fromAccountId, toAccountId: row.toAccountId })),
  ];
  const plans = planObligations(obligationRows, candidates, decisionRows, budgetToday());
  if (selected.some(row => amountById.get(row.id)! > 0 && plans.get(row.id)?.covered)) return NextResponse.json({ error: "A selected one-time obligation has already been paid" }, { status: 400 });
  const workspace = await loadPaymentWorkspace(tx, userId, input.date);
  const categoryBalances = categoryRows.map(category => ({ id: category.id, name: category.name, availableCents: Math.min(calculateCategoryBalance(category.id, allocationRows, transactionRows).availableCents, Math.round((workspace.managedCategories.find(row => row.id === category.id)?.available ?? 0) * 100)) - Math.round((workspace.managedCategories.find(row => row.id === category.id)?.unmatchedRefunds ?? 0) * 100), cashReserveCents: Math.round((workspace.managedCategories.find(row => row.id === category.id)?.cashReserve ?? 0) * 100), cashReserveShortfallCents: Math.round((workspace.managedCategories.find(row => row.id === category.id)?.cashReserveShortfall ?? 0) * 100) }));
  const funding = calculateObligationFunding(selected.map(obligation => ({ id: obligation.id, categoryId: obligation.categoryId, name: obligation.name, amountCents: amountById.get(obligation.id)! })), categoryBalances);
  const changes = funding.filter(group => group.reserveCents > 0 || group.allocationCents > 0);
  const allocationCents = funding.reduce((sum, group) => sum + group.allocationCents, 0);
  if (allocationCents !== input.expectedAllocationCents) return NextResponse.json({ error: "Your budget changed. Close and reopen this preview before funding obligations." }, { status: 409 });
  if (allocationCents > Math.round(workspace.currentFundingAvailable * 100)) return NextResponse.json({ error: "There is not enough current Ready to Allocate for this selection." }, { status: 409 });

    for (const group of changes) {
      if (group.allocationCents > 0) await tx.insert(allocations).values({ id: randomUUID(), userId: userId, categoryId: group.categoryId, amountCents: group.allocationCents, effectiveDate: input.date, note: `Fund upcoming obligations: ${group.obligationNames.join(", ")}` });
      if (group.reserveCents > 0) await tx.insert(cashReserveAdjustments).values({ id: randomUUID(), userId: userId, categoryId: group.categoryId, amountCents: group.reserveCents, effectiveDate: input.date, note: "Protect cash for upcoming obligations" });
    }
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: userId, action: "fund", entityType: "upcoming_obligations", entityId: randomUUID(), afterJson: JSON.stringify({ date: input.date, obligations: input.obligations, funding: changes }) });
  return NextResponse.json({ ok: true, categoriesFunded: changes.length, amount: changes.reduce((sum, group) => sum + group.allocationCents, 0) / 100 });
  }, { isolationLevel: "serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "40001") return NextResponse.json({ error: "Your budget changed. Refresh and review the funding again." }, { status: 409 });
    throw error;
  }
}
