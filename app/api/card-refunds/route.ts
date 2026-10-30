import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { getDatabase } from "../../../lib/db";
import { refundMatchSchema, saveCardRefundMatch } from "../../../lib/card-refund-commands";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = refundMatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a purchase and a positive refund amount" }, { status: 400 });
  return saveCardRefundMatch(getDatabase(), user.id, parsed.data);
}
