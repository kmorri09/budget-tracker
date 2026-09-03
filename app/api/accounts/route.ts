import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { accounts, auditEvents } from "../../../lib/schema";

const schema = z.object({ name: z.string().trim().min(1).max(80), institution: z.string().trim().min(1).max(80), type: z.enum(["checking", "savings", "credit_card"]), openingBalance: z.coerce.number().finite().default(0), syncEnabled: z.boolean().default(false) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await getDatabase().select().from(accounts).where(eq(accounts.userId, user.id));
  return NextResponse.json({ accounts: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid account" }, { status: 400 });
  const input = parsed.data;
  const id = randomUUID();
  await getDatabase().insert(accounts).values({ id, userId: user.id, name: input.name, institution: input.institution, type: input.type, openingBalanceCents: Math.round(input.openingBalance * 100), syncEnabled: input.syncEnabled });
  await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "create", entityType: "account", entityId: id, afterJson: JSON.stringify(input) });
  return NextResponse.json({ id, ok: true });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; syncEnabled?: boolean; provider?: string | null; providerAccountId?: string | null } | null;
  if (!body?.id) return NextResponse.json({ error: "Account id is required" }, { status: 400 });
  await getDatabase().update(accounts).set({ syncEnabled: body.syncEnabled, provider: body.provider, providerAccountId: body.providerAccountId }).where(and(eq(accounts.id, body.id), eq(accounts.userId, user.id)));
  return NextResponse.json({ ok: true });
}

