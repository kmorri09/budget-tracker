import { and, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDatabase } from "../../../../lib/db";
import { syncConnection } from "../../../../lib/bank-sync";
import { providerConnections } from "../../../../lib/schema";

export const runtime = "nodejs";

function authorized(request: Request) {
  const configured = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  const db = getDatabase();
  // Keep retrying connections after ordinary sync failures. Only disconnected
  // connections and those requiring user reauthentication need to be skipped.
  const connections = await db.select({ id: providerConnections.id, userId: providerConnections.userId, institutionName: providerConnections.institutionName }).from(providerConnections).where(and(inArray(providerConnections.status, ["connected", "error"]), inArray(providerConnections.provider, ["plaid", "mock"])));
  const results: Array<{ connectionId: string; institutionName: string | null; ok: boolean; added?: number; modified?: number; matched?: number; suppressed?: number; error?: string }> = [];
  for (const connection of connections) {
    try {
      const result = await syncConnection(db, connection.userId, connection.id, { onlyEnabled: true });
      results.push({ connectionId: connection.id, institutionName: connection.institutionName, ok: true, added: result.added, modified: result.modified, matched: result.matched, suppressed: result.suppressed });
    } catch (error) {
      results.push({ connectionId: connection.id, institutionName: connection.institutionName, ok: false, error: error instanceof Error ? error.message : "Sync failed" });
    }
  }
  return NextResponse.json({ ok: results.every(result => result.ok), attempted: results.length, results }, { status: results.every(result => result.ok) ? 200 : 207 });
}

// Hosting providers commonly invoke cron jobs with GET; keep POST available for
// operators that prefer an explicit method while sharing the same auth path.
export const GET = POST;
