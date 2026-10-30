import { budgetToday } from "./budget-date";
import { and, asc, eq, gte, lte, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { Database } from "./db";
import { z } from "zod";
import { CARD_PAYMENT_MATCH_DAYS } from "./bank-sync-core";
import { accounts, auditEvents, cardPaymentApplications, cardPayments, reviewItems, transactions } from "./schema";
import { paymentSchema, paymentUpdateSchema } from "./api-validation";
import { loadPaymentWorkspace } from "./payment-workspace";
import { paymentAffordability } from "./payment-affordability";


const cents = (amount: number) => Math.round(amount * 100);

export async function createCardPayment(database: Pick<Database, "transaction">, userId: string, input: z.infer<typeof paymentSchema>) {
  if (input.fromAccountId === input.toAccountId) return NextResponse.json({ error: "Choose different source and credit-card accounts" }, { status: 400 });
  const amountCents = cents(input.amount);
  if (amountCents < 1) return NextResponse.json({ error: "Payment must be at least one cent" }, { status: 400 });
  try {
    return await database.transaction(async db => {
      const ownedAccounts = await db.select().from(accounts).where(and(eq(accounts.userId, userId), or(eq(accounts.id, input.fromAccountId), eq(accounts.name, input.fromAccountId), eq(accounts.id, input.toAccountId), eq(accounts.name, input.toAccountId))));
      const from = ownedAccounts.find(account => account.id === input.fromAccountId || account.name === input.fromAccountId);
      const to = ownedAccounts.find(account => account.id === input.toAccountId || account.name === input.toAccountId);
      if (!from || !to) return NextResponse.json({ error: "Account not found" }, { status: 400 });
      if (from.type === "credit_card") return NextResponse.json({ error: "The payment must come from a checking or savings account" }, { status: 400 });
      if (to.type !== "credit_card") return NextResponse.json({ error: "Choose a credit-card account to pay" }, { status: 400 });

      const paymentTime = new Date(`${input.date}T00:00:00Z`).getTime();
      const dateFrom = new Date(paymentTime - CARD_PAYMENT_MATCH_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const dateTo = new Date(paymentTime + CARD_PAYMENT_MATCH_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [sourceCandidates, destinationCandidates] = await Promise.all([
        db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.accountId, from.id), eq(transactions.kind, "transfer_out"), eq(transactions.source, "plaid"), eq(transactions.amountCents, amountCents), ne(transactions.status, "removed"), gte(transactions.effectiveDate, dateFrom), lte(transactions.effectiveDate, dateTo))),
        db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.accountId, to.id), eq(transactions.kind, "transfer_in"), eq(transactions.source, "plaid"), eq(transactions.amountCents, amountCents), ne(transactions.status, "removed"), gte(transactions.effectiveDate, dateFrom), lte(transactions.effectiveDate, dateTo))),
      ]);
      const linkedSourceCandidates = sourceCandidates.filter(row => Boolean(row.providerTransactionId));
      const linkedDestinationCandidates = destinationCandidates.filter(row => Boolean(row.providerTransactionId));
      const matchedSource = linkedSourceCandidates.length === 1 ? linkedSourceCandidates[0] : null;
      const matchedDestination = linkedDestinationCandidates.length === 1 ? linkedDestinationCandidates[0] : null;
      const matchedImports: (typeof sourceCandidates)[number][] = [];
      if (matchedSource) matchedImports.push(matchedSource);
      if (matchedDestination) matchedImports.push(matchedDestination);

      const today = budgetToday();
      const currentWorkspace = await loadPaymentWorkspace(db, userId, today);
      if (!input.alreadyMade && !matchedImports.length) {
        if (!input.reviewToken || input.reviewToken !== currentWorkspace.paymentReviewToken) return NextResponse.json({ error: "Your budget changed. Refresh and review the latest refund coverage and cash limits before saving." }, { status: 409 });
        const destination = currentWorkspace.accounts.find(a => a.id === to.id)!;
        if (amountCents > Math.max(0, -Math.round(destination.ledgerBalance * 100))) return NextResponse.json({ error: "This exceeds the card balance owed after refunds and credits. Refresh and reduce the payment." }, { status: 409 });
        const affordability = paymentAffordability(currentWorkspace, from.id);
        if (amountCents > affordability.affordableCents) return NextResponse.json({ error: `This payment exceeds the $${(affordability.affordableCents / 100).toFixed(2)} available after protecting other allocations. Reduce the amount or reallocate funds.`, affordability }, { status: 409 });
      }
      const coverageWorkspace = input.date === today ? currentWorkspace : await loadPaymentWorkspace(db, userId, input.date);
      const expenseRows = await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.accountId, to.id), eq(transactions.kind, "expense"), eq(transactions.status, "posted"), eq(transactions.pending, false), lte(transactions.effectiveDate, input.date))).orderBy(asc(transactions.effectiveDate), asc(transactions.createdAt));
      const requested = input.applications ? input.applications.map(item => ({ transactionId: item.transactionId, amountCents: cents(item.amount) })) : null;
      if (requested && new Set(requested.map(a => a.transactionId)).size !== requested.length) return NextResponse.json({ error: "Each purchase can be applied only once" }, { status: 400 });
      const applications: { transactionId: string; amountCents: number }[] = [];
      if (requested) {
        const validIds = new Set(expenseRows.map(row => row.id));
        for (const item of requested) {
          if (!validIds.has(item.transactionId)) return NextResponse.json({ error: "Every selected purchase must belong to the destination card" }, { status: 400 });
          const remaining = coverageWorkspace.cardCoverage.coverage.get(item.transactionId)?.remainingCents ?? 0;
          if (item.amountCents > remaining) return NextResponse.json({ error: "A purchase cannot be paid more than its remaining amount" }, { status: 400 });
          applications.push(item);
        }
      } else {
        let remainingPayment = amountCents;
        for (const row of expenseRows) {
          const remainingExpense = coverageWorkspace.cardCoverage.coverage.get(row.id)?.remainingCents ?? 0;
          if (!remainingExpense || remainingPayment <= 0) continue;
          const applied = Math.min(remainingExpense, remainingPayment);
          applications.push({ transactionId: row.id, amountCents: applied });
          remainingPayment -= applied;
        }
      }
      const appliedCents = applications.reduce((sum, item) => sum + item.amountCents, 0);
      if (appliedCents > amountCents) return NextResponse.json({ error: "Applied purchases cannot exceed the payment amount" }, { status: 400 });

      const paymentId = randomUUID();
      {
        const tx = db;
        await tx.insert(cardPayments).values({ id: paymentId, userId: userId, fromAccountId: from.id, toAccountId: to.id, amountCents, effectiveDate: input.date, description: input.description, providerTransactionId: matchedSource?.providerTransactionId ?? null, destinationProviderTransactionId: matchedDestination?.providerTransactionId ?? null });
        if (applications.length) await tx.insert(cardPaymentApplications).values(applications.map(item => ({ id: randomUUID(), userId: userId, paymentId, transactionId: item.transactionId, amountCents: item.amountCents })));
        for (const matchedImport of matchedImports) {
          await tx.update(transactions).set({ status: "removed", removedAt: new Date(), providerTransactionId: null, pending: false, updatedAt: new Date() }).where(and(eq(transactions.id, matchedImport.id), eq(transactions.userId, userId)));
          await tx.update(reviewItems).set({ status: "resolved", resolvedAt: new Date(), details: "Resolved after converting this Plaid activity into a card payment." }).where(and(eq(reviewItems.userId, userId), eq(reviewItems.transactionId, matchedImport.id), eq(reviewItems.status, "open")));
        }
        await tx.insert(auditEvents).values({ id: randomUUID(), userId: userId, action: "create", entityType: "card_payment", entityId: paymentId, afterJson: JSON.stringify({ ...input, amountCents, appliedCents, matchedSourceProviderTransactionId: matchedSource?.providerTransactionId ?? null, matchedDestinationProviderTransactionId: matchedDestination?.providerTransactionId ?? null }) });
      }
      return NextResponse.json({ id: paymentId, appliedCents, unappliedCents: amountCents - appliedCents, reconciledImport: matchedImports.length > 0, reconciledImportCount: matchedImports.length, ok: true });
  }, { isolationLevel: "serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "40001") return NextResponse.json({ error: "Your budget changed while saving. Refresh and review the payment again." }, { status: 409 });
    throw error;
  }
}


export async function updateCardPayment(database: Pick<Database, "transaction">, userId: string, input: z.infer<typeof paymentUpdateSchema>) {
  if (input.fromAccountId === input.toAccountId) return NextResponse.json({ error: "Choose different source and credit-card accounts" }, { status: 400 });
  if (new Set(input.applications.map(application => application.transactionId)).size !== input.applications.length) return NextResponse.json({ error: "Each purchase can be applied only once" }, { status: 400 });
  const amountCents = cents(input.amount);
  if (amountCents < 1) return NextResponse.json({ error: "Payment must be at least one cent" }, { status: 400 });
  try {
    return await database.transaction(async db => {
      const existing = (await db.select().from(cardPayments).where(and(eq(cardPayments.id, input.id), eq(cardPayments.userId, userId))).limit(1))[0];
      if (!existing) return NextResponse.json({ error: "Card payment not found" }, { status: 404 });
      const ownedAccounts = await db.select().from(accounts).where(and(eq(accounts.userId, userId), or(eq(accounts.id, input.fromAccountId), eq(accounts.id, input.toAccountId))));
      const from = ownedAccounts.find(account => account.id === input.fromAccountId);
      const to = ownedAccounts.find(account => account.id === input.toAccountId);
      if (!from || !to) return NextResponse.json({ error: "Account not found" }, { status: 400 });
      if (from.type === "credit_card") return NextResponse.json({ error: "The payment must come from a checking or savings account" }, { status: 400 });
      if (to.type !== "credit_card") return NextResponse.json({ error: "Choose a credit-card account to pay" }, { status: 400 });

      const currentWorkspace = await loadPaymentWorkspace(db, userId, budgetToday());
      const coverageWorkspace = await loadPaymentWorkspace(db, userId, input.date, input.id);
      if (!input.alreadyMade && !existing.providerTransactionId && !existing.destinationProviderTransactionId) {
        if (!input.reviewToken || input.reviewToken !== currentWorkspace.paymentReviewToken) return NextResponse.json({ error: "Your budget changed. Refresh and review the payment again." }, { status: 409 });
        const affordability = paymentAffordability(coverageWorkspace, from.id);
        if (amountCents > affordability.affordableCents) return NextResponse.json({ error: `This payment exceeds the $${(affordability.affordableCents / 100).toFixed(2)} available after protecting other allocations.` }, { status: 409 });
      }
      const expenseRows = await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.accountId, to.id), eq(transactions.kind, "expense"), eq(transactions.status, "posted"), eq(transactions.pending, false), lte(transactions.effectiveDate, input.date)));
      const expenseById = new Map(expenseRows.map(row => [row.id, row]));
      const currentApplications = await db.select().from(cardPaymentApplications).where(and(eq(cardPaymentApplications.userId, userId), eq(cardPaymentApplications.paymentId, input.id)));
      const applications = input.applications.map(application => ({ transactionId: application.transactionId, amountCents: cents(application.amount) }));
      for (const application of applications) {
        const purchase = expenseById.get(application.transactionId);
        if (!purchase) return NextResponse.json({ error: "Every selected purchase must belong to the destination card and occur by the payment date" }, { status: 400 });
        const capacity = coverageWorkspace.cardCoverage.coverage.get(purchase.id)?.remainingCents ?? 0;
        if (application.amountCents > capacity) return NextResponse.json({ error: `Applied amount exceeds the available balance for ${purchase.description}` }, { status: 400 });
      }
      const appliedCents = applications.reduce((sum, application) => sum + application.amountCents, 0);
      if (appliedCents > amountCents) return NextResponse.json({ error: "Applied purchases cannot exceed the payment amount" }, { status: 400 });
      const changes = { fromAccountId: from.id, toAccountId: to.id, amountCents, effectiveDate: input.date, description: input.description, updatedAt: new Date() };
      {
        const tx = db;
        await tx.update(cardPayments).set(changes).where(and(eq(cardPayments.id, existing.id), eq(cardPayments.userId, userId)));
        await tx.delete(cardPaymentApplications).where(and(eq(cardPaymentApplications.paymentId, existing.id), eq(cardPaymentApplications.userId, userId)));
        if (applications.length) await tx.insert(cardPaymentApplications).values(applications.map(application => ({ id: randomUUID(), userId: userId, paymentId: existing.id, transactionId: application.transactionId, amountCents: application.amountCents })));
        await tx.insert(auditEvents).values({ id: randomUUID(), userId: userId, action: "update", entityType: "card_payment", entityId: existing.id, beforeJson: JSON.stringify({ payment: existing, applications: currentApplications }), afterJson: JSON.stringify({ payment: changes, applications }) });
      }
      return NextResponse.json({ id: existing.id, appliedCents, unappliedCents: amountCents - appliedCents, ok: true });
  }, { isolationLevel: "serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "40001") return NextResponse.json({ error: "Your budget changed while saving. Refresh and review the payment again." }, { status: 409 });
    throw error;
  }
}

