import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { auditEvents, reviewItems } from "../../../lib/schema";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; all?: boolean; status?: "resolved" | "dismissed" } | null;
  if ((!body?.id && !body?.all) || !body.status) return NextResponse.json({ error: "Review id or all, and status are required" }, { status: 400 });
  if (body.all) {
    const openItems = await getDatabase().select({ id: reviewItems.id }).from(reviewItems).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open")));
    if (openItems.length) {
      await getDatabase().update(reviewItems).set({ status: body.status, resolvedAt: new Date() }).where(and(eq(reviewItems.userId, user.id), eq(reviewItems.status, "open")));
      await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: body.status, entityType: "review_batch", entityId: "all-open", afterJson: JSON.stringify({ count: openItems.length }) });
    }
    return NextResponse.json({ ok: true, count: openItems.length });
  }
  if (!body.id) return NextResponse.json({ error: "Review id is required" }, { status: 400 });
  await getDatabase().update(reviewItems).set({ status: body.status, resolvedAt: new Date() }).where(and(eq(reviewItems.id, body.id), eq(reviewItems.userId, user.id)));
  await getDatabase().insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: body.status, entityType: "review_item", entityId: body.id });
  return NextResponse.json({ ok: true });
}

