export type Account = { id: string; name: string; institution: string; type: string; syncEnabled: boolean; openingBalance: number; providerBalance: number | null; providerBalanceAt: string | null; ledgerBalance: number };
export type Category = { id: string; name: string; icon: string; available: number; target: number; allocated: number; spent: number };
export type Entry = { id: string; description: string; amount: number; kind: string; source: string; status: string; pending: boolean; date: string; category: string | null; account: string };
export type Allocation = { id: string; date: string; amount: number; note: string; category: string };
export type DashboardData = {
  ledgerBalance: number; providerBalance: number | null; remainingToBudget: number;
  allocationPercent: number; accounts: Account[]; categories: Category[];
  activity: Entry[]; allocations: Allocation[];
  trailing30: { income: number; spending: number; startDate: string; endDate: string };
  reviews: { id: string; kind: string; title: string; details: string | null }[];
  obligations: { id: string; name: string; dueDate: string; amount: number; category: string; account: string }[];
};
export type ActionType = "transaction" | "income" | "allocation" | "transfer" | "payment" | "category" | "account";
export const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
export function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
export function signedAmount(entry: Pick<Entry, "kind" | "amount">) {
  return ["income", "refund", "transfer_in", "adjustment"].includes(entry.kind) ? entry.amount : -entry.amount;
}
export const kindLabel = (kind: string) => ({ expense: "Expense", income: "Income", refund: "Refund", card_payment: "Card payment", transfer_in: "Transfer in", transfer_out: "Transfer out", adjustment: "Reconciliation", manual: "Manual", notion_import: "Notion import", reconciliation: "Reconciliation", posted: "Posted", pending: "Pending", credit_card: "Credit card", checking: "Checking", savings: "Savings" }[kind] ?? kind.replaceAll("_", " "));
