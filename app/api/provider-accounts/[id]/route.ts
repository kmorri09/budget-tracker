import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { accounts, auditEvents, providerAccounts, providerConnections } from "../../../../lib/schema";

const schema = z.object({ localAccountId: z.string().min(1).nullable() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an account or clear the mapping" }, { status: 400 });
  const db = getDatabase();
  const row = (await db.select({ providerAccount: providerAccounts, connection: providerConnections }).from(providerAccounts).innerJoin(providerConnections, eq(providerConnections.id, providerAccounts.connectionId)).where(and(eq(providerAccounts.id, id), eq(providerAccounts.userId, user.id), eq(providerConnections.userId, user.id))).limit(1))[0];
  if (!row) return NextResponse.json({ error: "Provider account not found" }, { status: 404 });
  let local = null as typeof accounts.$inferSelect | null;
  if (parsed.data.localAccountId) local = (await db.select().from(accounts).where(and(eq(accounts.id, parsed.data.localAccountId), eq(accounts.userId, user.id), eq(accounts.active, true))).limit(1))[0] ?? null;
  if (parsed.data.localAccountId && !local) return NextResponse.json({ error: "Local account not found" }, { status: 404 });
  if (parsed.data.localAccountId) {
    const alreadyMapped = (await db.select({ id: providerAccounts.id }).from(providerAccounts).where(and(eq(providerAccounts.userId, user.id), eq(providerAccounts.localAccountId, parsed.data.localAccountId))).limit(2)).filter(item => item.id !== id);
    if (alreadyMapped.length) return NextResponse.json({ error: "That budget account is already mapped to another provider account" }, { status: 409 });
  }
  if (local && local.type !== row.providerAccount.type) {
    const compatible = row.providerAccount.type === "credit_card" ? local.type === "credit_card" : local.type !== "credit_card";
    if (!compatible) return NextResponse.json({ error: "Checking/savings and credit-card accounts must stay matched by type" }, { status: 400 });
  }
  const previous = row.providerAccount.localAccountId;
  await db.transaction(async tx => {
    if (previous && previous !== parsed.data.localAccountId) await tx.update(accounts).set({ provider: null, providerAccountId: null, syncEnabled: false }).where(and(eq(accounts.id, previous), eq(accounts.userId, user.id), eq(accounts.providerAccountId, row.providerAccount.providerAccountId)));
    await tx.update(providerAccounts).set({ localAccountId: parsed.data.localAccountId, updatedAt: new Date() }).where(and(eq(providerAccounts.id, id), eq(providerAccounts.userId, user.id)));
    if (local) await tx.update(accounts).set({ provider: row.connection.provider, providerAccountId: row.providerAccount.providerAccountId, syncEnabled: true, providerBalanceCents: row.providerAccount.type === "credit_card" && row.providerAccount.currentBalanceCents !== null ? -Math.abs(row.providerAccount.currentBalanceCents) : row.providerAccount.currentBalanceCents, providerBalanceAt: row.providerAccount.balanceAt ?? new Date() }).where(and(eq(accounts.id, local.id), eq(accounts.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "map", entityType: "provider_account", entityId: id, afterJson: JSON.stringify({ localAccountId: parsed.data.localAccountId, connectionId: row.connection.id }) });
  });
  return NextResponse.json({ ok: true, localAccountId: parsed.data.localAccountId });
}
