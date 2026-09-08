import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { coverageReconciliation } from "../../../../lib/card-coverage";
import { getDatabase } from "../../../../lib/db";
import { accounts, auditEvents, cardCoverageAdjustments, cardPaymentApplications, transactions } from "../../../../lib/schema";

export const runtime = "nodejs";

const reconcileSchema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1).max(1000),
  state: z.enum(["paid", "unpaid"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(200).default("Manual card coverage reconciliation"),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = reconcileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid reconciliation" }, { status: 400 });
  const input = parsed.data;
  const transactionIds = [...new Set(input.transactionIds)];
  const db = getDatabase();
  const transactionRows = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), inArray(transactions.id, transactionIds)));
  if (transactionRows.length !== transactionIds.length) return NextResponse.json({ error: "One or more transactions were not found" }, { status: 400 });
  if (transactionRows.some(row => row.status === "removed")) return NextResponse.json({ error: "Removed transactions cannot have card coverage reconciled" }, { status: 400 });
  if (transactionRows.some(row => row.kind !== "expense")) return NextResponse.json({ error: "Only expenses can have card coverage reconciled" }, { status: 400 });
  const accountIds = [...new Set(transactionRows.map(row => row.accountId))];
  const accountRows = await db.select().from(accounts).where(and(eq(accounts.userId, user.id), inArray(accounts.id, accountIds)));
  if (accountRows.length !== accountIds.length || accountRows.some(account => account.type !== "credit_card")) return NextResponse.json({ error: "Only credit-card purchases can have coverage reconciled" }, { status: 400 });

  const [applicationRows, adjustmentRows] = await Promise.all([
    db.select().from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, user.id), inArray(cardPaymentApplications.transactionId, transactionIds))),
    db.select().from(cardCoverageAdjustments).where(and(eq(cardCoverageAdjustments.userId, user.id), inArray(cardCoverageAdjustments.transactionId, transactionIds))),
  ]);
  const covered = new Map<string, number>();
  for (const row of [...applicationRows, ...adjustmentRows]) covered.set(row.transactionId, (covered.get(row.transactionId) ?? 0) + row.amountCents);
  const changes = transactionRows.map(transaction => ({ transaction, ...coverageReconciliation(transaction.amountCents, covered.get(transaction.id) ?? 0, input.state) })).filter(change => change.deltaCents !== 0);

  if (changes.length) await db.transaction(async tx => {
    await tx.insert(cardCoverageAdjustments).values(changes.map(change => ({ id: randomUUID(), userId: user.id, transactionId: change.transaction.id, amountCents: change.deltaCents, effectiveDate: input.date, note: input.note })));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "reconcile", entityType: "card_coverage", entityId: randomUUID(), beforeJson: JSON.stringify(changes.map(change => ({ transactionId: change.transaction.id, coveredCents: change.currentCents }))), afterJson: JSON.stringify({ state: input.state, date: input.date, note: input.note, transactions: changes.map(change => ({ transactionId: change.transaction.id, coveredCents: change.desiredCents })) }) });
  });
  return NextResponse.json({ ok: true, changed: changes.length, unchanged: transactionRows.length - changes.length });
}
