import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { PlaidError, SyncBusyError, decryptProviderToken, removePlaidItem, syncConnection } from "../../../../lib/bank-sync";
import { accounts, auditEvents, providerAccounts, providerConnections } from "../../../../lib/schema";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const input = await request.json().catch(() => ({})) as { action?: string };
  if (input.action !== "sync" && input.action !== "reauth-complete") return NextResponse.json({ error: "Unsupported connection action" }, { status: 400 });
  if (input.action === "reauth-complete") {
    const updated = await getDatabase().update(providerConnections).set({ status: "connected", lastError: null, updatedAt: new Date() }).where(and(eq(providerConnections.id, id), eq(providerConnections.userId, user.id))).returning({ id: providerConnections.id });
    if (!updated.length) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  try { return NextResponse.json({ ok: true, ...(await syncConnection(getDatabase(), user.id, id)) }); }
  catch (error) {
    const status = error instanceof SyncBusyError ? 409 : error instanceof PlaidError && ["ITEM_LOGIN_REQUIRED", "ITEM_LOCKED", "ITEM_NOT_FOUND"].includes(error.code ?? "") ? 409 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync this connection", reauthRequired: error instanceof PlaidError && ["ITEM_LOGIN_REQUIRED", "ITEM_LOCKED", "ITEM_NOT_FOUND"].includes(error.code ?? "") }, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDatabase();
  const connection = (await db.select().from(providerConnections).where(and(eq(providerConnections.id, id), eq(providerConnections.userId, user.id))).limit(1))[0];
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const linked = await db.select({ localAccountId: providerAccounts.localAccountId, providerAccountId: providerAccounts.providerAccountId }).from(providerAccounts).where(and(eq(providerAccounts.connectionId, id), eq(providerAccounts.userId, user.id)));
  let revocationError: string | null = null;
  if (connection.provider === "plaid" && connection.accessTokenEncrypted !== "revoked") {
    try {
      await removePlaidItem(decryptProviderToken(connection.accessTokenEncrypted));
    } catch (error) { revocationError = error instanceof Error ? error.message : "Provider revocation failed"; }
  }
  await db.transaction(async tx => {
    await tx.update(providerConnections).set({ status: "disconnected", accessTokenEncrypted: "revoked", lastError: revocationError, updatedAt: new Date() }).where(and(eq(providerConnections.id, id), eq(providerConnections.userId, user.id)));
    await tx.update(providerAccounts).set({ localAccountId: null, updatedAt: new Date() }).where(and(eq(providerAccounts.connectionId, id), eq(providerAccounts.userId, user.id)));
    for (const row of linked) if (row.localAccountId) await tx.update(accounts).set({ provider: null, providerAccountId: null, providerBalanceCents: null, providerBalanceAt: null, syncEnabled: false }).where(and(eq(accounts.id, row.localAccountId), eq(accounts.userId, user.id), eq(accounts.providerAccountId, row.providerAccountId)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "disconnect", entityType: "provider_connection", entityId: id, afterJson: JSON.stringify({ provider: connection.provider, institutionName: connection.institutionName, providerRevoked: !revocationError, revocationError }) });
  });
  return NextResponse.json({ ok: true, providerRevoked: !revocationError, warning: revocationError ? "The local connection was disconnected, but the provider could not be revoked. Check the provider dashboard." : null });
}
