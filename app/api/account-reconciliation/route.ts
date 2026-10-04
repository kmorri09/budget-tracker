import { and, eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { calculateAccountLedgerCents, transactionBalanceEffectCents } from "../../../lib/account-ledger";
import { linkedBankDifferences, nearbyPaymentBankActivity, possibleLedgerDuplicates, type PaymentEvidence, type ReconciliationBankActivity } from "../../../lib/account-reconciliation";
import { toNormalized, type PlaidTransaction } from "../../../lib/bank-sync-core";
import { accounts, auditEvents, cardPaymentApplications, cardPayments, providerAccounts, providerConnections, rawProviderTransactions, transactions } from "../../../lib/schema";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "Account id is required" }, { status: 400 });

  const db = getDatabase();
  const account = (await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, user.id))).limit(1))[0];
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [ledgerRows, paymentRows, mappedProviderAccounts] = await Promise.all([
    db.select().from(transactions).where(and(eq(transactions.accountId, account.id), eq(transactions.userId, user.id))).orderBy(transactions.effectiveDate),
    db.select().from(cardPayments).where(and(eq(cardPayments.userId, user.id), or(eq(cardPayments.fromAccountId, account.id), eq(cardPayments.toAccountId, account.id)))).orderBy(cardPayments.effectiveDate),
    db.select().from(providerAccounts).where(and(eq(providerAccounts.userId, user.id), eq(providerAccounts.localAccountId, account.id))),
  ]);

  const connectionIds = [...new Set(mappedProviderAccounts.map(row => row.connectionId))];
  const paymentIds = paymentRows.map(row => row.id);
  const [accountNames, paymentApplications] = paymentIds.length ? await Promise.all([
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(and(eq(accounts.userId, user.id), inArray(accounts.id, [...new Set(paymentRows.flatMap(row => [row.fromAccountId, row.toAccountId]))]))),
    db.select({ paymentId: cardPaymentApplications.paymentId, id: transactions.id, date: transactions.effectiveDate, description: transactions.description, amountCents: cardPaymentApplications.amountCents })
      .from(cardPaymentApplications).innerJoin(transactions, eq(transactions.id, cardPaymentApplications.transactionId))
      .where(and(eq(cardPaymentApplications.userId, user.id), eq(transactions.userId, user.id), inArray(cardPaymentApplications.paymentId, paymentIds))),
  ]) : [[], []];
  const nameByAccountId = new Map(accountNames.map(row => [row.id, row.name]));
  const providerAccountScope = or(...mappedProviderAccounts.map(row => and(eq(rawProviderTransactions.connectionId, row.connectionId), eq(rawProviderTransactions.providerAccountId, row.providerAccountId))));
  const [rawRows, connections] = await Promise.all([
    providerAccountScope
      ? db.select().from(rawProviderTransactions).where(and(eq(rawProviderTransactions.userId, user.id), providerAccountScope))
      : Promise.resolve([]),
    connectionIds.length
      ? db.select({ id: providerConnections.id, provider: providerConnections.provider, institutionName: providerConnections.institutionName, status: providerConnections.status, lastSyncAt: providerConnections.lastSyncAt }).from(providerConnections).where(and(eq(providerConnections.userId, user.id), inArray(providerConnections.id, connectionIds)))
      : Promise.resolve([]),
  ]);
  const providerRemovalAudits = rawRows.length
    ? await db.select({ beforeJson: auditEvents.beforeJson, afterJson: auditEvents.afterJson, createdAt: auditEvents.createdAt }).from(auditEvents).where(and(eq(auditEvents.userId, user.id), or(
      and(eq(auditEvents.action, "remove"), eq(auditEvents.entityType, "provider_transaction")),
      and(eq(auditEvents.action, "unlink"), eq(auditEvents.entityType, "card_payment")),
    )))
    : [];
  const savedProviderIds = new Set(rawRows.map(row => row.providerTransactionId));
  const removedProviderAt = new Map<string, Date>();
  for (const audit of providerRemovalAudits) {
    try {
      const after = JSON.parse(audit.afterJson ?? "{}") as { providerTransactionId?: string | null };
      const before = JSON.parse(audit.beforeJson ?? "{}") as { providerTransactionId?: string | null };
      const providerTransactionId = after.providerTransactionId ?? before.providerTransactionId;
      if (providerTransactionId && savedProviderIds.has(providerTransactionId) && (!removedProviderAt.has(providerTransactionId) || removedProviderAt.get(providerTransactionId)!.getTime() < audit.createdAt.getTime())) removedProviderAt.set(providerTransactionId, audit.createdAt);
    } catch { /* Ignore malformed historical audit details. */ }
  }

  const linkedProviderIds = new Set<string>();
  for (const row of ledgerRows) if (row.providerTransactionId) linkedProviderIds.add(row.providerTransactionId);
  for (const payment of paymentRows) {
    if (payment.fromAccountId === account.id && payment.providerTransactionId) linkedProviderIds.add(payment.providerTransactionId);
    if (payment.toAccountId === account.id && payment.destinationProviderTransactionId) linkedProviderIds.add(payment.destinationProviderTransactionId);
  }

  // Pending and posted bank records can have different provider ids. Treat the
  // two ids as aliases so a normal pending-to-posted replacement stays linked.
  const aliases = new Map<string, Set<string>>();
  const addAlias = (left: string, right: string) => {
    if (!aliases.has(left)) aliases.set(left, new Set());
    if (!aliases.has(right)) aliases.set(right, new Set());
    aliases.get(left)!.add(right);
    aliases.get(right)!.add(left);
  };
  for (const row of rawRows) if (row.pendingTransactionId) addAlias(row.providerTransactionId, row.pendingTransactionId);
  const linkedQueue = [...linkedProviderIds];
  while (linkedQueue.length) {
    const id = linkedQueue.pop()!;
    for (const alias of aliases.get(id) ?? []) {
      if (!linkedProviderIds.has(alias)) {
        linkedProviderIds.add(alias);
        linkedQueue.push(alias);
      }
    }
  }

  const ledgerEntries = [
    ...ledgerRows.map(row => ({
      id: row.id,
      date: row.effectiveDate,
      description: row.description,
      kind: row.kind,
      amountCents: row.amountCents,
      signedCents: transactionBalanceEffectCents(row.kind, row.amountCents),
      status: row.status,
      pending: row.pending,
      source: row.source,
      providerTransactionId: row.providerTransactionId,
      linkedToBank: Boolean(row.providerTransactionId),
      excluded: row.status === "removed",
      paymentEvidence: null as PaymentEvidence | null,
    })),
    ...paymentRows.map(payment => {
      const fromAccount = payment.fromAccountId === account.id;
      return {
        id: payment.id,
        date: payment.effectiveDate,
        description: payment.description,
        kind: "card_payment",
        amountCents: payment.amountCents,
        signedCents: fromAccount ? -payment.amountCents : payment.amountCents,
        status: "posted",
        pending: false,
        source: "card_payment",
        providerTransactionId: fromAccount ? payment.providerTransactionId : payment.destinationProviderTransactionId,
        linkedToBank: fromAccount ? Boolean(payment.providerTransactionId) : Boolean(payment.destinationProviderTransactionId),
        excluded: false,
        paymentEvidence: {
          fromAccountName: nameByAccountId.get(payment.fromAccountId) ?? "Cash account",
          toAccountName: nameByAccountId.get(payment.toAccountId) ?? "Credit card",
          bankSide: fromAccount ? "withdrawal" : "credit",
          otherSideLinkedToBank: Boolean(fromAccount ? payment.destinationProviderTransactionId : payment.providerTransactionId),
          appliedCents: paymentApplications.filter(row => row.paymentId === payment.id).reduce((sum, row) => sum + row.amountCents, 0),
          purchases: paymentApplications.filter(row => row.paymentId === payment.id).map(({ id, date, description, amountCents }) => ({ id, date, description, amountCents })),
          nearbyBankActivity: [],
        } as PaymentEvidence,
      };
    }),
  ].sort((left, right) => right.date.localeCompare(left.date));

  const bankActivity: ReconciliationBankActivity[] = [];
  let malformedProviderRows = 0;
  const typeByProviderAccount = new Map(mappedProviderAccounts.map(row => [`${row.connectionId}:${row.providerAccountId}`, row.type]));
  for (const row of rawRows) {
    try {
      const normalized = toNormalized(JSON.parse(row.rawJson) as PlaidTransaction, typeByProviderAccount.get(`${row.connectionId}:${row.providerAccountId}`) ?? account.type);
      bankActivity.push({
        id: row.providerTransactionId,
        date: normalized.date,
        description: normalized.description,
        kind: normalized.kind,
        amountCents: normalized.amountCents,
        signedCents: transactionBalanceEffectCents(normalized.kind, normalized.amountCents),
        pending: normalized.pending,
        removedByProvider: Boolean(removedProviderAt.get(row.providerTransactionId) && row.lastSeenAt <= removedProviderAt.get(row.providerTransactionId)!),
        linkedToApp: linkedProviderIds.has(row.providerTransactionId),
      });
    } catch {
      malformedProviderRows++;
    }
  }
  bankActivity.sort((left, right) => right.date.localeCompare(left.date));
  const supersededProviderIds = new Set(rawRows.flatMap(row => row.pendingTransactionId ? [row.pendingTransactionId] : []));
  for (const entry of ledgerEntries) if (entry.paymentEvidence) {
    entry.paymentEvidence.nearbyBankActivity = nearbyPaymentBankActivity(entry, bankActivity, supersededProviderIds);
  }

  const ledgerBalanceCents = calculateAccountLedgerCents(account.id, account.openingBalanceCents, ledgerRows, paymentRows);
  const ledgerTransactionCents = ledgerRows.filter(row => row.status !== "removed").reduce((sum, row) => sum + transactionBalanceEffectCents(row.kind, row.amountCents), 0);
  const ledgerPaymentCents = paymentRows.reduce((sum, payment) => sum + (payment.fromAccountId === account.id ? -payment.amountCents : payment.toAccountId === account.id ? payment.amountCents : 0), 0);

  return NextResponse.json({
    account: { id: account.id, name: account.name, type: account.type, openingBalanceCents: account.openingBalanceCents, providerBalanceCents: account.providerBalanceCents, providerBalanceAt: account.providerBalanceAt, ledgerBalanceCents },
    differenceCents: account.providerBalanceCents === null ? null : account.providerBalanceCents - ledgerBalanceCents,
    breakdown: { openingBalanceCents: account.openingBalanceCents, transactionCents: ledgerTransactionCents, cardPaymentCents: ledgerPaymentCents },
    providerAccounts: mappedProviderAccounts.map(row => ({ id: row.id, name: row.name, mask: row.mask, balanceAt: row.balanceAt })),
    connections: connections.map(row => ({ provider: row.provider, institutionName: row.institutionName, status: row.status, lastSyncAt: row.lastSyncAt })),
    bankActivity,
    ledgerEntries,
    possibleDuplicates: possibleLedgerDuplicates(ledgerEntries),
    linkedBankDifferences: linkedBankDifferences(ledgerEntries, bankActivity, new Map(rawRows.filter(row => row.pendingTransactionId).map(row => [row.pendingTransactionId!, row.providerTransactionId]))),
    malformedProviderRows,
  });
}
