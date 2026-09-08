import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accountType, createPlaidLinkToken, encryptProviderToken, exchangePlaidPublicToken, hasPlaidCredentials, hasProviderEncryptionKey, mockProviderAccounts } from "../../../lib/bank-sync";
import { auditEvents, providerAccounts, providerConnections, syncRuns } from "../../../lib/schema";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDatabase();
  const connections = await db.select().from(providerConnections).where(eq(providerConnections.userId, user.id)).orderBy(desc(providerConnections.createdAt));
  const connectionIds = connections.map(connection => connection.id);
  const grouped = new Map<string, Array<typeof providerAccounts.$inferSelect>>();
  for (const connection of connections) grouped.set(connection.id, await db.select().from(providerAccounts).where(and(eq(providerAccounts.userId, user.id), eq(providerAccounts.connectionId, connection.id))));
  const runs = connectionIds.length ? await db.select().from(syncRuns).where(eq(syncRuns.userId, user.id)).orderBy(desc(syncRuns.startedAt)).limit(25) : [];
  return NextResponse.json({ configured: hasPlaidCredentials(), connections: connections.map(connection => ({ id: connection.id, provider: connection.provider, institutionName: connection.institutionName, status: connection.status, lastSyncAt: connection.lastSyncAt, lastError: connection.lastError, accounts: (grouped.get(connection.id) ?? []).map(row => ({ id: row.id, providerAccountId: row.providerAccountId, name: row.name, officialName: row.officialName, mask: row.mask, type: row.type, subtype: row.subtype, localAccountId: row.localAccountId, currentBalance: row.currentBalanceCents === null ? null : Number(row.currentBalanceCents) / 100, availableBalance: row.availableBalanceCents === null ? null : Number(row.availableBalanceCents) / 100, balanceAt: row.balanceAt })) })), recentRuns: runs.map(run => ({ id: run.id, connectionId: run.connectionId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, added: run.addedCount, modified: run.modifiedCount, removed: run.removedCount, error: run.error })) });
}

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link-token") }),
  z.object({ action: z.literal("mock") }),
  z.object({ action: z.literal("exchange"), publicToken: z.string().min(1), institutionName: z.string().trim().max(120).optional() }),
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid connection request" }, { status: 400 });
  const input = parsed.data;
  if (input.action === "link-token") {
    if (!hasPlaidCredentials()) return NextResponse.json({ configured: false, mode: "demo", message: "Plaid credentials are not configured" });
    if (!hasProviderEncryptionKey()) return NextResponse.json({ error: "Set PLAID_TOKEN_ENCRYPTION_KEY before connecting a live bank" }, { status: 503 });
    try { return NextResponse.json({ configured: true, mode: "plaid", ...(await createPlaidLinkToken(user.id)) }); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start bank connection" }, { status: 502 }); }
  }
  const db = getDatabase();
  let provider = "mock"; let itemId = `mock-item-${user.id}`; let institutionName = "Demo Bank"; let accessToken = "mock"; let remoteAccounts = mockProviderAccounts();
  if (input.action === "exchange") {
    if (!hasProviderEncryptionKey()) return NextResponse.json({ error: "Set PLAID_TOKEN_ENCRYPTION_KEY before connecting a live bank" }, { status: 503 });
    try {
      const result = await exchangePlaidPublicToken(input.publicToken);
      provider = "plaid"; itemId = result.item_id; accessToken = result.access_token; institutionName = input.institutionName?.trim() || "Connected institution"; remoteAccounts = result.accounts;
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not finish bank connection" }, { status: 502 }); }
  }
  const duplicate = (await db.select({ id: providerConnections.id }).from(providerConnections).where(and(eq(providerConnections.userId, user.id), eq(providerConnections.provider, provider), eq(providerConnections.itemId, itemId))).limit(1))[0];
  if (duplicate) return NextResponse.json({ error: "This institution is already connected" }, { status: 409 });
  const connectionId = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(providerConnections).values({ id: connectionId, userId: user.id, provider, itemId, institutionName, accessTokenEncrypted: encryptProviderToken(accessToken), status: "connected" });
    for (const remote of remoteAccounts) {
      await tx.insert(providerAccounts).values({ id: randomUUID(), userId: user.id, connectionId, providerAccountId: remote.account_id, name: remote.name, officialName: remote.official_name ?? null, mask: remote.mask ?? null, type: accountType(remote), subtype: remote.subtype ?? null, currentBalanceCents: remote.balances.current == null ? null : Math.round(remote.balances.current * 100), availableBalanceCents: remote.balances.available == null ? null : Math.round(remote.balances.available * 100), balanceAt: new Date() });
    }
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "connect", entityType: "provider_connection", entityId: connectionId, afterJson: JSON.stringify({ provider, institutionName, accountCount: remoteAccounts.length }) });
  });
  return NextResponse.json({ ok: true, connectionId, provider, institutionName, accountCount: remoteAccounts.length, configured: hasPlaidCredentials() });
}
