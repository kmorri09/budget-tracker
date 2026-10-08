import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Database } from "./db";
import { activeExplicitRemovalIds } from "./explicit-removals";
import { auditEvents, rawProviderTransactions, reviewItems, transactions } from "./schema";

export class RestoreEntryError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "RestoreEntryError"; }
}

// Called only after an explicit statement confirmation. Restore the original
// row, keeping its provider identity, category, and surviving payment links.
export async function restoreProviderEntry(db: Database, userId: string, entryId: string) {
  return db.transaction(async tx => {
    const entry = (await tx.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, entryId))).for("update").limit(1))[0];
    if (!entry) throw new RestoreEntryError("Transaction not found", 404);
    const previousRestore = (await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, entryId), eq(auditEvents.entityType, "transaction"), eq(auditEvents.action, "restore_provider_removal"))).limit(1))[0];
    if (entry.status !== "removed") {
      if (previousRestore) return { id: entryId, ok: true, alreadyRestored: true };
      throw new RestoreEntryError("This entry is already included in the ledger");
    }
    if (!entry.providerTransactionId) throw new RestoreEntryError("This entry has no bank record to verify");
    const decisions = await tx.select().from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, entryId), or(
      and(eq(auditEvents.entityType, "provider_transaction"), inArray(auditEvents.action, ["remove", "suppress_historical", "undo_suppress_historical"])),
      and(eq(auditEvents.entityType, "transaction"), eq(auditEvents.action, "delete")),
    ))).orderBy(desc(auditEvents.createdAt));
    if (activeExplicitRemovalIds(decisions).has(entryId)) throw new RestoreEntryError("This entry was explicitly deleted or ignored. This action restores provider removals only.");
    const removal = decisions.find(row => row.action === "remove");
    if (!removal) throw new RestoreEntryError("No provider removal was found for this entry");
    const bank = (await tx.select().from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, userId), eq(rawProviderTransactions.providerTransactionId, entry.providerTransactionId))).limit(1))[0];
    if (!bank || bank.pending) throw new RestoreEntryError("Only a previously posted bank record can be restored here");
    if (bank.lastSeenAt > removal.createdAt) throw new RestoreEntryError("The bank record has changed since its removal. Refresh the investigation before restoring it.");
    const replacement = (await tx.select({ id: rawProviderTransactions.id }).from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, userId), eq(rawProviderTransactions.pendingTransactionId, entry.providerTransactionId))).limit(1))[0];
    if (replacement) throw new RestoreEntryError("A bank replacement exists for this entry. Review that record to avoid counting the charge twice.");
    const now = new Date();
    const changes = { status: "posted", pending: false, removedAt: null, userEdited: true, updatedAt: now };
    await tx.update(transactions).set(changes).where(and(eq(transactions.userId, userId), eq(transactions.id, entryId)));
    await tx.update(reviewItems).set({ status: "resolved", resolvedAt: now, details: "Restored after confirmation that the charge is still posted on the bank statement." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, entryId), eq(reviewItems.status, "open")));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "restore_provider_removal", entityType: "transaction", entityId: entryId, beforeJson: JSON.stringify(entry), afterJson: JSON.stringify({ ...changes, providerTransactionId: entry.providerTransactionId, confirmPosted: true }), createdAt: now });
    return { id: entryId, ok: true, alreadyRestored: false };
  });
}
