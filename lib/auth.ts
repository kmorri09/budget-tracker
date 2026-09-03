import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { sessions, users } from "./schema";

export const sessionCookieName = "budget_session";

export async function getCurrentUser() {
  if (!process.env.DATABASE_URL) return null;
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName)?.value;
  if (!sessionId) return null;
  const db = getDatabase();
  const result = await db.select({ user: users, session: sessions }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return result[0]?.user ?? null;
}

export async function createSession(userId: string) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await getDatabase().insert(sessions).values({ id, userId, expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName)?.value;
  if (sessionId && process.env.DATABASE_URL) await getDatabase().delete(sessions).where(eq(sessions.id, sessionId));
  cookieStore.delete(sessionCookieName);
}

