import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { restoreProviderEntrySchema } from "../../../../lib/api-validation";
import { RestoreEntryError, restoreProviderEntry } from "../../../../lib/restore-provider-entry";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = restoreProviderEntrySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message ?? "Invalid restoration request" }, { status: 400 });
  try { return NextResponse.json(await restoreProviderEntry(getDatabase(), user.id, input.data.id)); }
  catch (error) {
    if (error instanceof RestoreEntryError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
