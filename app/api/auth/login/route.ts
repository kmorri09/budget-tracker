import { eq } from "drizzle-orm";
import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { users } from "../../../../lib/schema";

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !body?.password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  const user = (await getDatabase().select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!user || !(await compare(body.password, user.passwordHash))) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  await createSession(user.id);
  return NextResponse.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
}

