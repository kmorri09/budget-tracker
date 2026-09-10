import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { auditEvents, categories } from "../../../lib/schema";
import { categorySchema, categoryUpdateSchema } from "../../../lib/api-validation";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ categories: await getDatabase().select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.active, true))) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = categorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid category" }, { status: 400 });
  const input = parsed.data;
  const id = randomUUID();
  await getDatabase().insert(categories).values({ id, userId: user.id, name: input.name, icon: input.icon, targetCents: Math.round(input.target * 100) });
  await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "category", entityId: id, afterJson: JSON.stringify(input) });
  return NextResponse.json({ id, ok: true });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = categoryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid category" }, { status: 400 });
  const input = parsed.data;
  const db = getDatabase();
  const existing = (await db.select().from(categories).where(and(eq(categories.id, input.id), eq(categories.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  const duplicate = (await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, user.id), eq(categories.name, input.name))).limit(1))[0];
  if (duplicate && duplicate.id !== input.id) return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
  const after = { name: input.name, icon: input.icon, targetCents: Math.round(input.target * 100), active: input.active };
  await db.transaction(async (tx) => {
    await tx.update(categories).set(after).where(and(eq(categories.id, input.id), eq(categories.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "update", entityType: "category", entityId: input.id, beforeJson: JSON.stringify({ name: existing.name, icon: existing.icon, targetCents: existing.targetCents, active: existing.active }), afterJson: JSON.stringify(after) });
  });
  return NextResponse.json({ id: input.id, ok: true });
}

