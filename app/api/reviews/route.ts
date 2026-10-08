import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, auditEvents, categories, reviewItems, transactions } from "../../../lib/schema";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const offsetValue = Number(new URL(request.url).searchParams.get("offset") ?? "0");
  if (!Number.isSafeInteger(offsetValue) || offsetValue < 0) return NextResponse.json({ error: "Invalid history offset" }, { status: 400 });
  const db = getDatabase();
  const rows = await db.select().from(reviewItems)
    .where(and(eq(reviewItems.userId, user.id), inArray(reviewItems.status, ["resolved", "dismissed"])))
    .orderBy(desc(reviewItems.resolvedAt), desc(reviewItems.createdAt), desc(reviewItems.id))
    .limit(51).offset(offsetValue);
  const page = rows.slice(0, 50);
  const transactionIds = [...new Set(page.map(row => row.transactionId).filter((id): id is string => Boolean(id)))];
  const reviewIds = page.map(row => row.id);
  const [transactionRows, accountRows, categoryRows, resolutionAudits] = await Promise.all([
    transactionIds.length ? db.select().from(transactions).where(and(eq(transactions.userId, user.id), inArray(transactions.id, transactionIds))) : Promise.resolve([]),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, user.id)),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.userId, user.id)),
    reviewIds.length ? db.select({ entityId: auditEvents.entityId, action: auditEvents.action, afterJson: auditEvents.afterJson, createdAt: auditEvents.createdAt }).from(auditEvents)
      .where(and(eq(auditEvents.userId, user.id), eq(auditEvents.entityType, "review_item"), inArray(auditEvents.entityId, reviewIds)))
      .orderBy(desc(auditEvents.createdAt)) : Promise.resolve([]),
  ]);
  const transactionById = new Map(transactionRows.map(row => [row.id, row]));
  const accountById = new Map(accountRows.map(row => [row.id, row.name]));
  const categoryById = new Map(categoryRows.map(row => [row.id, row.name]));
  const resolutionByReview = new Map<string, { label: string; at: Date; afterJson: string | null }>();
  for (const audit of resolutionAudits) {
    if (resolutionByReview.has(audit.entityId)) continue;
    resolutionByReview.set(audit.entityId, { label: ({ approve: "Saved and approved", resolved: "Marked reviewed", dismissed: "Dismissed", ignored: "Ignored historical activity", accept_removal: "Accepted bank removal", transaction_deleted: "Transaction deleted" } as Record<string, string>)[audit.action] ?? "Resolved", at: audit.createdAt, afterJson: audit.afterJson });
  }
  return NextResponse.json({
    items: page.map(row => {
      const transaction = row.transactionId ? transactionById.get(row.transactionId) : null;
      const resolutionAudit = resolutionByReview.get(row.id);
      const currentResolutionAudit = resolutionAudit && row.resolvedAt && Math.abs(resolutionAudit.at.getTime() - row.resolvedAt.getTime()) < 120_000 ? resolutionAudit : null;
      let reviewedTransaction: { description: string; amount: number; kind: string; date: string; account: string; category: string | null; status: string } | null = null;
      if (currentResolutionAudit?.afterJson) {
        try {
          const snapshot = (JSON.parse(currentResolutionAudit.afterJson) as { transactionSnapshot?: { description?: unknown; amountCents?: unknown; kind?: unknown; effectiveDate?: unknown; accountId?: unknown; accountName?: unknown; categoryId?: unknown; categoryName?: unknown; status?: unknown } }).transactionSnapshot;
          if (snapshot && typeof snapshot.description === "string" && typeof snapshot.amountCents === "number" && typeof snapshot.kind === "string" && typeof snapshot.effectiveDate === "string" && typeof snapshot.accountId === "string" && typeof snapshot.status === "string") {
            reviewedTransaction = { description: snapshot.description, amount: snapshot.amountCents / 100, kind: snapshot.kind, date: snapshot.effectiveDate, account: typeof snapshot.accountName === "string" ? snapshot.accountName : accountById.get(snapshot.accountId) ?? "Account", category: typeof snapshot.categoryName === "string" ? snapshot.categoryName : typeof snapshot.categoryId === "string" ? categoryById.get(snapshot.categoryId) ?? "Uncategorized" : null, status: snapshot.status };
          }
        } catch { /* Older audit payloads may not contain a transaction snapshot. */ }
      }
      const fallbackResolution = row.details?.startsWith("Ignored because this historical bank activity") ? "Ignored historical activity"
        : row.details?.startsWith("Automatically resolved") ? "Automatically resolved"
        : row.details?.startsWith("Resolved after converting") ? "Converted to card payment"
        : row.details?.startsWith("Restored after confirmation") ? "Restored after statement check"
        : row.status === "dismissed" ? "Dismissed" : "Resolved";
      return {
        id: row.id, title: row.title, details: row.details, kind: row.kind, status: row.status,
        createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
        resolution: currentResolutionAudit?.label ?? fallbackResolution,
        reviewedTransaction,
        canReopen: !row.transactionId || Boolean(transaction && (transaction.status !== "removed" || row.kind === "provider_posted_removal")),
        transaction: transaction ? { id: transaction.id, description: transaction.description, amount: transaction.amountCents / 100,
          kind: transaction.kind, date: transaction.effectiveDate, account: accountById.get(transaction.accountId) ?? "Account",
          category: transaction.categoryId ? categoryById.get(transaction.categoryId) ?? "Uncategorized" : null,
          status: transaction.status, source: transaction.source } : null,
      };
    }),
    hasMore: rows.length > 50,
  });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; all?: boolean; status?: "resolved" | "dismissed"; ignoreTransaction?: boolean; reopen?: boolean } | null;
  if (body?.reopen) {
    if (!body.id) return NextResponse.json({ error: "Review id is required" }, { status: 400 });
    const db = getDatabase();
    const review = (await db.select().from(reviewItems).where(and(eq(reviewItems.id, body.id), eq(reviewItems.userId, user.id), ne(reviewItems.status, "open"))).limit(1))[0];
    if (!review) return NextResponse.json({ error: "Resolved review not found" }, { status: 404 });
    const transaction = review.transactionId ? (await db.select({ status: transactions.status }).from(transactions).where(and(eq(transactions.id, review.transactionId), eq(transactions.userId, user.id))).limit(1))[0] : null;
    if (review.transactionId && (!transaction || (transaction.status === "removed" && review.kind !== "provider_posted_removal"))) return NextResponse.json({ error: "This transaction is removed from the ledger. Reopening its reminder would not restore it; investigate the removal in Accounts." }, { status: 409 });
    const reopened = await db.transaction(async tx => {
      const updated = await tx.update(reviewItems).set({ status: "open", resolvedAt: null }).where(and(eq(reviewItems.id, review.id), eq(reviewItems.userId, user.id), ne(reviewItems.status, "open"))).returning({ id: reviewItems.id });
      if (!updated.length) return false;
      await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "reopen", entityType: "review_item", entityId: review.id, beforeJson: JSON.stringify({ status: review.status, resolvedAt: review.resolvedAt }), afterJson: JSON.stringify({ status: "open", title: review.title, transactionId: review.transactionId }) });
      return true;
    });
    if (!reopened) return NextResponse.json({ error: "This review is already open" }, { status: 409 });
    return NextResponse.json({ ok: true, reopened: true });
  }
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
      await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "ignored", entityType: "review_item", entityId: review.id, afterJson: JSON.stringify({ title: review.title, transactionId: transaction.id }) });
    });
    return NextResponse.json({ ok: true, ignoredTransaction: true });
  }
  if ((!body?.id && !body?.all) || !["resolved", "dismissed"].includes(body.status ?? "")) return NextResponse.json({ error: "Review id or all, and a valid status are required" }, { status: 400 });
  const status = body.status as "resolved" | "dismissed";
  if (body.all) {
    const db = getDatabase();
    const count = await db.transaction(async tx => {
      const changed = await tx.update(reviewItems).set({ status, resolvedAt: new Date() }).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open"))).returning({ id: reviewItems.id, title: reviewItems.title, kind: reviewItems.kind, transactionId: reviewItems.transactionId });
      if (changed.length) {
        await tx.insert(auditEvents).values(changed.map(item => ({ id: randomUUID(), userId: user.id, action: item.kind === "provider_posted_removal" && status === "resolved" ? "accept_removal" : status, entityType: "review_item", entityId: item.id, afterJson: JSON.stringify({ title: item.title, transactionId: item.transactionId, batch: true }) })));
        await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: status, entityType: "review_batch", entityId: "all-open", afterJson: JSON.stringify({ count: changed.length, reviewIds: changed.map(item => item.id) }) });
      }
      return changed.length;
    });
    return NextResponse.json({ ok: true, count });
  }
  if (!body.id) return NextResponse.json({ error: "Review id is required" }, { status: 400 });
  const reviewId = body.id;
  const db = getDatabase();
  const changed = await db.transaction(async tx => {
    const updated = await tx.update(reviewItems).set({ status, resolvedAt: new Date() }).where(and(eq(reviewItems.id, reviewId), eq(reviewItems.userId, user.id), eq(reviewItems.status, "open"))).returning({ id: reviewItems.id, title: reviewItems.title, kind: reviewItems.kind, transactionId: reviewItems.transactionId });
    if (updated.length) await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: updated[0].kind === "provider_posted_removal" && status === "resolved" ? "accept_removal" : status, entityType: "review_item", entityId: reviewId, afterJson: JSON.stringify({ title: updated[0].title, transactionId: updated[0].transactionId }) });
    return updated.length;
  });
  if (!changed) return NextResponse.json({ error: "Open review not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

