import type { NormalizedTransaction, PlaidTransaction } from "./bank-sync-core";

const editableFields = ["amountCents", "effectiveDate", "accountId", "kind", "description"] as const;
export type BankOverrideField = typeof editableFields[number];
export type EditAudit = { entityId: string; beforeJson: string | null; afterJson: string | null };

// A category edit is not an instruction to freeze the bank's pending amount.
// Existing audit records let this work for already edited entries without a migration.
export function bankFieldOverrides(audits: EditAudit[]) {
  const result = new Map<string, Set<BankOverrideField>>();
  for (const audit of audits) {
    try {
      const before = JSON.parse(audit.beforeJson ?? "{}") as Record<string, unknown>;
      const after = JSON.parse(audit.afterJson ?? "{}") as Record<string, unknown>;
      const fields = result.get(audit.entityId) ?? new Set<BankOverrideField>();
      for (const field of editableFields) if (field in before && field in after && before[field] !== after[field]) fields.add(field);
      result.set(audit.entityId, fields);
    } catch { /* An invalid historical edit must not stop synchronization. */ }
  }
  return result;
}

type ExistingBankEntry = {
  accountId: string; amountCents: number; kind: string; categoryId: string | null;
  effectiveDate: string; description: string; status: string; pending: boolean; source: string;
};

export function bankTransactionUpdate(existing: ExistingBankEntry, bank: NormalizedTransaction, localAccountId: string, overrides: ReadonlySet<BankOverrideField> = new Set()) {
  const providerManaged = existing.source === "plaid";
  const kind = overrides.has("kind") || !providerManaged ? existing.kind : bank.kind;
  const changes = {
    accountId: overrides.has("accountId") || !providerManaged ? existing.accountId : localAccountId,
    amountCents: overrides.has("amountCents") ? existing.amountCents : bank.amountCents,
    kind,
    categoryId: ["expense", "refund"].includes(kind) ? existing.categoryId : null,
    effectiveDate: overrides.has("effectiveDate") || !providerManaged ? existing.effectiveDate : bank.date,
    description: overrides.has("description") || !providerManaged ? existing.description : bank.description,
    status: bank.pending ? "pending" : existing.status === "cleared" ? "cleared" : "posted",
    pending: bank.pending,
    providerTransactionId: bank.providerTransactionId,
    source: existing.source,
    removedAt: null,
  };
  const conflicts: string[] = [];
  if (changes.amountCents !== bank.amountCents) conflicts.push(`App amount ${(changes.amountCents / 100).toFixed(2)} differs from bank amount ${(bank.amountCents / 100).toFixed(2)}.`);
  if (changes.accountId !== localAccountId) conflicts.push("The app account differs from the bank account mapping.");
  const incoming = (value: string) => ["income", "refund", "transfer_in", "adjustment"].includes(value);
  if (incoming(changes.kind) !== incoming(bank.kind)) conflicts.push("The app transaction type has a different balance direction from the bank.");
  return { changes, conflicts };
}

export type TransactionSyncPage = {
  added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string }[];
  next_cursor: string; has_more: boolean;
};

// No partial batch or partial cursor may be persisted. A mutation restarts
// from the original cursor, rather than duplicating pages already collected.
export async function fetchTransactionUpdates(fetchPage: (cursor: string | null) => Promise<TransactionSyncPage>, originalCursor: string | null, options: { maxPages?: number; maxAttempts?: number } = {}) {
  const maxPages = options.maxPages ?? 100;
  const maxAttempts = options.maxAttempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const added: PlaidTransaction[] = [], modified: PlaidTransaction[] = [], removed: { transaction_id: string }[] = [];
    let cursor = originalCursor;
    try {
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
        const page = await fetchPage(cursor);
        added.push(...page.added); modified.push(...page.modified); removed.push(...page.removed);
        cursor = page.next_cursor;
        if (!page.has_more) return { added, modified, removed, nextCursor: cursor };
      }
      throw new Error("Bank sync exceeded the page limit before completing an update. No transaction changes or cursor will be saved; retry the sync.");
    } catch (error) {
      if ((error as { code?: string }).code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error("Bank sync could not obtain a consistent update.");
}

export function finalTransactionUpdates(added: PlaidTransaction[], modified: PlaidTransaction[]) {
  const latest = new Map([...added, ...modified].map(row => [row.transaction_id, row]));
  const replacedIds = new Set([...latest.values()].filter(row => !row.pending && row.pending_transaction_id).map(row => row.pending_transaction_id!));
  return [...latest.values()].filter(row => !replacedIds.has(row.transaction_id));
}
