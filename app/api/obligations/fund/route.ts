import { NextResponse } from "next/server";
import { obligationFundingSchema } from "../../../../lib/api-validation";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { fundObligations } from "../../../../lib/fund-obligations-command";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = obligationFundingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid obligations" }, { status: 400 });
  return fundObligations(getDatabase(), user.id, parsed.data);
}
