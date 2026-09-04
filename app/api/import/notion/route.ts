import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db";
import { accounts, allocations, auditEvents, categories, obligations, reviewItems, transactions } from "../../../../lib/schema";
import { displayRelation, parseDate, parseMoney, readNotionExport, stableId, type NotionExport, type NotionImportRow } from "../../../../lib/notion-import";

export const runtime = "nodejs";

const cutoffSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clean = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isSteph = (value: string) => /\bsteph(?:anie)?\b/i.test(value);
const chunk = <T,>(values: T[], size = 300) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, i * size + size));

type Plan = ReturnType<typeof makePlan>;

export function makePlan(data: NotionExport, cutoff: string) {
  const cutoffTime = new Date(`${cutoff}T00:00:00Z`).getTime();
  const sixMonthsAgo = new Date(`${cutoff}T00:00:00Z`);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
  const sixMonthTime = sixMonthsAgo.getTime();

  const allocationCategoryNames = new Set<string>();
  for (const row of data.allocations) {
    const date = parseDate(row.Date);
    const time = date ? new Date(`${date}T00:00:00Z`).getTime() : NaN;
    const name = displayRelation(row["To Category"]);
    if (name && !isSteph(name) && time >= sixMonthTime) allocationCategoryNames.add(clean(name));
  }
  const categoryNames = new Map<string, string>();
  for (const row of data.categories) {
    const name = displayRelation(row.Category);
    if (name && !isSteph(name) && allocationCategoryNames.has(clean(name))) categoryNames.set(clean(name), name);
  }
  for (const row of data.allocations) {
    const name = displayRelation(row["To Category"]);
    if (name && !isSteph(name) && allocationCategoryNames.has(clean(name))) categoryNames.set(clean(name), name);
  }

  const accountNames = new Map<string, string>();
  for (const row of data.accounts) {
    const name = displayRelation(row.Card);
    if (name && !isSteph(name)) accountNames.set(clean(name), name);
  }
  for (const row of data.transactions) {
    const name = displayRelation(row["Payment Method"]);
    if (name && !isSteph(name)) accountNames.set(clean(name), name);
  }
  const firstChecking = [...accountNames.values()].find((name) => /checking|savings|bank|cash/i.test(name)) ?? [...accountNames.values()][0] ?? "Imported checking (review)";
  accountNames.set(clean(firstChecking), firstChecking);

  const accountsPlan = [...accountNames.values()].map((name) => ({
    name,
    institution: /checking|savings|bank|cash/i.test(name) ? "Notion import" : "Notion import · credit card",
    type: /checking/i.test(name) ? "checking" : /savings/i.test(name) ? "savings" : "credit_card",
  }));
  const categoriesPlan = [...categoryNames.values()].map((name) => ({ name }));
  const warnings: string[] = [];
  const skipped = { transactions: 0, income: 0, allocations: 0, obligations: 0, steph: 0, invalidDate: 0, invalidAmount: 0, unknownCategory: 0 };
  const transactionsPlan: Array<{ row: NotionImportRow; date: string; amountCents: number; accountName: string; categoryName: string | null; kind: string; review: boolean; index: number }> = [];
  data.transactions.forEach((row, index) => {
    const assigned = displayRelation(row["Assigned To"]);
    const accountName = displayRelation(row["Payment Method"]);
    if (isSteph(`${assigned} ${accountName} ${displayRelation(row.Category)}`)) { skipped.steph += 1; return; }
    const date = parseDate(row.Date);
    if (!date || new Date(`${date}T00:00:00Z`).getTime() < cutoffTime) { skipped[date ? "transactions" : "invalidDate"] += 1; return; }
    const parsed = parseMoney(row.Amount);
    if (parsed === null) { skipped.invalidAmount += 1; return; }
    const categoryName = displayRelation(row.Category) || null;
    if (categoryName && !categoryNames.has(clean(categoryName))) skipped.unknownCategory += 1;
    const description = row.Description || "Imported transaction";
    const review = Boolean(row["Partial Payment Of"] || row["Partial Payment"] || (!categoryName && /payment|autopay|payoff/i.test(description)));
    transactionsPlan.push({ row, date, amountCents: Math.abs(parsed), accountName: accountName || firstChecking, categoryName: categoryName && categoryNames.has(clean(categoryName)) ? categoryNames.get(clean(categoryName))! : null, kind: review ? "card_payment" : "expense", review, index });
  });

  const incomePlan: Array<{ row: NotionImportRow; date: string; amountCents: number; index: number }> = [];
  data.income.forEach((row, index) => {
    if (isSteph(displayRelation(row["Who?"]))) { skipped.steph += 1; return; }
    const date = parseDate(row.Date);
    if (!date || new Date(`${date}T00:00:00Z`).getTime() < cutoffTime) { skipped[date ? "income" : "invalidDate"] += 1; return; }
    const amountCents = parseMoney(row.Income);
    if (amountCents === null) { skipped.invalidAmount += 1; return; }
    incomePlan.push({ row, date, amountCents: Math.abs(amountCents), index });
  });

  const allocationsPlan: Array<{ row: NotionImportRow; date: string; amountCents: number; categoryName: string; index: number }> = [];
  data.allocations.forEach((row, index) => {
    const categoryName = displayRelation(row["To Category"]);
    const date = parseDate(row.Date);
    if (isSteph(categoryName)) { skipped.steph += 1; return; }
    if (!date || new Date(`${date}T00:00:00Z`).getTime() < cutoffTime) { skipped[date ? "allocations" : "invalidDate"] += 1; return; }
    const amountCents = parseMoney(row.Allocated);
    if (amountCents === null || !categoryName) { skipped.invalidAmount += 1; return; }
    if (!categoryNames.has(clean(categoryName))) { skipped.unknownCategory += 1; return; }
    allocationsPlan.push({ row, date, amountCents, categoryName: categoryNames.get(clean(categoryName))!, index });
  });

  const obligationsPlan: Array<{ row: NotionImportRow; dueDate: string; amountCents: number; categoryName: string; index: number }> = [];
  data.obligations.forEach((row, index) => {
    const categoryName = displayRelation(row.Category);
    const dueDate = parseDate(row["Next Due Date"] || row["First Due Date"]);
    const amountCents = parseMoney(row.Amount);
    if (isSteph(`${categoryName} ${row.Name}`)) { skipped.steph += 1; return; }
    if (!dueDate || new Date(`${dueDate}T00:00:00Z`).getTime() < cutoffTime) { skipped[dueDate ? "obligations" : "invalidDate"] += 1; return; }
    if (amountCents === null || !categoryName || !categoryNames.has(clean(categoryName))) { skipped.invalidAmount += 1; return; }
    obligationsPlan.push({ row, dueDate, amountCents: Math.abs(amountCents), categoryName: categoryNames.get(clean(categoryName))!, index });
  });

  if (!accountsPlan.length) warnings.push("No non-Steph accounts were found; a review account will be created.");
  warnings.push("Notion does not provide a reliable opening ledger balance in this export. Review each imported account's opening balance before relying on the ledger total.");
  if (skipped.unknownCategory) warnings.push(`${skipped.unknownCategory} rows reference categories that were not retained and will be imported without a category.`);
  if (skipped.steph) warnings.push(`${skipped.steph} Steph-owned/account rows were excluded.`);
  return { cutoff, accountsPlan, categoriesPlan, transactionsPlan, incomePlan, allocationsPlan, obligationsPlan, warnings, skipped };
}

async function insertChunks<T>(insert: (values: T[]) => Promise<unknown>, values: T[]) {
  for (const batch of chunk(values)) if (batch.length) await insert(batch);
}

async function applyPlan(userId: string, plan: Plan) {
  const db = getDatabase();
  const result = { accounts: 0, categories: 0, transactions: 0, income: 0, allocations: 0, obligations: 0, reviews: 0 };
  await db.transaction(async (tx) => {
    const existingAccounts = await tx.select().from(accounts).where(eq(accounts.userId, userId));
    const accountIds = new Map(existingAccounts.map((row) => [clean(row.name), row.id]));
    for (const account of plan.accountsPlan) {
      if (accountIds.has(clean(account.name))) continue;
      const id = stableId("notion-account", userId, account.name);
      await tx.insert(accounts).values({ id, userId, name: account.name, institution: account.institution, type: account.type, openingBalanceCents: 0, syncEnabled: false }).onConflictDoNothing();
      accountIds.set(clean(account.name), id); result.accounts += 1;
    }
    const categoryRows = await tx.select().from(categories).where(eq(categories.userId, userId));
    const categoryIds = new Map(categoryRows.map((row) => [clean(row.name), row.id]));
    for (const category of plan.categoriesPlan) {
      if (categoryIds.has(clean(category.name))) continue;
      const id = stableId("notion-category", userId, category.name);
      await tx.insert(categories).values({ id, userId, name: category.name, icon: "$", targetCents: 0, active: true }).onConflictDoNothing();
      categoryIds.set(clean(category.name), id); result.categories += 1;
    }
    const fallbackAccountId = accountIds.get(clean(plan.accountsPlan[0]?.name ?? "")) ?? [...accountIds.values()][0];
    if (!fallbackAccountId) throw new Error("No account could be created from the export.");

    const transactionValues = plan.transactionsPlan.map((item) => {
      const id = stableId("notion-transaction", userId, String(item.index), item.date, item.row.Description ?? "", item.row.Amount ?? "");
      const accountId = accountIds.get(clean(item.accountName)) ?? fallbackAccountId;
      const categoryId = item.categoryName ? categoryIds.get(clean(item.categoryName)) ?? null : null;
      return { id, userId, accountId, categoryId, kind: item.kind, amountCents: item.amountCents, effectiveDate: item.date, description: item.row.Description || "Imported transaction", status: "posted", source: "notion_import", providerTransactionId: `notion:${id}`, pending: /yes|true/i.test(item.row["Bank Pending?"] ?? "") };
    });
    await insertChunks((values) => tx.insert(transactions).values(values).onConflictDoNothing(), transactionValues);
    result.transactions += transactionValues.length;
    const incomeValues = plan.incomePlan.map((item) => {
      const id = stableId("notion-income", userId, String(item.index), item.date, item.row.Name ?? "", item.row.Income ?? "");
      return { id, userId, accountId: fallbackAccountId, categoryId: null, kind: "income", amountCents: item.amountCents, effectiveDate: item.date, description: item.row.Name || "Imported income", status: "posted", source: "notion_import", providerTransactionId: `notion:${id}`, pending: false };
    });
    await insertChunks((values) => tx.insert(transactions).values(values).onConflictDoNothing(), incomeValues);
    result.income += incomeValues.length;
    const allocationValues = plan.allocationsPlan.map((item) => ({ id: stableId("notion-allocation", userId, String(item.index), item.date, item.row["Allocation Name (Optional)"] ?? "", item.row.Allocated ?? ""), userId, categoryId: categoryIds.get(clean(item.categoryName))!, amountCents: item.amountCents, effectiveDate: item.date, note: item.row["Allocation Name (Optional)"] || null }));
    await insertChunks((values) => tx.insert(allocations).values(values).onConflictDoNothing(), allocationValues);
    result.allocations += allocationValues.length;
    const obligationValues = plan.obligationsPlan.map((item) => ({ id: stableId("notion-obligation", userId, String(item.index), item.dueDate, item.row.Name ?? ""), userId, accountId: fallbackAccountId, categoryId: categoryIds.get(clean(item.categoryName))!, name: item.row.Name || "Imported obligation", amountCents: item.amountCents, dueDate: item.dueDate, cadence: item.row.Frequency || null, active: true }));
    await insertChunks((values) => tx.insert(obligations).values(values).onConflictDoNothing(), obligationValues);
    result.obligations += obligationValues.length;
    const reviewValues = plan.transactionsPlan.filter((item) => item.review).map((item) => {
      const transactionId = stableId("notion-transaction", userId, String(item.index), item.date, item.row.Description ?? "", item.row.Amount ?? "");
      return { id: stableId("notion-review", userId, transactionId), userId, transactionId, kind: "card_payment", title: `Review imported payment: ${item.row.Description || "Imported payment"}`, details: "Decide whether this is new spending or a payment of already-budgeted expenses.", status: "open" };
    });
    await insertChunks((values) => tx.insert(reviewItems).values(values).onConflictDoNothing(), reviewValues);
    result.reviews += reviewValues.length;
    await tx.insert(auditEvents).values({ id: randomUUID(), userId, action: "notion_import", entityType: "import_batch", entityId: stableId("notion-import", userId, plan.cutoff), afterJson: JSON.stringify({ cutoff: plan.cutoff, ...result }) });
  });
  return result;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const cutoffResult = cutoffSchema.safeParse(form.get("cutoffDate"));
  const apply = form.get("apply") === "true";
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".zip")) return NextResponse.json({ error: "Upload the Notion ZIP export." }, { status: 400 });
  if (!cutoffResult.success) return NextResponse.json({ error: "Choose a valid cutover date." }, { status: 400 });
  if (file.size > 25_000_000) return NextResponse.json({ error: "The ZIP export must be 25 MB or smaller." }, { status: 400 });
  try {
    const data = readNotionExport(Buffer.from(await file.arrayBuffer()));
    const plan = makePlan(data, cutoffResult.data);
    if (!apply) return NextResponse.json({ dryRun: true, fileName: file.name, summary: { accounts: plan.accountsPlan.length, categories: plan.categoriesPlan.length, transactions: plan.transactionsPlan.length, income: plan.incomePlan.length, allocations: plan.allocationsPlan.length, obligations: plan.obligationsPlan.length, reviews: plan.transactionsPlan.filter((item) => item.review).length }, skipped: plan.skipped, warnings: plan.warnings });
    const imported = await applyPlan(user.id, plan);
    return NextResponse.json({ ok: true, cutoff: plan.cutoff, imported, warnings: plan.warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the Notion export.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
