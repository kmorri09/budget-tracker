import { and, asc, eq, inArray, lte, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, auditEvents, cardPaymentApplications, cardPayments, transactions } from "../../../lib/schema";

export const runtime = "nodejs";

const paymentSchema = z.object({
  amount: z.coerce.number().positive().finite(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  description: z.string().trim().min(1).max(200),
  applications: z.array(z.object({ transactionId: z.string().min(1), amount: z.coerce.number().positive().finite() })).optional(),
});

const cents = (amount: number) => Math.round(amount * 100);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid card payment" }, { status: 400 });
  const input = parsed.data;
  if (input.fromAccountId === input.toAccountId) return NextResponse.json({ error: "Choose different source and credit-card accounts" }, { status: 400 });
  const amountCents = cents(input.amount);
  const db = getDatabase();
  const ownedAccounts = await db.select().from(accounts).where(and(eq(accounts.userId, user.id), or(eq(accounts.id, input.fromAccountId), eq(accounts.name, input.fromAccountId), eq(accounts.id, input.toAccountId), eq(accounts.name, input.toAccountId))));
  const from = ownedAccounts.find(account => account.id === input.fromAccountId || account.name === input.fromAccountId);
  const to = ownedAccounts.find(account => account.id === input.toAccountId || account.name === input.toAccountId);
  if (!from || !to) return NextResponse.json({ error: "Account not found" }, { status: 400 });
  if (from.type === "credit_card") return NextResponse.json({ error: "The payment must come from a checking or savings account" }, { status: 400 });
  if (to.type !== "credit_card") return NextResponse.json({ error: "Choose a credit-card account to pay" }, { status: 400 });

  const expenseRows = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.accountId, to.id), eq(transactions.kind, "expense"), ne(transactions.status, "removed"), lte(transactions.effectiveDate, input.date))).orderBy(asc(transactions.effectiveDate), asc(transactions.createdAt));
  const expenseIds = expenseRows.map(row => row.id);
  const existingRows = expenseIds.length ? await db.select().from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, user.id), inArray(cardPaymentApplications.transactionId, expenseIds))) : [];
  const alreadyApplied = new Map<string, number>();
  for (const row of existingRows) alreadyApplied.set(row.transactionId, (alreadyApplied.get(row.transactionId) ?? 0) + row.amountCents);

  const requested = input.applications ? input.applications.map(item => ({ transactionId: item.transactionId, amountCents: cents(item.amount) })) : null;
  const applications: { transactionId: string; amountCents: number }[] = [];
  if (requested) {
    const validIds = new Set(expenseRows.map(row => row.id));
    for (const item of requested) {
      if (!validIds.has(item.transactionId)) return NextResponse.json({ error: "Every selected purchase must belong to the destination card" }, { status: 400 });
      const row = expenseRows.find(expense => expense.id === item.transactionId)!;
      const remaining = Math.max(0, row.amountCents - (alreadyApplied.get(item.transactionId) ?? 0));
      if (item.amountCents > remaining) return NextResponse.json({ error: "A purchase cannot be paid more than its remaining amount" }, { status: 400 });
      applications.push(item);
    }
  } else {
    let remainingPayment = amountCents;
    for (const row of expenseRows) {
      const remainingExpense = Math.max(0, row.amountCents - (alreadyApplied.get(row.id) ?? 0));
      if (!remainingExpense || remainingPayment <= 0) continue;
      const applied = Math.min(remainingExpense, remainingPayment);
      applications.push({ transactionId: row.id, amountCents: applied });
      remainingPayment -= applied;
    }
  }
  const appliedCents = applications.reduce((sum, item) => sum + item.amountCents, 0);
  if (appliedCents > amountCents) return NextResponse.json({ error: "Applied purchases cannot exceed the payment amount" }, { status: 400 });

  const paymentId = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(cardPayments).values({ id: paymentId, userId: user.id, fromAccountId: from.id, toAccountId: to.id, amountCents, effectiveDate: input.date, description: input.description });
    if (applications.length) await tx.insert(cardPaymentApplications).values(applications.map(item => ({ id: randomUUID(), userId: user.id, paymentId, transactionId: item.transactionId, amountCents: item.amountCents })));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "card_payment", entityId: paymentId, afterJson: JSON.stringify({ ...input, amountCents, appliedCents }) });
  });
  return NextResponse.json({ id: paymentId, appliedCents, unappliedCents: amountCents - appliedCents, ok: true });
}
