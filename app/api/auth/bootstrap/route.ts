import { count, sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSession } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { users } from "../../../../lib/schema";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12),
  displayName: z.string().trim().min(1).max(80),
});

function allowedEmails() {
  return (process.env.INITIAL_USER_EMAIL ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ available: false });
  try {
    const rows = await getDatabase().select({ total: count() }).from(users);
    // Account creation is shown whenever the database has no users. The POST
    // handler still enforces INITIAL_USER_EMAIL as the security boundary.
    return NextResponse.json({ available: Number(rows[0]?.total ?? 0) === 0 });
  } catch {
    return NextResponse.json({ available: false, error: "The database is not ready yet. Redeploy after configuring DATABASE_URL." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid account details" }, { status: 400 });
  const input = parsed.data;
  const email = input.email.toLowerCase();
  if (!allowedEmails().includes(email)) return NextResponse.json({ error: "That email is not approved for initial setup" }, { status: 403 });

  const db = getDatabase();
  const userId = randomUUID();
  const passwordHash = await hash(input.password, 12);
  try {
    await db.transaction(async (tx) => {
      // Serialize first-user creation so two simultaneous requests cannot both pass the empty check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(917233001)`);
      const existing = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing.length) throw new Error("INITIAL_USER_ALREADY_CREATED");
      await tx.insert(users).values({ id: userId, email, passwordHash, displayName: input.displayName });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INITIAL_USER_ALREADY_CREATED") return NextResponse.json({ error: "Initial user setup has already been completed" }, { status: 409 });
    throw error;
  }
  await createSession(userId);
  return NextResponse.json({ ok: true, user: { id: userId, email, displayName: input.displayName } });
}
