import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { obligationMatchSchema, saveObligationMatch } from "../../../../lib/obligation-match-command";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = obligationMatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid match decision" }, { status: 400 });
  return saveObligationMatch(getDatabase(), user.id, parsed.data);
}
