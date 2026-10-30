import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { auditEvents, cardPaymentApplications, cardPayments, reviewItems, transactions } from "../../../lib/schema";
import { paymentDeleteSchema, paymentSchema, paymentUpdateSchema } from "../../../lib/api-validation";
import { createCardPayment, updateCardPayment } from "../../../lib/card-payment-commands";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid card payment" }, { status: 400 });
  return createCardPayment(getDatabase(), user.id, parsed.data);
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = paymentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid card payment" }, { status: 400 });
  return updateCardPayment(getDatabase(), user.id, parsed.data);
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
