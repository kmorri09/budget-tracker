import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Database } from "./db";
import { auditEvents, cardPayments, rawProviderTransactions, reviewItems, transactions } from "./schema";

export class UndoIgnoreError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "UndoIgnoreError"; }
}

export async function undoHistoricalIgnore(db: Database, userId: string, reviewId: string) {
  return db.transaction(async tx => {
    const review = (await tx.select().from(reviewItems).where(and(eq(reviewItems.id, reviewId), eq(reviewItems.userId, userId))).for("update").limit(1))[0];
    if (!review) throw new UndoIgnoreError("Review not found", 404);
    if (review.status !== "resolved" || !review.transactionId) throw new UndoIgnoreError("This review is not an ignored bank entry");
    const entry = (await tx.select().from(transactions).where(and(eq(transactions.id, review.transactionId), eq(transactions.userId, userId))).for("update").limit(1))[0];
    if (!entry || entry.status !== "removed" || entry.source !== "plaid" || !entry.providerTransactionId) throw new UndoIgnoreError("This bank entry is no longer eligible to restore");
    const decisions = await tx.select().from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityType, "provider_transaction"), eq(auditEvents.entityId, entry.id), inArray(auditEvents.action, ["suppress_historical", "undo_suppress_historical"]))).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));
    const suppression = decisions[0];
    let suppressionReviewId: string | undefined;
    try { suppressionReviewId = (JSON.parse(suppression?.afterJson ?? "{}") as { reviewId?: string }).reviewId; } catch { /* Invalid audit data cannot authorize a restoration. */ }
    if (suppression?.action !== "suppress_historical" || suppressionReviewId !== review.id) throw new UndoIgnoreError("This review is not the active decision that excluded the entry");
    const raw = (await tx.select().from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, userId), eq(rawProviderTransactions.providerTransactionId, entry.providerTransactionId))).limit(1))[0];
    if (!raw || raw.pending) throw new UndoIgnoreError("A posted bank record is needed before this entry can be restored");
    const replacement = (await tx.select({ id: rawProviderTransactions.id }).from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, userId), eq(rawProviderTransactions.pendingTransactionId, entry.providerTransactionId))).limit(1))[0];
    if (replacement) throw new UndoIgnoreError("A posted replacement exists. Review that entry first to avoid counting the transfer twice.");
    const bankIds = [entry.providerTransactionId, raw.pendingTransactionId].filter((id): id is string => Boolean(id));
    const linkedPayment = (await tx.select({ id: cardPayments.id }).from(cardPayments).where(and(eq(cardPayments.userId, userId), or(inArray(cardPayments.providerTransactionId, bankIds), inArray(cardPayments.destinationProviderTransactionId, bankIds)))).limit(1))[0];
    if (linkedPayment) throw new UndoIgnoreError("This bank entry is already linked to a card payment. Review that payment instead of restoring a duplicate transfer.");
    const laterRemoval = (await tx.select({ createdAt: auditEvents.createdAt }).from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityType, "provider_transaction"), eq(auditEvents.entityId, entry.id), eq(auditEvents.action, "remove"))).orderBy(desc(auditEvents.createdAt)).limit(1))[0];
    if (laterRemoval && laterRemoval.createdAt >= suppression.createdAt) throw new UndoIgnoreError("The bank removed this entry after it was ignored. Investigate the removal before restoring it.");
    const now = new Date();
    let originalStatus = "posted";
    try {
      const before = JSON.parse(suppression.beforeJson ?? "{}") as { status?: string };
      if (before.status === "cleared") originalStatus = "cleared";
    } catch { /* Restore a posted bank entry as posted when the older audit is incomplete. */ }
    await tx.update(transactions).set({ status: originalStatus, pending: false, removedAt: null, userEdited: true, updatedAt: now }).where(and(eq(transactions.id, entry.id), eq(transactions.userId, userId)));
    await tx.update(reviewItems).set({ status: "open", resolvedAt: null, details: "Previously ignored as historical activity. Confirm this transfer is not already represented by a card payment or starting balance before approving it." }).where(and(eq(reviewItems.id, review.id), eq(reviewItems.userId, userId)));
    await tx.insert(auditEvents).values([
      { id: randomUUID(), userId, action: "undo_suppress_historical", entityType: "provider_transaction", entityId: entry.id, beforeJson: JSON.stringify({ status: entry.status, suppressionId: suppression.id }), afterJson: JSON.stringify({ status: originalStatus, reviewId: review.id }), createdAt: now },
      { id: randomUUID(), userId, action: "reopen", entityType: "review_item", entityId: review.id, beforeJson: JSON.stringify({ status: review.status, resolvedAt: review.resolvedAt }), afterJson: JSON.stringify({ status: "open", transactionId: entry.id, restoredToLedger: true }), createdAt: now },
    ]);
    return { ok: true, restored: true, id: entry.id };
  });
}
