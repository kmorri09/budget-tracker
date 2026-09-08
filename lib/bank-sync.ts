import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "./db";
import { accounts, auditEvents, providerAccounts, providerConnections, rawProviderTransactions, reviewItems, syncRuns, transactions } from "./schema";

type PlaidAccount = { account_id: string; name: string; official_name?: string | null; mask?: string | null; type: string; subtype?: string | null; balances: { current?: number | null; available?: number | null } };
type PlaidTransaction = { transaction_id: string; pending_transaction_id?: string | null; account_id: string; amount: number; date: string; authorized_date?: string | null; name?: string | null; merchant_name?: string | null; pending?: boolean; personal_finance_category?: { primary?: string | null } | null };
type NormalizedTransaction = { providerTransactionId: string; pendingTransactionId: string | null; providerAccountId: string; amountCents: number; kind: "expense" | "income"; date: string; description: string; pending: boolean; raw: PlaidTransaction };

const plaidBaseUrl = () => ({ sandbox: "https://sandbox.plaid.com", development: "https://development.plaid.com", production: "https://production.plaid.com" }[process.env.PLAID_ENV ?? "sandbox"] ?? "https://sandbox.plaid.com");
const hasPlaidCredentials = () => Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
export const hasProviderEncryptionKey = () => Boolean(process.env.PLAID_TOKEN_ENCRYPTION_KEY ?? process.env.SESSION_SECRET);

function encryptionKey() {
  const secret = process.env.PLAID_TOKEN_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!secret) throw new Error("Set PLAID_TOKEN_ENCRYPTION_KEY (or SESSION_SECRET) before connecting a live bank");
  return createHash("sha256").update(secret).digest();
}

export function encryptProviderToken(token: string) {
  if (token === "mock") return "mock";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptProviderToken(value: string) {
  if (value === "mock") return "mock";
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Stored provider token is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

async function plaidRequest<T>(path: string, body: Record<string, unknown>) {
  if (!hasPlaidCredentials()) throw new Error("Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to enable live connections.");
  const response = await fetch(`${plaidBaseUrl()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }), cache: "no-store" });
  const payload = await response.json().catch(() => null) as (T & { error_code?: string; error_message?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error_message ?? `Plaid request failed (${response.status})`);
  return payload;
}

export async function createPlaidLinkToken(userId: string) {
  return plaidRequest<{ link_token: string }>("/link/token/create", { user: { client_user_id: userId }, client_name: "Budget", products: ["transactions"], country_codes: ["US"], language: "en" });
}

export async function exchangePlaidPublicToken(publicToken: string) {
  const exchanged = await plaidRequest<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
  const item = await plaidRequest<{ item: { institution_id?: string | null } }>("/item/get", { access_token: exchanged.access_token });
  const listed = await plaidRequest<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: exchanged.access_token });
  return { ...exchanged, institutionId: item.item.institution_id ?? null, accounts: listed.accounts };
}

export function mockProviderAccounts(): PlaidAccount[] {
  return [
    { account_id: "mock-checking-001", name: "Demo Checking", official_name: "Demo Checking", mask: "1234", type: "depository", subtype: "checking", balances: { current: 1842.35, available: 1842.35 } },
    { account_id: "mock-card-001", name: "Demo Credit Card", official_name: "Demo Credit Card", mask: "9876", type: "credit", subtype: "credit card", balances: { current: 327.42, available: 9672.58 } },
  ];
}

function mockTransactions(): PlaidTransaction[] {
  const date = new Date().toISOString().slice(0, 10);
  return [
    { transaction_id: "mock-tx-payroll", account_id: "mock-checking-001", amount: -2500, date, name: "Demo payroll", merchant_name: null, pending: false },
    { transaction_id: "mock-tx-coffee", account_id: "mock-checking-001", amount: 4.75, date, name: "Demo Coffee Shop", merchant_name: "Demo Coffee Shop", pending: false },
    { transaction_id: "mock-tx-card", account_id: "mock-card-001", amount: 42.10, date, name: "Demo Market", merchant_name: "Demo Market", pending: true },
  ];
}

function accountType(account: PlaidAccount) {
  if (account.type === "credit" || account.subtype === "credit card") return "credit_card";
  if (account.subtype === "savings") return "savings";
  return "checking";
}

function toNormalized(transaction: PlaidTransaction): NormalizedTransaction {
  return { providerTransactionId: transaction.transaction_id, pendingTransactionId: transaction.pending_transaction_id ?? null, providerAccountId: transaction.account_id, amountCents: Math.round(Math.abs(transaction.amount) * 100), kind: transaction.amount < 0 ? "income" : "expense", date: transaction.date || transaction.authorized_date || new Date().toISOString().slice(0, 10), description: transaction.merchant_name || transaction.name || "Imported transaction", pending: Boolean(transaction.pending), raw: transaction };
}

export async function syncConnection(db: Database, userId: string, connectionId: string) {
  const connection = (await db.select().from(providerConnections).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))).limit(1))[0];
  if (!connection) throw new Error("Connection not found");
  if (connection.status === "disconnected") throw new Error("This connection is disconnected");
  const runId = randomUUID();
  await db.insert(syncRuns).values({ id: runId, userId, connectionId, status: "running" });
  try {
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
        if (existing.localAccountId) await db.update(accounts).set({ providerBalanceCents: type === "credit_card" && values.currentBalanceCents !== null ? -Math.abs(values.currentBalanceCents) : values.currentBalanceCents, providerBalanceAt: now }).where(and(eq(accounts.id, existing.localAccountId), eq(accounts.userId, userId)));
      } else {
        await db.insert(providerAccounts).values({ id: randomUUID(), userId, connectionId, providerAccountId: remote.account_id, ...values });
      }
    }
    const providerRows = await db.select().from(providerAccounts).where(and(eq(providerAccounts.connectionId, connectionId), eq(providerAccounts.userId, userId)));
    const localIds = providerRows.map(row => row.localAccountId).filter((id): id is string => Boolean(id));
    const localRows = localIds.length ? await db.select({ id: accounts.id, syncEnabled: accounts.syncEnabled }).from(accounts).where(and(eq(accounts.userId, userId), inArray(accounts.id, localIds))) : [];
    const syncEnabledIds = new Set(localRows.filter(row => row.syncEnabled).map(row => row.id));
    const localByProvider = new Map(providerRows.filter(row => row.localAccountId && syncEnabledIds.has(row.localAccountId)).map(row => [row.providerAccountId, row.localAccountId!]));
    let addedCount = 0; let modifiedCount = 0;
    for (const remote of [...added, ...modified]) {
      const normalized = toNormalized(remote);
      await db.insert(rawProviderTransactions).values({ id: randomUUID(), userId, connectionId, providerAccountId: normalized.providerAccountId, providerTransactionId: normalized.providerTransactionId, pendingTransactionId: normalized.pendingTransactionId, pending: normalized.pending, rawJson: JSON.stringify(normalized.raw), lastSeenAt: now, updatedAt: now }).onConflictDoUpdate({ target: [rawProviderTransactions.userId, rawProviderTransactions.providerTransactionId], set: { providerAccountId: normalized.providerAccountId, pendingTransactionId: normalized.pendingTransactionId, pending: normalized.pending, rawJson: JSON.stringify(normalized.raw), lastSeenAt: now, updatedAt: now } });
      const localAccountId = localByProvider.get(normalized.providerAccountId);
      if (!localAccountId) continue;
      let existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, normalized.providerTransactionId))).limit(1))[0];
      if (!existing && normalized.pendingTransactionId) existing = (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, normalized.pendingTransactionId))).limit(1))[0];
      if (existing) {
        await db.update(transactions).set({ accountId: localAccountId, providerTransactionId: normalized.providerTransactionId, amountCents: normalized.amountCents, kind: normalized.kind, effectiveDate: normalized.date, description: normalized.description, status: normalized.pending ? "pending" : "posted", pending: normalized.pending, source: "plaid", updatedAt: now }).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
        modifiedCount++;
      } else {
        const id = randomUUID();
        await db.insert(transactions).values({ id, userId, accountId: localAccountId, categoryId: null, kind: normalized.kind, amountCents: normalized.amountCents, effectiveDate: normalized.date, description: normalized.description, status: normalized.pending ? "pending" : "posted", source: "plaid", providerTransactionId: normalized.providerTransactionId, pending: normalized.pending });
        if (normalized.kind === "expense") await db.insert(reviewItems).values({ id: randomUUID(), userId, transactionId: id, kind: "bank_transaction", title: `Review imported transaction: ${normalized.description}`, details: "Assign a category or confirm this imported activity is already represented in your budget." });
        addedCount++;
      }
    }
    for (const removedRow of removed) {
      const existing = (await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.providerTransactionId, removedRow.transaction_id))).limit(1))[0];
      if (existing) {
        await db.delete(transactions).where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)));
        await db.insert(auditEvents).values({ id: randomUUID(), userId, action: "remove", entityType: "provider_transaction", entityId: existing.id, afterJson: JSON.stringify({ providerTransactionId: removedRow.transaction_id, connectionId }) });
      }
    }
    await db.update(providerConnections).set({ cursor: nextCursor, status: "connected", lastSyncAt: now, lastError: null, updatedAt: now }).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    await db.update(syncRuns).set({ status: "succeeded", finishedAt: now, addedCount, modifiedCount, removedCount: removed.length }).where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId)));
    return { runId, added: addedCount, modified: modifiedCount, removed: removed.length, syncedAt: now.toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider sync failed";
    await db.update(providerConnections).set({ status: "error", lastError: message, updatedAt: new Date() }).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId)));
    await db.update(syncRuns).set({ status: "failed", finishedAt: new Date(), error: message }).where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId)));
    throw error;
  }
}

export { accountType, hasPlaidCredentials, plaidRequest };
