import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { auditEvents, reviewItems, transactions } from "../../../lib/schema";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; all?: boolean; status?: "resolved" | "dismissed"; ignoreTransaction?: boolean } | null;
  if (body?.ignoreTransaction) {
    if (!body.id) return NextResponse.json({ error: "Review id is required" }, { status: 400 });
    const db = getDatabase();
    const review = (await db.select().from(reviewItems).where(and(eq(reviewItems.id, body.id), eq(reviewItems.userId, user.id), eq(reviewItems.status, "open"))).limit(1))[0];
    if (!review?.transactionId) return NextResponse.json({ error: "Linked transaction not found" }, { status: 404 });
    const transaction = (await db.select().from(transactions).where(and(eq(transactions.id, review.transactionId), eq(transactions.userId, user.id))).limit(1))[0];
    if (!transaction || transaction.status === "removed") return NextResponse.json({ error: "Linked transaction not found" }, { status: 404 });
    if (transaction.source !== "plaid") return NextResponse.json({ error: "Only Plaid imports can be ignored as historical activity" }, { status: 400 });
    const now = new Date();
    await db.transaction(async tx => {
      await tx.update(transactions).set({ status: "removed", removedAt: now, pending: false, userEdited: true, updatedAt: now }).where(and(eq(transactions.id, transaction.id), eq(transactions.userId, user.id)));
      await tx.update(reviewItems).set({ status: "resolved", resolvedAt: now, details: "Ignored because this historical bank activity was already included in the account's starting or reconciled balance." }).where(and(eq(reviewItems.id, review.id), eq(reviewItems.userId, user.id)));
      await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "suppress_historical", entityType: "provider_transaction", entityId: transaction.id, beforeJson: JSON.stringify({ status: transaction.status, providerTransactionId: transaction.providerTransactionId }), afterJson: JSON.stringify({ status: "removed", reviewId: review.id }) });
    });
    return NextResponse.json({ ok: true, ignoredTransaction: true });
  }
  if ((!body?.id && !body?.all) || !body.status) return NextResponse.json({ error: "Review id or all, and status are required" }, { status: 400 });
  if (body.all) {
    const openItems = await getDatabase().select({ id: reviewItems.id }).from(reviewItems).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open")));
    if (openItems.length) {
      await getDatabase().update(reviewItems).set({ status: body.status, resolvedAt: new Date() }).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open")));
      await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: body.status, entityType: "review_batch", entityId: "all-open", afterJson: JSON.stringify({ count: openItems.length }) });
    }
    return NextResponse.json({ ok: true, count: openItems.length });
  }
  if (!body.id) return NextResponse.json({ error: "Review id is required" }, { status: 400 });
  await getDatabase().update(reviewItems).set({ status: body.status, resolvedAt: new Date() }).where(and(eq(reviewItems.id, body.id), eq(reviewItems.userId, user.id)));
  await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: body.status, entityType: "review_item", entityId: body.id });
  return NextResponse.json({ ok: true });
}

