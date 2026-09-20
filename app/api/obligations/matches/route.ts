import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { matchStrength } from "../../../../lib/obligation-status";
import { accounts, auditEvents, cardPayments, obligationMatchDecisions, obligations, transactions } from "../../../../lib/schema";

const inputSchema = z.object({
  obligationId: z.string().min(1),
  candidateType: z.enum(["transaction", "payment"]),
  candidateId: z.string().min(1),
  status: z.enum(["confirmed", "dismissed"]),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid match decision" }, { status: 400 });
  const input = parsed.data;
  const db = getDatabase();
  const obligation = (await db.select().from(obligations).where(and(eq(obligations.id, input.obligationId), eq(obligations.userId, user.id))).limit(1))[0];
  if (!obligation) return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
  const candidate = input.candidateType === "payment"
    ? (await db.select().from(cardPayments).where(and(eq(cardPayments.id, input.candidateId), eq(cardPayments.userId, user.id))).limit(1))[0]
    : (await db.select().from(transactions).where(and(eq(transactions.id, input.candidateId), eq(transactions.userId, user.id))).limit(1))[0];
  if (!candidate) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
  const destination = "fromAccountId" in candidate ? (await db.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, candidate.toAccountId), eq(accounts.userId, user.id))).limit(1))[0] : null;
  const coverage = "fromAccountId" in candidate
    ? { description: `${candidate.description} ${destination?.name ?? ""}`.trim(), amountCents: candidate.amountCents, effectiveDate: candidate.effectiveDate, fromAccountId: candidate.fromAccountId, toAccountId: candidate.toAccountId }
    : { description: candidate.description, amountCents: candidate.amountCents, effectiveDate: candidate.effectiveDate, accountId: candidate.accountId };
  if (coverage.effectiveDate > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "Only withdrawals that have occurred can be matched" }, { status: 400 });
  if (!matchStrength(obligation, coverage)) return NextResponse.json({ error: "This charge is outside the matching range" }, { status: 400 });
  if ("status" in candidate && (candidate.status !== "posted" || candidate.pending || !["expense", "transfer_out", "card_payment"].includes(candidate.kind))) return NextResponse.json({ error: "Only posted withdrawals can be matched" }, { status: 400 });
  if (input.status === "confirmed") {
    const confirmed = (await db.select().from(obligationMatchDecisions).where(and(eq(obligationMatchDecisions.userId, user.id), eq(obligationMatchDecisions.candidateType, input.candidateType), eq(obligationMatchDecisions.candidateId, input.candidateId), eq(obligationMatchDecisions.status, "confirmed"))).limit(1))[0];
    if (confirmed && confirmed.obligationId !== input.obligationId) return NextResponse.json({ error: "This charge is already confirmed for another obligation" }, { status: 409 });
  }
  const existing = (await db.select().from(obligationMatchDecisions).where(and(eq(obligationMatchDecisions.obligationId, input.obligationId), eq(obligationMatchDecisions.candidateType, input.candidateType), eq(obligationMatchDecisions.candidateId, input.candidateId))).limit(1))[0];
  await db.transaction(async tx => {
    if (existing) await tx.update(obligationMatchDecisions).set({ status: input.status }).where(eq(obligationMatchDecisions.id, existing.id));
    else await tx.insert(obligationMatchDecisions).values({ id: randomUUID(), userId: user.id, obligationId: input.obligationId, candidateType: input.candidateType, candidateId: input.candidateId, status: input.status });
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: input.status, entityType: "obligation_match", entityId: input.obligationId, afterJson: JSON.stringify(input) });
  });
  return NextResponse.json({ ok: true });
}
