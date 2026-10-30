import { budgetToday } from "./budget-date";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "./db";
import { accounts, auditEvents, cardRefundMatches, transactions } from "./schema";
import { matchCardRefunds } from "./card-refunds";


export const refundMatchSchema = z.object({ refundId: z.string().min(1), transactionId: z.string().min(1), amount: z.coerce.number().positive().finite(), status: z.enum(["confirmed", "dismissed"]) });


export async function saveCardRefundMatch(database: Pick<Database, "transaction">, userId: string, input: z.infer<typeof refundMatchSchema>) {
  const amountCents = Math.round(input.amount * 100);
  if (amountCents < 1) return NextResponse.json({ error: "Refund amount must be at least one cent" }, { status: 400 });
  try {
    return await database.transaction(async db => {
      const rows = await db.select().from(transactions).where(eq(transactions.userId, userId));
      const cardRows = await db.select().from(accounts).where(eq(accounts.userId, userId));
      const decisions = await db.select().from(cardRefundMatches).where(eq(cardRefundMatches.userId, userId));
      const refund = rows.find(t => t.id === input.refundId), purchase = rows.find(t => t.id === input.transactionId);
      const today = budgetToday();
      if (!refund || !purchase || refund.kind !== "refund" || purchase.kind !== "expense" || refund.accountId !== purchase.accountId || !cardRows.some(a => a.id === refund.accountId && a.type === "credit_card") || [refund, purchase].some(t => t.status !== "posted" || t.pending || t.effectiveDate > today) || purchase.effectiveDate > refund.effectiveDate) return NextResponse.json({ error: "Choose a posted refund and an earlier purchase on the same credit card" }, { status: 400 });
      // Automatic links may be replaced by an explicit decision. Confirmed
      // amounts elsewhere must remain valid and cannot be spent twice.
      const others = decisions.filter(d => !(d.refundId === input.refundId && d.transactionId === input.transactionId));
      const plan = matchCardRefunds(rows, new Set(cardRows.filter(a => a.type === "credit_card").map(a => a.id)), others.filter(d => d.status === "confirmed"), today);
      const explicitLinks = plan.links.filter(l => l.confidence === "confirmed");
      const refundUsed = explicitLinks.filter(l => l.refundId === refund.id).reduce((n, l) => n + l.amountCents, 0);
      const purchaseUsed = explicitLinks.filter(l => l.transactionId === purchase.id).reduce((n, l) => n + l.amountCents, 0);
      if (input.status === "confirmed" && (amountCents > refund.amountCents - refundUsed || amountCents > purchase.amountCents - purchaseUsed)) return NextResponse.json({ error: "The matched amount exceeds the remaining refund or purchase. Refresh and review the matches." }, { status: 409 });
      const values = { id: randomUUID(), userId: userId, refundId: input.refundId, transactionId: input.transactionId, amountCents, status: input.status };
      await db.insert(cardRefundMatches).values(values).onConflictDoUpdate({ target: [cardRefundMatches.refundId, cardRefundMatches.transactionId], set: { amountCents, status: input.status } });
      await db.insert(auditEvents).values({ id: randomUUID(), userId: userId, action: input.status, entityType: "card_refund_match", entityId: input.refundId, afterJson: JSON.stringify(values) });
      return NextResponse.json({ ok: true });
    }, { isolationLevel: "serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "40001") return NextResponse.json({ error: "Refunds changed while saving. Refresh and review the match." }, { status: 409 });
    throw error;
  }
}
