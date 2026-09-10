import { and, asc, eq, gte, inArray, lte, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { CARD_PAYMENT_MATCH_DAYS } from "../../../lib/bank-sync-core";
import { accounts, auditEvents, cardCoverageAdjustments, cardPaymentApplications, cardPayments, reviewItems, transactions } from "../../../lib/schema";
import { paymentDeleteSchema, paymentSchema, paymentUpdateSchema } from "../../../lib/api-validation";

export const runtime = "nodejs";

const cents = (amount: number) => Math.round(amount * 100);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid card payment" }, { status: 400 });
  const input = parsed.data;
  if (input.fromAccountId === input.toAccountId) return NextResponse.json({ error: "Choose different source and credit-card accounts" }, { status: 400 });
  const amountCents = cents(input.amount);
  const db = getDatabase();
  const ownedAccounts = await db.select().from(accounts).where(and(eq(accounts.userId, user.id), or(eq(accounts.id, input.fromAccountId), eq(accounts.name, input.fromAccountId), eq(accounts.id, input.toAccountId), eq(accounts.name, input.toAccountId))));
  const from = ownedAccounts.find(account => account.id === input.fromAccountId || account.name === input.fromAccountId);
  const to = ownedAccounts.find(account => account.id === input.toAccountId || account.name === input.toAccountId);
  if (!from || !to) return NextResponse.json({ error: "Account not found" }, { status: 400 });
  if (from.type === "credit_card") return NextResponse.json({ error: "The payment must come from a checking or savings account" }, { status: 400 });
  if (to.type !== "credit_card") return NextResponse.json({ error: "Choose a credit-card account to pay" }, { status: 400 });

  const paymentTime = new Date(`${input.date}T00:00:00Z`).getTime();
  const dateFrom = new Date(paymentTime - CARD_PAYMENT_MATCH_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateTo = new Date(paymentTime + CARD_PAYMENT_MATCH_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [sourceCandidates, destinationCandidates] = await Promise.all([
    db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.accountId, from.id), eq(transactions.kind, "transfer_out"), eq(transactions.source, "plaid"), eq(transactions.amountCents, amountCents), ne(transactions.status, "removed"), gte(transactions.effectiveDate, dateFrom), lte(transactions.effectiveDate, dateTo))),
    db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.accountId, to.id), eq(transactions.kind, "transfer_in"), eq(transactions.source, "plaid"), eq(transactions.amountCents, amountCents), ne(transactions.status, "removed"), gte(transactions.effectiveDate, dateFrom), lte(transactions.effectiveDate, dateTo))),
  ]);
  const linkedSourceCandidates = sourceCandidates.filter(row => Boolean(row.providerTransactionId));
  const linkedDestinationCandidates = destinationCandidates.filter(row => Boolean(row.providerTransactionId));
  const matchedSource = linkedSourceCandidates.length === 1 ? linkedSourceCandidates[0] : null;
  const matchedDestination = linkedDestinationCandidates.length === 1 ? linkedDestinationCandidates[0] : null;
  const matchedImports: (typeof sourceCandidates)[number][] = [];
  if (matchedSource) matchedImports.push(matchedSource);
  if (matchedDestination) matchedImports.push(matchedDestination);

  const expenseRows = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.accountId, to.id), eq(transactions.kind, "expense"), ne(transactions.status, "removed"), lte(transactions.effectiveDate, input.date))).orderBy(asc(transactions.effectiveDate), asc(transactions.createdAt));
  const expenseIds = expenseRows.map(row => row.id);
  const [existingRows, coverageRows] = expenseIds.length ? await Promise.all([
    db.select().from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, user.id), inArray(cardPaymentApplications.transactionId, expenseIds))),
    db.select().from(cardCoverageAdjustments).where(and(eq(cardCoverageAdjustments.userId, user.id), inArray(cardCoverageAdjustments.transactionId, expenseIds))),
  ]) : [[], []];
  const alreadyApplied = new Map<string, number>();
  for (const row of [...existingRows, ...coverageRows]) alreadyApplied.set(row.transactionId, (alreadyApplied.get(row.transactionId) ?? 0) + row.amountCents);

  const requested = input.applications ? input.applications.map(item => ({ transactionId: item.transactionId, amountCents: cents(item.amount) })) : null;
  const applications: { transactionId: string; amountCents: number }[] = [];
  if (requested) {
    const validIds = new Set(expenseRows.map(row => row.id));
    for (const item of requested) {
      if (!validIds.has(item.transactionId)) return NextResponse.json({ error: "Every selected purchase must belong to the destination card" }, { status: 400 });
      const row = expenseRows.find(expense => expense.id === item.transactionId)!;
      const remaining = Math.max(0, row.amountCents - (alreadyApplied.get(item.transactionId) ?? 0));
      if (item.amountCents > remaining) return NextResponse.json({ error: "A purchase cannot be paid more than its remaining amount" }, { status: 400 });
      applications.push(item);
    }
  } else {
    let remainingPayment = amountCents;
    for (const row of expenseRows) {
      const remainingExpense = Math.max(0, row.amountCents - (alreadyApplied.get(row.id) ?? 0));
      if (!remainingExpense || remainingPayment <= 0) continue;
      const applied = Math.min(remainingExpense, remainingPayment);
      applications.push({ transactionId: row.id, amountCents: applied });
      remainingPayment -= applied;
    }
  }
  const appliedCents = applications.reduce((sum, item) => sum + item.amountCents, 0);
  if (appliedCents > amountCents) return NextResponse.json({ error: "Applied purchases cannot exceed the payment amount" }, { status: 400 });

  const paymentId = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(cardPayments).values({ id: paymentId, userId: user.id, fromAccountId: from.id, toAccountId: to.id, amountCents, effectiveDate: input.date, description: input.description, providerTransactionId: matchedSource?.providerTransactionId ?? null, destinationProviderTransactionId: matchedDestination?.providerTransactionId ?? null });
    if (applications.length) await tx.insert(cardPaymentApplications).values(applications.map(item => ({ id: randomUUID(), userId: user.id, paymentId, transactionId: item.transactionId, amountCents: item.amountCents })));
    for (const matchedImport of matchedImports) {
      await tx.update(transactions).set({ status: "removed", removedAt: new Date(), providerTransactionId: null, pending: false, updatedAt: new Date() }).where(and(eq(transactions.id, matchedImport.id), eq(transactions.userId, user.id)));
      await tx.update(reviewItems).set({ status: "resolved", resolvedAt: new Date(), details: "Resolved after converting this Plaid activity into a card payment." }).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.transactionId, matchedImport.id), eq(reviewItems.status, "open")));
    }
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "card_payment", entityId: paymentId, afterJson: JSON.stringify({ ...input, amountCents, appliedCents, matchedSourceProviderTransactionId: matchedSource?.providerTransactionId ?? null, matchedDestinationProviderTransactionId: matchedDestination?.providerTransactionId ?? null }) });
  });
  return NextResponse.json({ id: paymentId, appliedCents, unappliedCents: amountCents - appliedCents, reconciledImport: matchedImports.length > 0, reconciledImportCount: matchedImports.length, ok: true });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paymentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid card payment" }, { status: 400 });
  const input = parsed.data;
  if (input.fromAccountId === input.toAccountId) return NextResponse.json({ error: "Choose different source and credit-card accounts" }, { status: 400 });
  if (new Set(input.applications.map(application => application.transactionId)).size !== input.applications.length) return NextResponse.json({ error: "Each purchase can be applied only once" }, { status: 400 });
  const amountCents = cents(input.amount);
  const db = getDatabase();
  const existing = (await db.select().from(cardPayments).where(and(eq(cardPayments.id, input.id), eq(cardPayments.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Card payment not found" }, { status: 404 });
  const ownedAccounts = await db.select().from(accounts).where(and(eq(accounts.userId, user.id), or(eq(accounts.id, input.fromAccountId), eq(accounts.id, input.toAccountId))));
  const from = ownedAccounts.find(account => account.id === input.fromAccountId);
  const to = ownedAccounts.find(account => account.id === input.toAccountId);
  if (!from || !to) return NextResponse.json({ error: "Account not found" }, { status: 400 });
  if (from.type === "credit_card") return NextResponse.json({ error: "The payment must come from a checking or savings account" }, { status: 400 });
  if (to.type !== "credit_card") return NextResponse.json({ error: "Choose a credit-card account to pay" }, { status: 400 });

  const expenseRows = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.accountId, to.id), eq(transactions.kind, "expense"), ne(transactions.status, "removed"), lte(transactions.effectiveDate, input.date)));
  const expenseById = new Map(expenseRows.map(row => [row.id, row]));
  const expenseIds = expenseRows.map(row => row.id);
  const [currentApplications, otherApplications, coverageRows] = await Promise.all([
    db.select().from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, user.id), eq(cardPaymentApplications.paymentId, input.id))),
    expenseIds.length ? db.select().from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, user.id), ne(cardPaymentApplications.paymentId, input.id), inArray(cardPaymentApplications.transactionId, expenseIds))) : Promise.resolve([]),
    expenseIds.length ? db.select().from(cardCoverageAdjustments).where(and(eq(cardCoverageAdjustments.userId, user.id), inArray(cardCoverageAdjustments.transactionId, expenseIds))) : Promise.resolve([]),
  ]);
  const coveredElsewhere = new Map<string, number>();
  for (const row of [...otherApplications, ...coverageRows]) coveredElsewhere.set(row.transactionId, (coveredElsewhere.get(row.transactionId) ?? 0) + row.amountCents);
  const applications = input.applications.map(application => ({ transactionId: application.transactionId, amountCents: cents(application.amount) }));
  for (const application of applications) {
    const purchase = expenseById.get(application.transactionId);
    if (!purchase) return NextResponse.json({ error: "Every selected purchase must belong to the destination card and occur by the payment date" }, { status: 400 });
    const capacity = Math.max(0, purchase.amountCents - (coveredElsewhere.get(purchase.id) ?? 0));
    if (application.amountCents > capacity) return NextResponse.json({ error: `Applied amount exceeds the available balance for ${purchase.description}` }, { status: 400 });
  }
  const appliedCents = applications.reduce((sum, application) => sum + application.amountCents, 0);
  if (appliedCents > amountCents) return NextResponse.json({ error: "Applied purchases cannot exceed the payment amount" }, { status: 400 });
  const changes = { fromAccountId: from.id, toAccountId: to.id, amountCents, effectiveDate: input.date, description: input.description, updatedAt: new Date() };
  await db.transaction(async tx => {
    await tx.update(cardPayments).set(changes).where(and(eq(cardPayments.id, existing.id), eq(cardPayments.userId, user.id)));
    await tx.delete(cardPaymentApplications).where(and(eq(cardPaymentApplications.paymentId, existing.id), eq(cardPaymentApplications.userId, user.id)));
    if (applications.length) await tx.insert(cardPaymentApplications).values(applications.map(application => ({ id: randomUUID(), userId: user.id, paymentId: existing.id, transactionId: application.transactionId, amountCents: application.amountCents })));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "update", entityType: "card_payment", entityId: existing.id, beforeJson: JSON.stringify({ payment: existing, applications: currentApplications }), afterJson: JSON.stringify({ payment: changes, applications }) });
  });
  return NextResponse.json({ id: existing.id, appliedCents, unappliedCents: amountCents - appliedCents, ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paymentDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Card payment id is required" }, { status: 400 });
  const db = getDatabase();
  const existing = (await db.select().from(cardPayments).where(and(eq(cardPayments.id, parsed.data.id), eq(cardPayments.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Card payment not found" }, { status: 404 });
  const applications = await db.select().from(cardPaymentApplications).where(and(eq(cardPaymentApplications.paymentId, existing.id), eq(cardPaymentApplications.userId, user.id)));
  const linkedLegs: { providerTransactionId: string; accountId: string; kind: "transfer_out" | "transfer_in"; replacementTransactionId: string }[] = [];
  if (existing.providerTransactionId) linkedLegs.push({ providerTransactionId: existing.providerTransactionId, accountId: existing.fromAccountId, kind: "transfer_out", replacementTransactionId: randomUUID() });
  if (existing.destinationProviderTransactionId) linkedLegs.push({ providerTransactionId: existing.destinationProviderTransactionId, accountId: existing.toAccountId, kind: "transfer_in", replacementTransactionId: randomUUID() });
  await db.transaction(async tx => {
    await tx.delete(cardPayments).where(and(eq(cardPayments.id, existing.id), eq(cardPayments.userId, user.id)));
    for (const leg of linkedLegs) {
      const suppress = parsed.data.suppressProviderTransaction;
      await tx.insert(transactions).values({ id: leg.replacementTransactionId, userId: user.id, accountId: leg.accountId, categoryId: null, kind: leg.kind, amountCents: existing.amountCents, effectiveDate: existing.effectiveDate, description: existing.description, status: suppress ? "removed" : "posted", source: "plaid", providerTransactionId: leg.providerTransactionId, userEdited: true, pending: false, removedAt: suppress ? new Date() : null });
      if (!suppress) await tx.insert(reviewItems).values({ id: randomUUID(), userId: user.id, transactionId: leg.replacementTransactionId, kind: "provider_transfer", title: `Review imported transfer: ${existing.description}`, details: "This Plaid transfer returned to Review because its linked card payment was deleted. Keep it as a transaction or record the correct card payment." });
    }
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "delete", entityType: "card_payment", entityId: existing.id, beforeJson: JSON.stringify({ payment: existing, applications }), afterJson: JSON.stringify({ deleted: true, replacementTransactionIds: linkedLegs.map(leg => leg.replacementTransactionId), providerDisposition: parsed.data.suppressProviderTransaction ? "suppressed" : "review" }) });
  });
  return NextResponse.json({ id: existing.id, restoredProviderTransaction: Boolean(linkedLegs.length && !parsed.data.suppressProviderTransaction), suppressedProviderTransaction: Boolean(linkedLegs.length && parsed.data.suppressProviderTransaction), affectedProviderTransactions: linkedLegs.length, ok: true });
}
