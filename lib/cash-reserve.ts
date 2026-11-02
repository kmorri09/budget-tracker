/** A user decision to set aside or release category funding. */
export type CashReserveChange = {
  id: string;
  categoryId: string;
  amountCents: number;
  effectiveDate: string;
  createdAt: Date;
};

/** A current transaction snapshot; removed transactions are excluded on replay. */
export type CashReserveTransaction = {
  id: string;
  categoryId: string | null;
  accountId: string;
  kind: string;
  amountCents: number;
  effectiveDate: string;
  createdAt: Date;
  status: string;
};

/**
 * Replay reserve changes and cash expenses in date order. The reserve is a
 * category-wide pool, not a bill match. Replaying current transaction rows
 * makes amount/category changes and removals reversible without persisting a
 * second, potentially stale consumption record.
 */
export function calculateCashReserves(
  changes: CashReserveChange[],
  transactions: CashReserveTransaction[],
  cashAccountIds: Set<string>,
  throughDate: string,
): Map<string, number> {
  const events = [
    ...changes.filter(row => row.effectiveDate <= throughDate).map(row => ({
      id: row.id, categoryId: row.categoryId, date: row.effectiveDate,
      createdAt: row.createdAt, amountCents: row.amountCents, kind: "change" as const,
    })),
    ...transactions.filter(row => row.categoryId && row.effectiveDate <= throughDate
      && cashAccountIds.has(row.accountId) && row.kind === "expense"
      && row.status !== "removed" && row.status !== "void").map(row => ({
      id: row.id, categoryId: row.categoryId!, date: row.effectiveDate,
      createdAt: row.createdAt, amountCents: row.amountCents, kind: "expense" as const,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)
    || a.createdAt.getTime() - b.createdAt.getTime()
    || a.id.localeCompare(b.id));
  const balances = new Map<string, number>();
  for (const event of events) {
    const previous = balances.get(event.categoryId) ?? 0;
    balances.set(event.categoryId, Math.max(0, previous
      + (event.kind === "change" ? event.amountCents : -Math.max(0, event.amountCents))));
  }
  return balances;
}
