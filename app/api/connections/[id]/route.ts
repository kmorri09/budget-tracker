import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { syncConnection } from "../../../../lib/bank-sync";
import { accounts, auditEvents, providerAccounts, providerConnections } from "../../../../lib/schema";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const input = await request.json().catch(() => ({})) as { action?: string };
  if (input.action !== "sync") return NextResponse.json({ error: "Unsupported connection action" }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...(await syncConnection(getDatabase(), user.id, id)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync this connection" }, { status: 502 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDatabase();
  const connection = (await db.select().from(providerConnections).where(and(eq(providerConnections.id, id), eq(providerConnections.userId, user.id))).limit(1))[0];
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const linked = await db.select({ localAccountId: providerAccounts.localAccountId, providerAccountId: providerAccounts.providerAccountId }).from(providerAccounts).where(and(eq(providerAccounts.connectionId, id), eq(providerAccounts.userId, user.id)));
  await db.transaction(async tx => {
    await tx.update(providerConnections).set({ status: "disconnected", lastError: null, updatedAt: new Date() }).where(and(eq(providerConnections.id, id), eq(providerConnections.userId, user.id)));
    await tx.update(providerAccounts).set({ localAccountId: null, updatedAt: new Date() }).where(and(eq(providerAccounts.connectionId, id), eq(providerAccounts.userId, user.id)));
    for (const row of linked) if (row.localAccountId) await tx.update(accounts).set({ provider: null, providerAccountId: null, syncEnabled: false }).where(and(eq(accounts.id, row.localAccountId), eq(accounts.userId, user.id), eq(accounts.providerAccountId, row.providerAccountId)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "disconnect", entityType: "provider_connection", entityId: id, afterJson: JSON.stringify({ provider: connection.provider, institutionName: connection.institutionName }) });
  });
  return NextResponse.json({ ok: true });
}
