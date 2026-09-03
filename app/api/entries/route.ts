import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, allocations, auditEvents, categories, transactions } from "../../../lib/schema";

const entrySchema = z.object({
  kind: z.enum(["transaction", "income", "allocation", "transfer", "payment"]),
  amount: z.coerce.number().positive().finite(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.string().min(1),
  categoryId: z.string().optional().nullable(),
  fromCategoryId: z.string().optional().nullable(),
  toCategoryId: z.string().optional().nullable(),
  description: z.string().trim().min(1).max(200),
});

const cents = (amount: number) => Math.round(amount * 100);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = entrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 400 });
  const input = parsed.data;
  const amountCents = cents(input.amount);
  const db = getDatabase();
  const account = (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, user.id), or(eq(accounts.id, input.accountId), eq(accounts.name, input.accountId)))).limit(1))[0];
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 400 });

  if (input.kind === "allocation") {
    if (!input.categoryId) return NextResponse.json({ error: "Category is required" }, { status: 400 });
    const category = (await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, user.id), or(eq(categories.id, input.categoryId), eq(categories.name, input.categoryId)))).limit(1))[0];
    if (!category) return NextResponse.json({ error: "Category not found" }, { status: 400 });
    const id = randomUUID();
    await db.insert(allocations).values({ id, userId: user.id, categoryId: category.id, amountCents, effectiveDate: input.date, note: input.description });
    await db.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "allocation", entityId: id, afterJson: JSON.stringify(input) });
    return NextResponse.json({ id, ok: true });
  }

  if (input.kind === "transfer") {
    if (!input.fromCategoryId || !input.toCategoryId || input.fromCategoryId === input.toCategoryId) return NextResponse.json({ error: "Choose two different categories" }, { status: 400 });
    const owned = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, user.id), or(eq(categories.id, input.fromCategoryId), eq(categories.name, input.fromCategoryId))));
    const target = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, user.id), or(eq(categories.id, input.toCategoryId), eq(categories.name, input.toCategoryId))));
    if (!owned.length || !target.length) return NextResponse.json({ error: "Category not found" }, { status: 400 });
    const fromId = randomUUID();
    const toId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(allocations).values([
        { id: fromId, userId: user.id, categoryId: owned[0].id, amountCents: -amountCents, effectiveDate: input.date, note: input.description },
        { id: toId, userId: user.id, categoryId: target[0].id, amountCents, effectiveDate: input.date, note: input.description },
      ]);
      await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "category_transfer", entityId: fromId, afterJson: JSON.stringify(input) });
    });
    return NextResponse.json({ id: fromId, ok: true });
  }

  const transactionKind = input.kind === "income" ? "income" : input.kind === "payment" ? "card_payment" : "expense";
  if (transactionKind === "expense" && !input.categoryId) return NextResponse.json({ error: "Category is required" }, { status: 400 });
  let resolvedCategoryId: string | null = null;
  if (input.categoryId) {
    const category = (await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, user.id), or(eq(categories.id, input.categoryId), eq(categories.name, input.categoryId)))).limit(1))[0];
    if (!category) return NextResponse.json({ error: "Category not found" }, { status: 400 });
    resolvedCategoryId = category.id;
  }
  const id = randomUUID();
  await db.insert(transactions).values({ id, userId: user.id, accountId: account.id, categoryId: resolvedCategoryId, kind: transactionKind, amountCents, effectiveDate: input.date, description: input.description, status: "posted", source: "manual", pending: false });
  await db.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "transaction", entityId: id, afterJson: JSON.stringify(input) });
  return NextResponse.json({ id, ok: true });
}
