import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, auditEvents, transactions } from "../../../lib/schema";
import { accountCreateSchema } from "../../../lib/api-validation";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await getDatabase().select().from(accounts).where(eq(accounts.userId, user.id));
  return NextResponse.json({ accounts: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = accountCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid account" }, { status: 400 });
  const input = parsed.data;
  const id = randomUUID();
  const db = getDatabase();
  const existingCash = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, user.id), eq(accounts.active, true), ne(accounts.type, "credit_card"))).limit(1);
  const isDefaultCash = input.type !== "credit_card" && existingCash.length === 0;
  await db.insert(accounts).values({ id, userId: user.id, name: input.name, institution: input.institution, type: input.type, openingBalanceCents: Math.round(input.openingBalance * 100), syncEnabled: input.syncEnabled, isDefaultCash, active: true });
  await db.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "account", entityId: id, afterJson: JSON.stringify({ ...input, isDefaultCash }) });
  return NextResponse.json({ id, ok: true });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; name?: string; institution?: string; type?: string; active?: boolean; syncEnabled?: boolean; isDefaultCash?: boolean; provider?: string | null; providerAccountId?: string | null; openingBalance?: number | string; providerBalance?: number | string } | null;
  if (!body?.id) return NextResponse.json({ error: "Account id is required" }, { status: 400 });
  const openingBalance = body.openingBalance === undefined ? undefined : Number(body.openingBalance);
  if (openingBalance !== undefined && !Number.isFinite(openingBalance)) return NextResponse.json({ error: "Opening balance must be a number" }, { status: 400 });
  const providerBalance = body.providerBalance === undefined ? undefined : Number(body.providerBalance);
  if (providerBalance !== undefined && !Number.isFinite(providerBalance)) return NextResponse.json({ error: "Provider balance must be a number" }, { status: 400 });
  const db = getDatabase();
  const account = (await db.select().from(accounts).where(and(eq(accounts.id, body.id), eq(accounts.userId, user.id))).limit(1))[0];
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (body.name !== undefined && (!body.name.trim() || body.name.trim().length > 80)) return NextResponse.json({ error: "Account name must be 1–80 characters" }, { status: 400 });
  if (body.institution !== undefined && (!body.institution.trim() || body.institution.trim().length > 80)) return NextResponse.json({ error: "Bank or provider must be 1–80 characters" }, { status: 400 });
  if (body.type !== undefined && !["checking", "savings", "credit_card"].includes(body.type)) return NextResponse.json({ error: "Invalid account type" }, { status: 400 });
  if (body.isDefaultCash !== undefined && typeof body.isDefaultCash !== "boolean") return NextResponse.json({ error: "Default cash setting must be a boolean" }, { status: 400 });
  if (body.isDefaultCash === true && (body.type ?? account.type) === "credit_card") return NextResponse.json({ error: "Only checking or savings accounts can be the default income account" }, { status: 400 });
  let reconciliationDelta: number | undefined;
  let normalizedProviderBalance: number | undefined;
  if (providerBalance !== undefined) {
    normalizedProviderBalance = account.type === "credit_card" ? -Math.abs(Math.round(providerBalance * 100)) : Math.round(providerBalance * 100);
    const activity = await db.select({ kind: transactions.kind, amountCents: transactions.amountCents, status: transactions.status }).from(transactions).where(and(eq(transactions.accountId, account.id), eq(transactions.userId, user.id)));
    const signedCash = activity.filter(transaction => transaction.status !== "removed").reduce((sum, transaction) => {
      if (transaction.kind === "income" || transaction.kind === "refund" || transaction.kind === "transfer_in") return sum + transaction.amountCents;
      if (transaction.kind === "adjustment") return sum + transaction.amountCents;
      return sum - transaction.amountCents;
    }, 0);
    const currentLedger = account.openingBalanceCents + signedCash;
    reconciliationDelta = normalizedProviderBalance - currentLedger;
  }
  const changes = { ...(body.name === undefined ? {} : { name: body.name.trim() }), ...(body.institution === undefined ? {} : { institution: body.institution.trim() }), ...(body.type === undefined ? {} : { type: body.type }), ...(body.type === "credit_card" ? { isDefaultCash: false } : body.isDefaultCash === undefined ? {} : { isDefaultCash: body.isDefaultCash }), ...(body.active === undefined ? {} : { active: body.active }), ...(body.syncEnabled === undefined ? {} : { syncEnabled: body.syncEnabled }), ...(body.provider === undefined ? {} : { provider: body.provider }), ...(body.providerAccountId === undefined ? {} : { providerAccountId: body.providerAccountId }), ...(openingBalance === undefined ? {} : { openingBalanceCents: Math.round(openingBalance * 100) }), ...(providerBalance === undefined ? {} : { providerBalanceCents: normalizedProviderBalance, providerBalanceAt: new Date() }) };
  await db.transaction(async (tx) => {
    if (body.isDefaultCash === true) await tx.update(accounts).set({ isDefaultCash: false }).where(and(eq(accounts.userId, user.id), ne(accounts.id, body.id!), eq(accounts.isDefaultCash, true)));
    await tx.update(accounts).set(changes).where(and(eq(accounts.id, body.id!), eq(accounts.userId, user.id)));
  });
  if (providerBalance !== undefined && reconciliationDelta !== undefined && Math.abs(reconciliationDelta) >= 1) {
    const adjustmentId = randomUUID();
    await db.insert(transactions).values({ id: adjustmentId, userId: user.id, accountId: account.id, categoryId: null, kind: "adjustment", amountCents: reconciliationDelta, effectiveDate: new Date().toISOString().slice(0, 10), description: "Force reconciliation adjustment", status: "posted", source: "reconciliation", pending: false });
    await db.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "reconcile", entityType: "account", entityId: body.id, afterJson: JSON.stringify({ providerBalance, delta: reconciliationDelta / 100, adjustmentId }) });
  }
  if (openingBalance !== undefined || body.name !== undefined || body.institution !== undefined || body.type !== undefined || body.active !== undefined || body.syncEnabled !== undefined || body.isDefaultCash !== undefined) await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "update", entityType: "account", entityId: body.id, afterJson: JSON.stringify({ name: body.name, institution: body.institution, type: body.type, active: body.active, syncEnabled: body.syncEnabled, isDefaultCash: body.isDefaultCash, openingBalance }) });
  return NextResponse.json({ ok: true, delta: reconciliationDelta === undefined ? null : reconciliationDelta / 100 });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ error: "Account id is required" }, { status: 400 });
  const db = getDatabase();
  const account = (await db.select().from(accounts).where(and(eq(accounts.id, body.id), eq(accounts.userId, user.id))).limit(1))[0];
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (!account.active) return NextResponse.json({ ok: true });
  // Preserve ledger history and audit references. Removing an active account means archiving it from the workspace.
  await db.update(accounts).set({ active: false, isDefaultCash: false }).where(and(eq(accounts.id, body.id), eq(accounts.userId, user.id)));
  await db.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "archive", entityType: "account", entityId: body.id, beforeJson: JSON.stringify({ name: account.name, institution: account.institution, type: account.type, isDefaultCash: account.isDefaultCash }), afterJson: JSON.stringify({ active: false, isDefaultCash: false }) });
  return NextResponse.json({ ok: true, archived: true });
}

