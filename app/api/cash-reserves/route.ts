import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../../../lib/auth";
import { budgetToday } from "../../../lib/budget-date";
import { getDatabase } from "../../../lib/db";
import { loadPaymentWorkspace } from "../../../lib/payment-workspace";
import { auditEvents, cashReserveAdjustments, categories } from "../../../lib/schema";

const inputSchema = z.object({ categoryId: z.string().min(1), targetCents: z.number().int().nonnegative().max(2_147_483_647), reviewToken: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid reserve amount." }, { status: 400 });
  const input = parsed.data, date = budgetToday();
  try {
    return await getDatabase().transaction(async tx => {
      const category = (await tx.select().from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.userId, user.id), eq(categories.active, true))).limit(1))[0];
      if (!category) return NextResponse.json({ error: "Active category not found." }, { status: 404 });
      const workspace = await loadPaymentWorkspace(tx, user.id, date);
      if (workspace.paymentReviewToken !== input.reviewToken) return NextResponse.json({ error: "Your budget changed. Refresh and review the reserve again." }, { status: 409 });
      const balance = workspace.managedCategories.find(row => row.id === category.id)!;
      const currentCents = Math.round(balance.manualCashReserve * 100);
      const obligationCents = Math.round(balance.obligationReserve * 100);
      const protectedCents = Math.max(currentCents, obligationCents);
      const cardIds = new Set(workspace.accounts.filter(account => account.type === "credit_card").map(account => account.id));
      const pendingCardCents = workspace.activity.filter(row => row.categoryId === category.id && row.kind === "expense" && cardIds.has(row.accountId) && (row.pending || row.status === "pending") && row.date <= date).reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
      const freeCents = Math.max(0, Math.round((balance.available - balance.unmatchedRefunds) * 100) - pendingCardCents - protectedCents);
      const difference = input.targetCents - currentCents;
      if (input.targetCents > protectedCents + freeCents) return NextResponse.json({ error: "There is not enough free category money to protect that amount." }, { status: 400 });
      if (!difference) return NextResponse.json({ ok: true });
      const id = randomUUID();
      await tx.insert(cashReserveAdjustments).values({ id, userId: user.id, categoryId: category.id, amountCents: difference, effectiveDate: date, note: "Adjust category cash reserve" });
      await tx.insert(auditEvents).values({ id: randomUUID(), userId: user.id, action: "adjust", entityType: "cash_reserve", entityId: category.id, afterJson: JSON.stringify({ adjustmentId: id, previousCents: currentCents, targetCents: input.targetCents }) });
      return NextResponse.json({ ok: true });
    }, { isolationLevel: "serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "40001") return NextResponse.json({ error: "Your budget changed. Refresh and review the reserve again." }, { status: 409 });
    throw error;
  }
}
