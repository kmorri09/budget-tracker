import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Database } from "./db";
import { accounts, auditEvents, cardPaymentApplications, cardCoverageAdjustments, cardPayments, categorizationRules, categories, providerAccounts, providerConnections, rawProviderTransactions, reviewItems, syncLocks, syncRuns, transactions } from "./schema";
import { accountType, findCardPaymentMatch, findLedgerDuplicate, mockProviderAccounts, preserveRemovedTransaction, syncCutoverDate, toNormalized, type CardPaymentMatchCandidate, type LedgerMatchCandidate, type NormalizedTransaction, type PlaidAccount, type PlaidTransaction } from "./bank-sync-core";
import { findCategorizationRule } from "./categorization-rules";
import { importedReviewDetails, importedReviewTitle } from "./ledger-entry-types";
import { decryptProviderToken, encryptProviderToken, hasProviderEncryptionKey } from "./provider-crypto";
import { bankFieldOverrides, bankTransactionUpdate, fetchTransactionUpdates, finalTransactionUpdates, type TransactionSyncPage } from "./bank-sync-updates";

const plaidEnvironment = () => {
  const value = process.env.PLAID_ENV ?? "sandbox";
  if (value !== "sandbox" && value !== "development" && value !== "production") throw new Error("PLAID_ENV must be sandbox, development, or production");
  return value;
};
const plaidBaseUrl = () => ({ sandbox: "https://sandbox.plaid.com", development: "https://development.plaid.com", production: "https://production.plaid.com" }[plaidEnvironment()]);
const hasPlaidCredentials = () => Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

export class PlaidError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.name = "PlaidError"; this.code = code; }
}
export class SyncBusyError extends Error { constructor() { super("A sync is already running for this connection"); this.name = "SyncBusyError"; } }

async function plaidRequest<T>(path: string, body: Record<string, unknown>) {
  if (!hasPlaidCredentials()) throw new Error("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to enable live connections.");
  const response = await fetch(`${plaidBaseUrl()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null) as (T & { error_code?: string; error_message?: string; request_id?: string }) | null;
  if (!response.ok || !payload) {
    const detail = payload?.error_message ?? "Request failed";
    const requestId = payload?.request_id ? `; request_id ${payload.request_id}` : "";
    throw new PlaidError(`Plaid ${path}: ${detail} (${response.status}${requestId})`, payload?.error_code);
  }
  return payload;
}

export async function createPlaidLinkToken(userId: string) {
  return plaidRequest<{ link_token: string }>("/link/token/create", { user: { client_user_id: userId }, client_name: "Budget", products: ["transactions"], country_codes: ["US"], language: "en" });
}

export async function createPlaidUpdateLinkToken(userId: string, accessToken: string) {
  // Supplying access_token puts Link in update mode. Plaid requires product
  // fields to be omitted for this flow unless new permissions are requested.
  return plaidRequest<{ link_token: string }>("/link/token/create", { user: { client_user_id: userId }, client_name: "Budget", access_token: accessToken, country_codes: ["US"], language: "en" });
}

export async function removePlaidItem(accessToken: string) {
  return plaidRequest<{ request_id?: string }>("/item/remove", { access_token: accessToken });
}

export async function exchangePlaidPublicToken(publicToken: string) {
  const exchanged = await plaidRequest<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
  const item = await plaidRequest<{ item: { institution_id?: string | null } }>("/item/get", { access_token: exchanged.access_token });
  const listed = await plaidRequest<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: exchanged.access_token });
  return { ...exchanged, institutionId: item.item.institution_id ?? null, accounts: listed.accounts };
}

function mockTransactions(): PlaidTransaction[] {
  const date = new Date().toISOString().slice(0, 10);
  return [
    { transaction_id: "mock-tx-payroll", account_id: "mock-checking-001", amount: -2500, date, name: "Demo payroll", merchant_name: null, pending: false },
    { transaction_id: "mock-tx-coffee", account_id: "mock-checking-001", amount: 4.75, date, name: "Demo Coffee Shop", merchant_name: "Demo Coffee Shop", pending: false },
    { transaction_id: "mock-tx-card", account_id: "mock-card-001", amount: 42.10, date, name: "Demo Market", merchant_name: "Demo Market", pending: true },
  ];
}

export async function syncConnection(db: Database, userId: string, connectionId: string, options: { onlyEnabled?: boolean } = {}) {
  const onlyEnabled = options.onlyEnabled ?? false;
  const connection = (await db.select().from(providerConnections).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))).limit(1))[0];
  if (!connection) throw new Error("Connection not found");
  if (connection.status === "disconnected") throw new Error("This connection is disconnected");
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  await db.delete(syncLocks).where(and(eq(syncLocks.connectionId, connectionId), lt(syncLocks.acquiredAt, staleBefore)));
  const lease = (await db.insert(syncLocks).values({ connectionId, userId, acquiredAt: new Date() }).onConflictDoNothing().returning({ connectionId: syncLocks.connectionId }))[0];
  if (!lease) throw new SyncBusyError();
  const runId = randomUUID();
  let runStarted = false;
  try {
    await db.insert(syncRuns).values({ id: runId, userId, connectionId, status: "running" });
    runStarted = true;
    const token = decryptProviderToken(connection.accessTokenEncrypted);
    let remoteAccounts: PlaidAccount[];
    let added: PlaidTransaction[] = [];
    let modified: PlaidTransaction[] = [];
    let removed: { transaction_id: string }[] = [];
    let nextCursor: string | null = connection.cursor;
    if (connection.provider === "mock") {
      remoteAccounts = mockProviderAccounts();
      if (!connection.cursor) added = mockTransactions();
      nextCursor = "mock-cursor-v1";
    } else {
      const listed = await plaidRequest<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: token });
      remoteAccounts = listed.accounts;
      const updates = await fetchTransactionUpdates(cursor => plaidRequest<TransactionSyncPage>("/transactions/sync", { access_token: token, cursor: cursor ?? undefined, count: 500 }), connection.cursor);
      ({ added, modified, removed, nextCursor } = updates);
    }
    // Save the complete bank update and its cursor together. A failure rolls
    // everything back so retrying cannot lose half of a pending replacement.
    return await db.transaction(async db => {
      const now = new Date();
      for (const remote of remoteAccounts) {
        const type = accountType(remote);
        const values = { name: remote.name, officialName: remote.official_name ?? null, mask: remote.mask ?? null, type, subtype: remote.subtype ?? null, currentBalanceCents: remote.balances.current == null ? null : Math.round(remote.balances.current * 100), availableBalanceCents: remote.balances.available == null ? null : Math.round(remote.balances.available * 100), balanceAt: now, updatedAt: now };
        const existing = (await db.select({ id: providerAccounts.id, localAccountId: providerAccounts.localAccountId }).from(providerAccounts).where(and(eq(providerAccounts.connectionId, connectionId), eq(providerAccounts.providerAccountId, remote.account_id))).limit(1))[0];
        if (existing) {
          await db.update(providerAccounts).set(values).where(and(eq(providerAccounts.id, existing.id), eq(providerAccounts.userId, userId)));
          if (existing.localAccountId) {
            const local = (await db.select({ syncEnabled: accounts.syncEnabled }).from(accounts).where(and(eq(accounts.id, existing.localAccountId), eq(accounts.userId, userId))).limit(1))[0];
            if (!onlyEnabled || local?.syncEnabled) await db.update(accounts).set({ providerBalanceCents: type === "credit_card" && values.currentBalanceCents !== null ? -Math.abs(values.currentBalanceCents) : values.currentBalanceCents, providerBalanceAt: now }).where(and(eq(accounts.id, existing.localAccountId), eq(accounts.userId, userId)));
          }
        } else {
          await db.insert(providerAccounts).values({ id: randomUUID(), userId, connectionId, providerAccountId: remote.account_id, ...values });
        }
      }
      const providerRows = await db.select().from(providerAccounts).where(and(eq(providerAccounts.connectionId, connectionId), eq(providerAccounts.userId, userId)));
      const localIds = providerRows.map(row => row.localAccountId).filter((id): id is string => Boolean(id));
      const localRows = localIds.length ? await db.select({ id: accounts.id, syncEnabled: accounts.syncEnabled }).from(accounts).where(and(eq(accounts.userId, userId), inArray(accounts.id, localIds))) : [];
      const syncableIds = new Set(onlyEnabled ? localRows.filter(row => row.syncEnabled).map(row => row.id) : localRows.map(row => row.id));
      const localByProvider = new Map(providerRows.filter(row => row.localAccountId && syncableIds.has(row.localAccountId)).map(row => [row.providerAccountId, row.localAccountId!]));
      const accountTypeByProvider = new Map(providerRows.map(row => [row.providerAccountId, row.type]));
      const cutoverDate = syncCutoverDate(connection.createdAt);
      const activeCategoryIds = new Set((await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, userId), eq(categories.active, true)))).map(category => category.id));
      const categoryRuleRows = (await db.select().from(categorizationRules).where(and(eq(categorizationRules.userId, userId), eq(categorizationRules.active, true)))).filter(rule => activeCategoryIds.has(rule.categoryId));
      const ledgerRows = localIds.length ? await db.select().from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.accountId, localIds))) : [];
      const removedLedgerIds = ledgerRows.filter(row => row.status === "removed").map(row => row.id);
      const removalAudits = removedLedgerIds.length ? await db.select({ entityId: auditEvents.entityId }).from(auditEvents).where(and(
        eq(auditEvents.userId, userId), inArray(auditEvents.entityId, removedLedgerIds), or(
          and(eq(auditEvents.action, "delete"), eq(auditEvents.entityType, "transaction")),
          and(eq(auditEvents.action, "suppress_historical"), eq(auditEvents.entityType, "provider_transaction")),
        ),
      )) : [];
      const explicitlyRemovedIds = new Set(removalAudits.map(row => row.entityId));
      const providerRemovalAudits = removedLedgerIds.length ? await db.select({ entityId: auditEvents.entityId }).from(auditEvents).where(and(eq(auditEvents.userId, userId), inArray(auditEvents.entityId, removedLedgerIds), eq(auditEvents.action, "remove"), eq(auditEvents.entityType, "provider_transaction"))) : [];
      const previouslyRemovedByProvider = new Set(providerRemovalAudits.map(row => row.entityId));
      const ledgerIds = ledgerRows.map(row => row.id);
      const restoreAudits = ledgerIds.length ? await db.select({ entityId: auditEvents.entityId, createdAt: auditEvents.createdAt }).from(auditEvents).where(and(eq(auditEvents.userId, userId), inArray(auditEvents.entityId, ledgerIds), eq(auditEvents.entityType, "transaction"), eq(auditEvents.action, "restore_provider_removal"))) : [];
      const restoredAt = new Map<string, Date>();
      for (const audit of restoreAudits) if (!restoredAt.has(audit.entityId) || restoredAt.get(audit.entityId)! < audit.createdAt) restoredAt.set(audit.entityId, audit.createdAt);
      const editAudits = ledgerIds.length ? await db.select({ entityId: auditEvents.entityId, beforeJson: auditEvents.beforeJson, afterJson: auditEvents.afterJson }).from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityType, "transaction"), eq(auditEvents.action, "update"), inArray(auditEvents.entityId, ledgerIds))) : [];
      const overridesById = bankFieldOverrides(editAudits);
      for (const id of ledgerIds) if (!overridesById.has(id)) overridesById.set(id, new Set());
      const paymentRows = localIds.length ? await db.select().from(cardPayments).where(and(eq(cardPayments.userId, userId), or(inArray(cardPayments.fromAccountId, localIds), inArray(cardPayments.toAccountId, localIds)))) : [];
      const matchCandidates: LedgerMatchCandidate[] = ledgerRows.map(row => ({ id: row.id, accountId: row.accountId, amountCents: row.amountCents, kind: row.kind, effectiveDate: row.effectiveDate, description: row.description, source: row.source, status: row.status, providerTransactionId: row.providerTransactionId }));
      const paymentCandidates: CardPaymentMatchCandidate[] = paymentRows.map(row => ({ id: row.id, fromAccountId: row.fromAccountId, toAccountId: row.toAccountId, amountCents: row.amountCents, effectiveDate: row.effectiveDate, providerTransactionId: row.providerTransactionId, destinationProviderTransactionId: row.destinationProviderTransactionId }));
      const reservedMatchIds = new Set<string>();
      const reservedPaymentSides = new Set<string>();
      let addedCount = 0; let modifiedCount = 0; let matchedCount = 0; let suppressedCount = 0; let categorizedCount = 0;
      const flagUpdate = async (transactionId: string, description: string, details: string) => {
        const kind = "provider_update_conflict";
        const existingReview = (await db.select({ id: reviewItems.id }).from(reviewItems).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, transactionId), eq(reviewItems.kind, kind), eq(reviewItems.status, "open"))).limit(1))[0];
        if (existingReview) await db.update(reviewItems).set({ details }).where(eq(reviewItems.id, existingReview.id));
        else await db.insert(reviewItems).values({ id: randomUUID(), userId, transactionId, kind, title: `Check bank update: ${description}`, details });
      };
      const flagPayment = async (payment: typeof cardPayments.$inferSelect, details: string) => {
        const kind = `provider_payment_conflict:${payment.id}`;
        const review = (await db.select({ id: reviewItems.id }).from(reviewItems).where(and(eq(reviewItems.userId, userId), eq(reviewItems.kind, kind), eq(reviewItems.status, "open"))).limit(1))[0];
        if (review) await db.update(reviewItems).set({ details }).where(eq(reviewItems.id, review.id));
        else await db.insert(reviewItems).values({ id: randomUUID(), userId, kind, title: `Check card payment: ${payment.description}`, details });
      };
      const flagPostedRemoval = async (entry: typeof transactions.$inferSelect, bankLastSeenAt: Date) => {
        const kind = "provider_posted_removal";
        // A reviewed historical removal must not reappear on every sync.
        const review = (await db.select().from(reviewItems).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, entry.id), eq(reviewItems.kind, kind))).limit(1))[0];
        if (review && (review.status === "open" || (review.resolvedAt ?? review.createdAt) >= bankLastSeenAt)) return;
        const changes = { title: `Check removed posted entry: ${entry.description}`, details: `Plaid reported this previously posted record (${(entry.amountCents / 100).toFixed(2)}) as removed, and it is excluded from the app balance. No linked replacement was found. A provider removal does not by itself confirm a refund or reversal on your bank statement. Verify the final statement before restoring this entry or accepting the removal.` };
        if (review) await db.update(reviewItems).set({ ...changes, status: "open", resolvedAt: null }).where(eq(reviewItems.id, review.id));
        else await db.insert(reviewItems).values({ id: randomUUID(), userId, transactionId: entry.id, kind, ...changes });
      };
      const updateBankEntry = async (existing: typeof transactions.$inferSelect, normalized: NormalizedTransaction, localAccountId: string) => {
        // A user may have moved a linked entry outside this connection's
        // mapped accounts. Its edits still apply when found by provider ID.
        if (!overridesById.has(existing.id)) {
          const edits = await db.select({ entityId: auditEvents.entityId, beforeJson: auditEvents.beforeJson, afterJson: auditEvents.afterJson }).from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityType, "transaction"), eq(auditEvents.action, "update"), eq(auditEvents.entityId, existing.id)));
          overridesById.set(existing.id, bankFieldOverrides(edits).get(existing.id) ?? new Set());
        }
        const { changes, conflicts } = bankTransactionUpdate(existing, normalized, localAccountId, overridesById.get(existing.id));
        const changed = Object.entries(changes).some(([key, value]) => existing[key as keyof typeof existing] !== value);
        if (changed) await db.update(transactions).set({ ...changes, updatedAt: now }).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
        if (existing.status === "removed") await db.update(reviewItems).set({ status: "resolved", resolvedAt: now, details: "The provider restored this record; it is included in the ledger again." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, existing.id), eq(reviewItems.kind, "provider_posted_removal"), eq(reviewItems.status, "open")));
        if (changes.amountCents !== existing.amountCents || changes.pending !== existing.pending || changes.providerTransactionId !== existing.providerTransactionId) {
          await db.insert(auditEvents).values({ id: randomUUID(), userId, action: "provider_update", entityType: "transaction", entityId: existing.id, beforeJson: JSON.stringify({ amountCents: existing.amountCents, pending: existing.pending, providerTransactionId: existing.providerTransactionId }), afterJson: JSON.stringify({ amountCents: changes.amountCents, pending: changes.pending, providerTransactionId: changes.providerTransactionId, connectionId }) });
        }
        if (changes.kind === "expense" && changes.amountCents < existing.amountCents) {
          const [applicationRows, coverageRows] = await Promise.all([
            db.select({ amountCents: cardPaymentApplications.amountCents }).from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, userId), eq(cardPaymentApplications.transactionId, existing.id))),
            db.select({ amountCents: cardCoverageAdjustments.amountCents }).from(cardCoverageAdjustments).where(and(eq(cardCoverageAdjustments.userId, userId), eq(cardCoverageAdjustments.transactionId, existing.id))),
          ]);
          const coveredCents = [...applicationRows, ...coverageRows].reduce((sum, row) => sum + row.amountCents, 0);
          if (coveredCents > changes.amountCents) conflicts.push(`Purchase coverage ${(coveredCents / 100).toFixed(2)} exceeds the finalized bank charge ${(changes.amountCents / 100).toFixed(2)}. Review the applied payment or coverage adjustment.`);
        }
        if (conflicts.length) await flagUpdate(existing.id, changes.description, conflicts.join(" "));
        const candidate = matchCandidates.find(row => row.id === existing.id);
        if (candidate) Object.assign(candidate, changes);
        return { changes, changed };
      };
      const findMatch = (normalized: NormalizedTransaction, localAccountId: string, excludeId?: string) => findLedgerDuplicate(normalized, localAccountId, matchCandidates.filter(candidate => !reservedMatchIds.has(candidate.id)), excludeId);
      const findPayment = (normalized: NormalizedTransaction, localAccountId: string) => findCardPaymentMatch(normalized, localAccountId, paymentCandidates.filter(candidate => !reservedPaymentSides.has(`${candidate.id}:${normalized.kind === "transfer_out" ? "source" : "destination"}`)));
      const linkExistingLedgerEntry = async (candidate: LedgerMatchCandidate, normalized: NormalizedTransaction, duplicate?: typeof transactions.$inferSelect) => {
        await db.transaction(async tx => {
          if (duplicate) {
            await tx.update(transactions).set({ status: "removed", removedAt: now, providerTransactionId: null, pending: false, updatedAt: now }).where(and(eq(transactions.id, duplicate.id), eq(transactions.userId, userId)));
            await tx.update(reviewItems).set({ status: "resolved", resolvedAt: now, details: "Automatically resolved after matching this Plaid import to an existing ledger entry." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, duplicate.id), eq(reviewItems.status, "open")));
          }
          await tx.update(transactions).set({ providerTransactionId: normalized.providerTransactionId, updatedAt: now }).where(and(eq(transactions.id, candidate.id), eq(transactions.userId, userId)));
          await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "deduplicate", entityType: "provider_transaction", entityId: candidate.id, beforeJson: JSON.stringify({ duplicateTransactionId: duplicate?.id ?? null, source: candidate.source }), afterJson: JSON.stringify({ providerTransactionId: normalized.providerTransactionId, connectionId, matchedBy: "account+amount+date" }) });
        });
        const linked = (await db.select().from(transactions).where(and(eq(transactions.id, candidate.id), eq(transactions.userId, userId))).limit(1))[0];
        if (linked) await updateBankEntry(linked, normalized, localByProvider.get(normalized.providerAccountId)!);
        candidate.providerTransactionId = normalized.providerTransactionId;
        reservedMatchIds.add(candidate.id);
        matchedCount++;
      };
      const linkExistingCardPayment = async (match: NonNullable<ReturnType<typeof findCardPaymentMatch>>, normalized: NormalizedTransaction, duplicate?: typeof transactions.$inferSelect) => {
        const { candidate, side } = match;
        const linkChanges = side === "source" ? { providerTransactionId: normalized.providerTransactionId, updatedAt: now } : { destinationProviderTransactionId: normalized.providerTransactionId, updatedAt: now };
        await db.transaction(async tx => {
          if (duplicate) {
            await tx.update(transactions).set({ status: "removed", removedAt: now, providerTransactionId: null, pending: false, updatedAt: now }).where(and(eq(transactions.id, duplicate.id), eq(transactions.userId, userId)));
            await tx.update(reviewItems).set({ status: "resolved", resolvedAt: now, details: "Automatically resolved after matching this Plaid activity to an existing card payment." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, duplicate.id), eq(reviewItems.status, "open")));
          }
          await tx.update(cardPayments).set(linkChanges).where(and(eq(cardPayments.id, candidate.id), eq(cardPayments.userId, userId)));
          await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "deduplicate", entityType: "card_payment", entityId: candidate.id, beforeJson: JSON.stringify({ duplicateTransactionId: duplicate?.id ?? null }), afterJson: JSON.stringify({ providerTransactionId: normalized.providerTransactionId, providerSide: side, connectionId, matchedBy: "payment_side+account+amount+date" }) });
        });
        if (side === "source") candidate.providerTransactionId = normalized.providerTransactionId;
        else candidate.destinationProviderTransactionId = normalized.providerTransactionId;
        reservedPaymentSides.add(`${candidate.id}:${side}`);
        matchedCount++;
      };
      const suppressPreCutover = async (row: typeof transactions.$inferSelect, providerTransactionId: string) => {
        if (row.status === "removed") return;
        await db.transaction(async tx => {
          await tx.update(transactions).set({ status: "removed", removedAt: now, pending: false, updatedAt: now }).where(and(eq(transactions.id, row.id), eq(transactions.userId, userId)));
          await tx.update(reviewItems).set({ status: "resolved", resolvedAt: now, details: `Automatically resolved because this provider entry predates the ${cutoverDate} sync cutover.` }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, row.id), eq(reviewItems.status, "open")));
          await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "suppress_pre_cutover", entityType: "provider_transaction", entityId: row.id, beforeJson: JSON.stringify({ providerTransactionId, effectiveDate: row.effectiveDate }), afterJson: JSON.stringify({ status: "removed", cutoverDate, connectionId }) });
        });
        suppressedCount++;
      };
      const findLinkedPayment = async (providerTransactionId: string) => (await db.select().from(cardPayments).where(and(eq(cardPayments.userId, userId), or(eq(cardPayments.providerTransactionId, providerTransactionId), eq(cardPayments.destinationProviderTransactionId, providerTransactionId)))).limit(1))[0];

      // Repair the first sync as well as future syncs. Raw rows preserve the
      // provider record even when the duplicate normalized row is suppressed.
      const rawRows = await db.select().from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, userId), eq(rawProviderTransactions.connectionId, connectionId)));
      const rawByProviderId = new Map(rawRows.map(row => [row.providerTransactionId, row]));
      const supersededPendingIds = new Set(rawRows.filter(row => !row.pending && row.pendingTransactionId).map(row => row.pendingTransactionId!));
      for (const row of ledgerRows.filter(row => row.status === "removed" && previouslyRemovedByProvider.has(row.id) && !explicitlyRemovedIds.has(row.id))) {
        const raw = row.providerTransactionId ? rawByProviderId.get(row.providerTransactionId) : null;
        if (raw && !raw.pending && !supersededPendingIds.has(raw.providerTransactionId)) await flagPostedRemoval(row, raw.lastSeenAt);
      }
      for (const plaidRow of ledgerRows.filter(row => row.source === "plaid" && row.status !== "removed" && row.providerTransactionId && rawByProviderId.has(row.providerTransactionId))) {
        const raw = rawByProviderId.get(plaidRow.providerTransactionId!);
        const localAccountId = raw ? localByProvider.get(raw.providerAccountId) : null;
        if (!raw || !localAccountId) continue;
        const parsedRaw = JSON.parse(raw.rawJson) as PlaidTransaction;
        const normalized = toNormalized(parsedRaw, accountTypeByProvider.get(raw.providerAccountId));
        const paymentCandidate = findPayment(normalized, localAccountId);
        if (paymentCandidate) { await linkExistingCardPayment(paymentCandidate, normalized, plaidRow); continue; }
        const candidate = findMatch(normalized, localAccountId, plaidRow.id);
        if (candidate) await linkExistingLedgerEntry(candidate, normalized, plaidRow);
        else if (normalized.date < cutoverDate) await suppressPreCutover(plaidRow, normalized.providerTransactionId);
        else {
          // Also repair amounts already frozen by older versions: the bank may
          // never send another modification once the final amount is stored.
          const { changes, changed } = await updateBankEntry(plaidRow, normalized, localAccountId);
          if (changes.kind !== plaidRow.kind && ["transfer_in", "transfer_out", "refund"].includes(changes.kind)) {
            const isTransfer = changes.kind === "transfer_in" || changes.kind === "transfer_out";
            await db.update(reviewItems).set(isTransfer ? { kind: "provider_transfer", title: `Review imported transfer: ${normalized.description}`, details: changes.kind === "transfer_out" ? "No existing card payment matched this withdrawal. If it paid an untracked card, keep it as a transaction; otherwise record the card payment and this import will be reconciled automatically." : "Confirm this transfer is not new spending and keep it as a transaction if no matching entry exists." } : { kind: "bank_transaction", title: `Review imported refund: ${normalized.description}`, details: "Assign the original spending category, or confirm this refund is already represented in your budget." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, plaidRow.id), eq(reviewItems.status, "open")));
            await db.insert(auditEvents).values({ id: randomUUID(), userId, action: "reclassify", entityType: "provider_transaction", entityId: plaidRow.id, beforeJson: JSON.stringify({ kind: plaidRow.kind }), afterJson: JSON.stringify({ kind: changes.kind, connectionId, matchedBy: isTransfer ? "provider_transfer_descriptor" : "credit_card_credit" }) });
          }
          if (changed) modifiedCount++;
        }
      }

      for (const linkedRow of ledgerRows.filter(row => row.source !== "plaid" && row.status !== "removed" && row.providerTransactionId && rawByProviderId.has(row.providerTransactionId))) {
        const raw = rawByProviderId.get(linkedRow.providerTransactionId!);
        const localAccountId = raw ? localByProvider.get(raw.providerAccountId) : null;
        if (!raw || !localAccountId || supersededPendingIds.has(raw.providerTransactionId)) continue;
        const { changed } = await updateBankEntry(linkedRow, toNormalized(JSON.parse(raw.rawJson) as PlaidTransaction, accountTypeByProvider.get(raw.providerAccountId)), localAccountId);
        if (changed) modifiedCount++;
      }

      for (const remote of finalTransactionUpdates(added, modified)) {
        const normalized = toNormalized(remote, accountTypeByProvider.get(remote.account_id));
        if (normalized.pending && supersededPendingIds.has(normalized.providerTransactionId)) continue;
        await db.insert(rawProviderTransactions).values({ id: randomUUID(), userId, connectionId, providerAccountId: normalized.providerAccountId, providerTransactionId: normalized.providerTransactionId, pendingTransactionId: normalized.pendingTransactionId, pending: normalized.pending, rawJson: JSON.stringify(normalized.raw), lastSeenAt: now, updatedAt: now }).onConflictDoUpdate({ target: [rawProviderTransactions.userId, rawProviderTransactions.providerTransactionId], set: { providerAccountId: normalized.providerAccountId, pendingTransactionId: normalized.pendingTransactionId ?? sql`${rawProviderTransactions.pendingTransactionId}`, pending: normalized.pending, rawJson: JSON.stringify(normalized.raw), lastSeenAt: now, updatedAt: now } });
        const localAccountId = localByProvider.get(normalized.providerAccountId);
        if (!localAccountId) continue;
        let existingPayment = await findLinkedPayment(normalized.providerTransactionId);
        if (!existingPayment && normalized.pendingTransactionId) existingPayment = await findLinkedPayment(normalized.pendingTransactionId);
        if (existingPayment) {
          const destinationSide = existingPayment.destinationProviderTransactionId === normalized.providerTransactionId || (normalized.pendingTransactionId !== null && existingPayment.destinationProviderTransactionId === normalized.pendingTransactionId);
          const currentLink = destinationSide ? existingPayment.destinationProviderTransactionId : existingPayment.providerTransactionId;
          if (currentLink !== normalized.providerTransactionId) await db.update(cardPayments).set(destinationSide ? { destinationProviderTransactionId: normalized.providerTransactionId, updatedAt: now } : { providerTransactionId: normalized.providerTransactionId, updatedAt: now }).where(and(eq(cardPayments.id, existingPayment.id), eq(cardPayments.userId, userId)));
          if (existingPayment.amountCents !== normalized.amountCents) {
            const details = `The bank ${destinationSide ? "credit" : "withdrawal"} is ${(normalized.amountCents / 100).toFixed(2)}, but this card payment is ${(existingPayment.amountCents / 100).toFixed(2)}. Review the payment amount and applications; the payment was not duplicated or silently changed.`;
            await flagPayment(existingPayment, details);
          }
          modifiedCount++;
          continue;
        }
        const paymentCandidate = findPayment(normalized, localAccountId);
        if (paymentCandidate) { await linkExistingCardPayment(paymentCandidate, normalized); continue; }
        let existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, normalized.providerTransactionId))).limit(1))[0];
        if (!existing && normalized.pendingTransactionId) existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, normalized.pendingTransactionId))).limit(1))[0];
        if (existing) {
          // A provider modification must not undo an explicit user removal.
          // Audit lookup also protects entries deleted by older app versions.
          if (existing.status === "removed" && !ledgerIds.includes(existing.id)) {
            const removal = await db.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, existing.id), or(and(eq(auditEvents.action, "delete"), eq(auditEvents.entityType, "transaction")), and(eq(auditEvents.action, "suppress_historical"), eq(auditEvents.entityType, "provider_transaction"))))).limit(1);
            if (removal.length) explicitlyRemovedIds.add(existing.id);
          }
          if (preserveRemovedTransaction({ status: existing.status, effectiveDate: normalized.date }, cutoverDate, explicitlyRemovedIds.has(existing.id))) {
            // Keep the posted identity attached to the excluded entry too, so a
            // later modification without pending_transaction_id cannot revive it.
            if (existing.providerTransactionId !== normalized.providerTransactionId) await db.update(transactions).set({ providerTransactionId: normalized.providerTransactionId, updatedAt: now }).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
            continue;
          }
          await updateBankEntry(existing, normalized, localAccountId);
          modifiedCount++;
        } else {
          const candidate = findMatch(normalized, localAccountId);
          if (candidate) { await linkExistingLedgerEntry(candidate, normalized); continue; }
          if (normalized.date < cutoverDate) { suppressedCount++; continue; }
          const id = randomUUID();
          const categoryRule = normalized.kind === "expense" || normalized.kind === "refund" ? findCategorizationRule(normalized.description, categoryRuleRows) : null;
          const isTransfer = normalized.kind === "transfer_in" || normalized.kind === "transfer_out";
          const reviewDetails = isTransfer
            ? normalized.kind === "transfer_out" ? "No existing card payment matched this withdrawal. If it paid an untracked card, keep it as a transaction; otherwise record the card payment and this import will be reconciled automatically." : "Confirm this transfer is not new spending and keep it as a transaction if no matching entry exists."
            : categoryRule ? "An automatic rule assigned this category. Confirm it or edit the transaction before approving." : importedReviewDetails(normalized.kind, "Review this imported ledger entry.");
          await db.transaction(async tx => {
            await tx.insert(transactions).values({ id, userId, accountId: localAccountId, categoryId: categoryRule?.categoryId ?? null, kind: normalized.kind, amountCents: normalized.amountCents, effectiveDate: normalized.date, description: normalized.description, status: normalized.pending ? "pending" : "posted", source: "plaid", providerTransactionId: normalized.providerTransactionId, pending: normalized.pending });
            await tx.insert(reviewItems).values({ id: randomUUID(), userId, transactionId: id, kind: isTransfer ? "provider_transfer" : "bank_transaction", title: importedReviewTitle(normalized.kind, normalized.description), details: reviewDetails });
            if (categoryRule) await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "auto_categorize", entityType: "provider_transaction", entityId: id, afterJson: JSON.stringify({ categoryRuleId: categoryRule.id, categoryId: categoryRule.categoryId, matchText: categoryRule.matchText, providerTransactionId: normalized.providerTransactionId }) });
          });
          if (categoryRule) categorizedCount++;
          addedCount++;
        }
      }
      for (const removedRow of removed) {
        const existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, removedRow.transaction_id))).limit(1))[0];
        if (existing) {
          const bankRecord = (await db.select({ pending: rawProviderTransactions.pending, lastSeenAt: rawProviderTransactions.lastSeenAt }).from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, userId), eq(rawProviderTransactions.providerTransactionId, removedRow.transaction_id))).limit(1))[0];
          if (!ledgerIds.includes(existing.id)) {
            const restore = (await db.select({ createdAt: auditEvents.createdAt }).from(auditEvents).where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, existing.id), eq(auditEvents.entityType, "transaction"), eq(auditEvents.action, "restore_provider_removal"))).orderBy(sql`${auditEvents.createdAt} desc`).limit(1))[0];
            if (restore) restoredAt.set(existing.id, restore.createdAt);
          }
          // Honor statement-confirmed restorations through a replay of the
          // old removal. Fresh provider data supersedes that old decision.
          const keepRestored = existing.status !== "removed" && bankRecord && restoredAt.has(existing.id) && bankRecord.lastSeenAt <= restoredAt.get(existing.id)!;
          if (!explicitlyRemovedIds.has(existing.id) && !keepRestored) {
            await db.update(transactions).set({ status: "removed", pending: false, removedAt: new Date() }).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
            await db.update(reviewItems).set({ status: "resolved", resolvedAt: new Date(), details: "Automatically resolved because the provider removed this transaction." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, existing.id), eq(reviewItems.status, "open")));
            const [applications, coverage] = await Promise.all([
              db.select({ id: cardPaymentApplications.id }).from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, userId), eq(cardPaymentApplications.transactionId, existing.id))).limit(1),
              db.select({ id: cardCoverageAdjustments.id }).from(cardCoverageAdjustments).where(and(eq(cardCoverageAdjustments.userId, userId), eq(cardCoverageAdjustments.transactionId, existing.id))).limit(1),
            ]);
            if (applications.length || coverage.length) await flagUpdate(existing.id, existing.description, "The bank removed this purchase, but recorded payment applications or coverage corrections still reference it. The purchase is excluded from balances. Check whether a posted replacement needs those applications reassigned; the recorded payments were retained.");
            else if (existing.source !== "plaid") await flagUpdate(existing.id, existing.description, "The bank removed this linked manual/imported entry. It is excluded from balances; check whether it was replaced by a posted transaction or was an authorization hold.");
            if (bankRecord && !bankRecord.pending && !supersededPendingIds.has(removedRow.transaction_id)) await flagPostedRemoval(existing, bankRecord.lastSeenAt);
          }
        }
        // Keep removals for raw-only entries too, including superseded pending
        // rows whose ledger identity has already moved to the posted ID.
        await db.insert(auditEvents).values({ id: randomUUID(), userId, action: "remove", entityType: "provider_transaction", entityId: existing?.id ?? removedRow.transaction_id, afterJson: JSON.stringify({ providerTransactionId: removedRow.transaction_id, connectionId }) });
        const existingPayment = await findLinkedPayment(removedRow.transaction_id);
        if (existingPayment) {
          const destinationSide = existingPayment.destinationProviderTransactionId === removedRow.transaction_id;
          await db.update(cardPayments).set(destinationSide ? { destinationProviderTransactionId: null, updatedAt: now } : { providerTransactionId: null, updatedAt: now }).where(and(eq(cardPayments.id, existingPayment.id), eq(cardPayments.userId, userId)));
          await flagPayment(existingPayment, `The bank removed the linked ${destinationSide ? "card credit" : "cash withdrawal"}. The recorded card payment and its applications remain. Check whether the bank replaced it with another transaction before changing the payment.`);
          await db.insert(auditEvents).values({ id: randomUUID(), userId, action: "unlink", entityType: "card_payment", entityId: existingPayment.id, beforeJson: JSON.stringify({ providerTransactionId: removedRow.transaction_id, providerSide: destinationSide ? "destination" : "source" }), afterJson: JSON.stringify({ providerTransactionId: null, connectionId }) });
        }
      }
      await db.update(providerConnections).set({ cursor: nextCursor, status: "connected", lastSyncAt: now, lastError: null, updatedAt: now }).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
      await db.update(syncRuns).set({ status: "succeeded", finishedAt: now, addedCount, modifiedCount, removedCount: removed.length }).where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId)));
      return { runId, added: addedCount, modified: modifiedCount, removed: removed.length, matched: matchedCount, suppressed: suppressedCount, categorized: categorizedCount, cutoverDate, syncedAt: now.toISOString() };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider sync failed";
    const reauthRequired = error instanceof PlaidError && ["ITEM_LOGIN_REQUIRED", "ITEM_LOCKED", "ITEM_NOT_FOUND"].includes(error.code ?? "");
    await db.update(providerConnections).set({ status: reauthRequired ? "reauth_required" : "error", lastError: message, updatedAt: new Date() }).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    if (runStarted) await db.update(syncRuns).set({ status: "failed", finishedAt: new Date(), error: message }).where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId)));
    throw error;
  } finally {
    await db.delete(syncLocks).where(and(eq(syncLocks.connectionId, connectionId), eq(syncLocks.userId, userId)));
  }
}

export { accountType, decryptProviderToken, encryptProviderToken, hasPlaidCredentials, hasProviderEncryptionKey, mockProviderAccounts, plaidRequest };
