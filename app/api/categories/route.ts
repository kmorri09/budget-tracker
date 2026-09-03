import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { auditEvents, categories } from "../../../lib/schema";

const schema = z.object({ name: z.string().trim().min(1).max(80), icon: z.string().max(4).default("$"), target: z.coerce.number().finite().nonnegative().default(0) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ categories: await getDatabase().select().from(categories).where(and(eq(categories.userId, user.id), eq(categories.active, true))) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid category" }, { status: 400 });
  const input = parsed.data;
  const id = randomUUID();
  await getDatabase().insert(categories).values({ id, userId: user.id, name: input.name, icon: input.icon, targetCents: Math.round(input.target * 100) });
  await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "category", entityId: id, afterJson: JSON.stringify(input) });
  return NextResponse.json({ id, ok: true });
}

