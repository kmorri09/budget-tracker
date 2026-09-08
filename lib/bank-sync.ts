import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { Database } from "./db";
import { accounts, auditEvents, providerAccounts, providerConnections, rawProviderTransactions, reviewItems, syncLocks, syncRuns, transactions } from "./schema";
import { accountType, findLedgerDuplicate, mockProviderAccounts, syncCutoverDate, toNormalized, type LedgerMatchCandidate, type NormalizedTransaction, type PlaidAccount, type PlaidTransaction } from "./bank-sync-core";
import { decryptProviderToken, encryptProviderToken, hasProviderEncryptionKey } from "./provider-crypto";

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
  const payload = await response.json().catch(() => null) as (T & { error_code?: string; error_message?: string }) | null;
  if (!response.ok || !payload) throw new PlaidError(payload?.error_message ?? `Plaid request failed (${response.status})`, payload?.error_code);
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
      let hasMore = true; let pages = 0;
      while (hasMore && pages++ < 20) {
        const page = await plaidRequest<{ added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean }>("/transactions/sync", { access_token: token, cursor: nextCursor ?? undefined, count: 500 });
        added = added.concat(page.added ?? []); modified = modified.concat(page.modified ?? []); removed = removed.concat(page.removed ?? []); nextCursor = page.next_cursor; hasMore = Boolean(page.has_more);
      }
    }
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
    const cutoverDate = syncCutoverDate(connection.createdAt);
    const ledgerRows = localIds.length ? await db.select().from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.accountId, localIds))) : [];
    const matchCandidates: LedgerMatchCandidate[] = ledgerRows.map(row => ({ id: row.id, accountId: row.accountId, amountCents: row.amountCents, kind: row.kind, effectiveDate: row.effectiveDate, description: row.description, source: row.source, status: row.status, providerTransactionId: row.providerTransactionId }));
    const reservedMatchIds = new Set<string>();
    let addedCount = 0; let modifiedCount = 0; let matchedCount = 0; let suppressedCount = 0;
    const findMatch = (normalized: NormalizedTransaction, localAccountId: string, excludeId?: string) => findLedgerDuplicate(normalized, localAccountId, matchCandidates.filter(candidate => !reservedMatchIds.has(candidate.id)), excludeId);
    const linkExistingLedgerEntry = async (candidate: LedgerMatchCandidate, normalized: NormalizedTransaction, duplicate?: typeof transactions.$inferSelect) => {
      await db.transaction(async tx => {
        if (duplicate) {
          await tx.update(transactions).set({ status: "removed", removedAt: now, providerTransactionId: null, pending: false, updatedAt: now }).where(and(eq(transactions.id, duplicate.id), eq(transactions.userId, userId)));
          await tx.update(reviewItems).set({ status: "resolved", resolvedAt: now, details: "Automatically resolved after matching this Plaid import to an existing ledger entry." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, duplicate.id), eq(reviewItems.status, "open")));
        }
        await tx.update(transactions).set({ providerTransactionId: normalized.providerTransactionId, updatedAt: now }).where(and(eq(transactions.id, candidate.id), eq(transactions.userId, userId)));
        await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "deduplicate", entityType: "provider_transaction", entityId: candidate.id, beforeJson: JSON.stringify({ duplicateTransactionId: duplicate?.id ?? null, source: candidate.source }), afterJson: JSON.stringify({ providerTransactionId: normalized.providerTransactionId, connectionId, matchedBy: "account+amount+date" }) });
      });
      candidate.providerTransactionId = normalized.providerTransactionId;
      reservedMatchIds.add(candidate.id);
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

    // Repair the first sync as well as future syncs. Raw rows preserve the
    // provider record even when the duplicate normalized row is suppressed.
    const rawRows = await db.select().from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, userId), eq(rawProviderTransactions.connectionId, connectionId)));
    const rawByProviderId = new Map(rawRows.map(row => [row.providerTransactionId, row]));
    for (const plaidRow of ledgerRows.filter(row => row.source === "plaid" && row.status !== "removed" && row.providerTransactionId && rawByProviderId.has(row.providerTransactionId))) {
      const raw = rawByProviderId.get(plaidRow.providerTransactionId!);
      const localAccountId = raw ? localByProvider.get(raw.providerAccountId) : null;
      if (!raw || !localAccountId) continue;
      const parsedRaw = JSON.parse(raw.rawJson) as PlaidTransaction;
      const normalized = toNormalized(parsedRaw);
      const candidate = findMatch(normalized, localAccountId, plaidRow.id);
      if (candidate) await linkExistingLedgerEntry(candidate, normalized, plaidRow);
      else if (normalized.date < cutoverDate) await suppressPreCutover(plaidRow, normalized.providerTransactionId);
      else if ((normalized.kind === "transfer_in" || normalized.kind === "transfer_out") && plaidRow.kind !== normalized.kind) {
        await db.transaction(async tx => {
          await tx.update(transactions).set({ kind: normalized.kind, categoryId: null, updatedAt: now }).where(and(eq(transactions.id, plaidRow.id), eq(transactions.userId, userId)));
          await tx.update(reviewItems).set({ kind: "provider_transfer", title: `Review imported transfer: ${normalized.description}`, details: "Confirm this transfer or card payment is not new spending, then match it to the receiving account if needed." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, plaidRow.id), eq(reviewItems.status, "open")));
          await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "reclassify", entityType: "provider_transaction", entityId: plaidRow.id, beforeJson: JSON.stringify({ kind: plaidRow.kind }), afterJson: JSON.stringify({ kind: normalized.kind, connectionId, matchedBy: "provider_transfer_descriptor" }) });
        });
        plaidRow.kind = normalized.kind;
        const matchCandidate = matchCandidates.find(row => row.id === plaidRow.id);
        if (matchCandidate) matchCandidate.kind = normalized.kind;
        modifiedCount++;
      }
    }

    for (const remote of [...added, ...modified]) {
      const normalized = toNormalized(remote);
      await db.insert(rawProviderTransactions).values({ id: randomUUID(), userId, connectionId, providerAccountId: normalized.providerAccountId, providerTransactionId: normalized.providerTransactionId, pendingTransactionId: normalized.pendingTransactionId, pending: normalized.pending, rawJson: JSON.stringify(normalized.raw), lastSeenAt: now, updatedAt: now }).onConflictDoUpdate({ target: [rawProviderTransactions.userId, rawProviderTransactions.providerTransactionId], set: { providerAccountId: normalized.providerAccountId, pendingTransactionId: normalized.pendingTransactionId, pending: normalized.pending, rawJson: JSON.stringify(normalized.raw), lastSeenAt: now, updatedAt: now } });
      const localAccountId = localByProvider.get(normalized.providerAccountId);
      if (!localAccountId) continue;
      let existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, normalized.providerTransactionId))).limit(1))[0];
      if (!existing && normalized.pendingTransactionId) existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, normalized.pendingTransactionId))).limit(1))[0];
      if (existing) {
        if (existing.status === "removed" && normalized.date < cutoverDate) continue;
        const providerManaged = existing.source === "plaid";
        await db.update(transactions).set({ accountId: localAccountId, providerTransactionId: normalized.providerTransactionId, amountCents: normalized.amountCents, kind: normalized.kind, categoryId: normalized.kind === "expense" ? existing.categoryId : null, effectiveDate: providerManaged ? normalized.date : existing.effectiveDate, description: providerManaged ? normalized.description : existing.description, status: providerManaged ? (normalized.pending ? "pending" : "posted") : existing.status, pending: providerManaged ? normalized.pending : existing.pending, source: existing.source, updatedAt: now }).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
        modifiedCount++;
      } else {
        const candidate = findMatch(normalized, localAccountId);
        if (candidate) { await linkExistingLedgerEntry(candidate, normalized); continue; }
        if (normalized.date < cutoverDate) { suppressedCount++; continue; }
        const id = randomUUID();
        await db.insert(transactions).values({ id, userId, accountId: localAccountId, categoryId: null, kind: normalized.kind, amountCents: normalized.amountCents, effectiveDate: normalized.date, description: normalized.description, status: normalized.pending ? "pending" : "posted", source: "plaid", providerTransactionId: normalized.providerTransactionId, pending: normalized.pending });
        if (normalized.kind === "expense") await db.insert(reviewItems).values({ id: randomUUID(), userId, transactionId: id, kind: "bank_transaction", title: `Review imported transaction: ${normalized.description}`, details: "Assign a category or confirm this imported activity is already represented in your budget." });
        if (normalized.kind === "transfer_in" || normalized.kind === "transfer_out") await db.insert(reviewItems).values({ id: randomUUID(), userId, transactionId: id, kind: "provider_transfer", title: `Review imported transfer: ${normalized.description}`, details: "Confirm this transfer or card payment is not new spending, then match it to the receiving account if needed." });
        addedCount++;
      }
    }
    for (const removedRow of removed) {
      const existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, removedRow.transaction_id))).limit(1))[0];
      if (existing) {
        if (existing.source === "plaid") {
          await db.update(transactions).set({ status: "removed", pending: false, removedAt: new Date() }).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
          await db.update(reviewItems).set({ status: "resolved", resolvedAt: new Date(), details: "Automatically resolved because the provider removed this transaction." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, existing.id), eq(reviewItems.status, "open")));
        } else await db.update(transactions).set({ providerTransactionId: null, updatedAt: new Date() }).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
        await db.insert(auditEvents).values({ id: randomUUID(), userId, action: "remove", entityType: "provider_transaction", entityId: existing.id, afterJson: JSON.stringify({ providerTransactionId: removedRow.transaction_id, connectionId }) });
      }
    }
    await db.update(providerConnections).set({ cursor: nextCursor, status: "connected", lastSyncAt: now, lastError: null, updatedAt: now }).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    await db.update(syncRuns).set({ status: "succeeded", finishedAt: now, addedCount, modifiedCount, removedCount: removed.length }).where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId)));
    return { runId, added: addedCount, modified: modifiedCount, removed: removed.length, matched: matchedCount, suppressed: suppressedCount, cutoverDate, syncedAt: now.toISOString() };
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
