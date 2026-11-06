import { NextResponse } from "next/server";
import { z } from "zod";
import { dateOnlySchema } from "../../../../lib/api-validation";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { paycheckSchedules } from "../../../../lib/schema";

const inputSchema = z.object({ anchorDate: dateOnlySchema, amountCents: z.number().int().positive().max(2_147_483_647) });

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid paycheck date and amount." }, { status: 400 });
  await getDatabase().insert(paycheckSchedules).values({ userId: user.id, ...parsed.data }).onConflictDoUpdate({ target: paycheckSchedules.userId, set: parsed.data });
  return NextResponse.json({ ok: true });
}
