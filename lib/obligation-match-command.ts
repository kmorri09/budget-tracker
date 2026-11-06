import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { budgetToday } from "./budget-date";
import type { Database } from "./db";
import { nearestScheduledDate } from "./obligation-status";
import { loadPaymentWorkspace } from "./payment-workspace";
import { auditEvents, obligationMatchDecisions } from "./schema";

export const obligationMatchSchema = z.object({
  obligationId: z.string().min(1),
  candidateType: z.enum(["transaction", "payment"]),
  candidateId: z.string().min(1),
  status: z.enum(["confirmed", "dismissed"]),
});

export async function saveObligationMatch(db: Pick<Database, "transaction">, userId: string, input: z.infer<typeof obligationMatchSchema>) {
  try {
    return await db.transaction(async tx => {
      const today = budgetToday();
      const workspace = await loadPaymentWorkspace(tx, userId, today);
      const obligation = workspace.obligationRows.find(row => row.id === input.obligationId);
      if (!obligation) return NextResponse.json({ error: "Obligation not found" }, { status: 404 });
      const candidate = workspace.obligationCandidates.find(row => row.id === input.candidateId && row.type === input.candidateType);
      if (!candidate || candidate.effectiveDate > today) return NextResponse.json({ error: "Choose a posted withdrawal or recorded payment that has already occurred." }, { status: 400 });

      const decisions = workspace.matchDecisionRows.filter(row => row.candidateId === input.candidateId && row.candidateType === input.candidateType);
      if (input.status === "confirmed") {
        if (decisions.some(row => row.status === "confirmed" && row.obligationId !== obligation.id)) return NextResponse.json({ error: "This charge is already confirmed for another obligation." }, { status: 409 });
        const cycle = nearestScheduledDate(obligation, candidate.effectiveDate);
        const hasConfirmedMatch = workspace.obligationPlans.get(obligation.id)?.history.some(row => row.confidence === "confirmed"
          && (row.id !== candidate.id || row.type !== candidate.type) && nearestScheduledDate(obligation, row.effectiveDate) === cycle);
        if (hasConfirmedMatch) return NextResponse.json({ error: "Unmatch the confirmed charge for this billing cycle before choosing another." }, { status: 409 });
      }
      if (decisions.some(row => row.obligationId === obligation.id && row.status === input.status)) return NextResponse.json({ ok: true });

      await tx.insert(obligationMatchDecisions).values({ id: randomUUID(), userId, ...input }).onConflictDoUpdate({
        target: [obligationMatchDecisions.obligationId, obligationMatchDecisions.candidateType, obligationMatchDecisions.candidateId],
        set: { status: input.status },
      });
      await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: input.status, entityType: "obligation_match", entityId: obligation.id, afterJson: JSON.stringify(input) });
      return NextResponse.json({ ok: true });
    }, { isolationLevel: "serializable" });
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if (failure.code === "40001" || failure.cause?.code === "40001") return NextResponse.json({ error: "A match changed while saving. Refresh and try again." }, { status: 409 });
    throw error;
  }
}
