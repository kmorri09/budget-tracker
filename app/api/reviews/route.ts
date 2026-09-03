import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { auditEvents, reviewItems } from "../../../lib/schema";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; status?: "resolved" | "dismissed" } | null;
  if (!body?.id || !body.status) return NextResponse.json({ error: "Review id and status are required" }, { status: 400 });
  await getDatabase().update(reviewItems).set({ status: body.status, resolvedAt: new Date() }).where(and(eq(reviewItems.id, body.id), eq(reviewItems.userId, user.id)));
  await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: body.status, entityType: "review_item", entityId: body.id });
  return NextResponse.json({ ok: true });
}

