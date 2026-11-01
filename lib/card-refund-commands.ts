import { budgetToday } from "./budget-date";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "./db";
import { accounts, auditEvents, cardRefundMatches, categories, reviewItems, transactions } from "./schema";
import { matchCardRefunds } from "./card-refunds";
import { isDiningBenefitCredit } from "./dining-credits";


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
      if (input.status === "confirmed" && isDiningBenefitCredit(refund) && (!refund.categoryId || purchase.categoryId !== refund.categoryId)) return NextResponse.json({ error: "Dining benefit credits can only offset purchases in Dining." }, { status: 400 });
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
      const matchedRefund = matchCardRefunds(rows, new Set(cardRows.filter(a => a.type === "credit_card").map(a => a.id)), [...others, values], today).refunds.find(row => row.id === refund.id)!;
      let reviewResolved = false;
      if (input.status === "confirmed" && matchedRefund.remainingCents === 0) {
        // Completing this task also approves the refund's ordinary import
        // reminder. Bank conflicts and reviews of the purchase remain separate.
        const resolvedAt = new Date();
        const approved = await db.update(reviewItems).set({ status: "resolved", resolvedAt }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, refund.id), eq(reviewItems.kind, "bank_transaction"), eq(reviewItems.status, "open"))).returning({ id: reviewItems.id, title: reviewItems.title });
        if (approved.length) {
          const category = refund.categoryId ? (await db.select({ name: categories.name }).from(categories).where(and(eq(categories.userId, userId), eq(categories.id, refund.categoryId))))[0] : null;
          await db.insert(auditEvents).values(approved.map(review => ({ id: randomUUID(), userId, action: "approve", entityType: "review_item", entityId: review.id, createdAt: resolvedAt, afterJson: JSON.stringify({ title: review.title, transactionId: refund.id, reason: "refund_fully_matched", transactionSnapshot: { description: refund.description, amountCents: refund.amountCents, effectiveDate: refund.effectiveDate, kind: refund.kind, accountId: refund.accountId, accountName: cardRows.find(account => account.id === refund.accountId)?.name, categoryId: refund.categoryId, categoryName: category?.name, status: refund.status } }) })));
          reviewResolved = true;
        }
      }
      return NextResponse.json({ ok: true, reviewResolved, remainingCents: matchedRefund.remainingCents });
    }, { isolationLevel: "serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "40001") return NextResponse.json({ error: "Refunds changed while saving. Refresh and review the match." }, { status: 409 });
    throw error;
  }
}
