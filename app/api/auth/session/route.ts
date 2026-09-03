import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  const configured = Boolean(process.env.DATABASE_URL);
  const required = process.env.NODE_ENV === "production" || configured;
  return NextResponse.json({ configured, required, user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null });
}
