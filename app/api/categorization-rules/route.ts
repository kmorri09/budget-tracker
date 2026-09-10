import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { idSchema } from "../../../lib/api-validation";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { auditEvents, categorizationRules } from "../../../lib/schema";

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = idSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Rule id is required" }, { status: 400 });
  const db = getDatabase();
  const existing = (await db.select().from(categorizationRules).where(and(eq(categorizationRules.id, parsed.data.id), eq(categorizationRules.userId, user.id))).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "Categorization rule not found" }, { status: 404 });
  await db.transaction(async tx => {
    await tx.delete(categorizationRules).where(and(eq(categorizationRules.id, existing.id), eq(categorizationRules.userId, user.id)));
    await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "delete", entityType: "categorization_rule", entityId: existing.id, beforeJson: JSON.stringify(existing) });
  });
  return NextResponse.json({ id: existing.id, ok: true });
}
