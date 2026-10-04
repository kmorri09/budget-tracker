import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { dateOnlySchema } from "../../../../lib/api-validation";
import { coverCategoryOverspending, CoverOverspendingError } from "../../../../lib/cover-category-overspending";
import { getDatabase } from "../../../../lib/db";

const schema = z.object({
  categoryIds: z.array(z.string().min(1)).min(1).max(500).refine(ids => new Set(ids).size === ids.length, "Each category can only be selected once"),
  date: dateOnlySchema,
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid categories" }, { status: 400 });
  try {
    const result = await coverCategoryOverspending(getDatabase(), user.id, parsed.data.categoryIds, parsed.data.date);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CoverOverspendingError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
