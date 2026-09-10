import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, auditEvents, categories, obligations } from "../../../lib/schema";
import { idSchema, obligationSchema, obligationUpdateSchema } from "../../../lib/api-validation";

async function validateReferences(userId: string, accountId: string, categoryId: string) {
  const db = getDatabase();
  const [account, category] = await Promise.all([
    db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId))).limit(1),
    db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, categoryId), eq(categories.userId, userId))).limit(1),
  ]);
  if (!account.length) return "Account not found";
  if (!category.length) return "Category not found";
  return null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = obligationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid obligation" }, { status: 400 });
  const input = parsed.data;
  const referenceError = await validateReferences(user.id, input.accountId, input.categoryId);
  if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });
  const id = randomUUID();
  const values = { id, userId: user.id, accountId: input.accountId, categoryId: input.categoryId, name: input.name, amountCents: Math.round(input.amount * 100), dueDate: input.dueDate, cadence: input.cadence, active: input.active };
  const db = getDatabase();
  await db.transaction(async tx => {
    await tx.insert(obligations).values(values);
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "obligation", entityId: id, afterJson: JSON.stringify(values) });
  });
  return NextResponse.json({ id, ok: true });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = obligationUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid obligation" }, { status: 400 });
  const input = parsed.data;
  const db = getDatabase();
  const existing = (await db.select().from(obligations).where(and(eq(obligations.id, input.id), eq(obligations.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
  const referenceError = await validateReferences(user.id, input.accountId, input.categoryId);
  if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });
  const changes = { accountId: input.accountId, categoryId: input.categoryId, name: input.name, amountCents: Math.round(input.amount * 100), dueDate: input.dueDate, cadence: input.cadence, active: input.active };
  await db.transaction(async tx => {
    await tx.update(obligations).set(changes).where(and(eq(obligations.id, input.id), eq(obligations.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "update", entityType: "obligation", entityId: input.id, beforeJson: JSON.stringify(existing), afterJson: JSON.stringify(changes) });
  });
  return NextResponse.json({ id: input.id, ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = idSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Obligation id is required" }, { status: 400 });
  const db = getDatabase();
  const existing = (await db.select().from(obligations).where(and(eq(obligations.id, parsed.data.id), eq(obligations.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
  await db.transaction(async tx => {
    await tx.delete(obligations).where(and(eq(obligations.id, existing.id), eq(obligations.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "delete", entityType: "obligation", entityId: existing.id, beforeJson: JSON.stringify(existing) });
  });
  return NextResponse.json({ id: existing.id, ok: true });
}
