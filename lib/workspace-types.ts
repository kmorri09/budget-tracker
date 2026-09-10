export type Account = { id: string; name: string; institution: string; type: string; syncEnabled: boolean; isDefaultCash: boolean; active: boolean; openingBalance: number; providerBalance: number | null; providerBalanceAt: string | null; ledgerBalance: number };
export type Category = { id: string; name: string; icon: string; available: number; target: number; allocated: number; spent: number; active: boolean };
export type Entry = { id: string; description: string; amount: number; kind: string; source: string; status: string; pending: boolean; date: string; category: string | null; categoryId: string | null; account: string; accountId: string; paymentStatus: string; remainingToPay: number };
export type CardPayment = { id: string; description: string; amount: number; date: string; fromAccount: string; fromAccountId: string; toAccount: string; toAccountId: string; applied: number; remaining: number; status: string; covered: string; applications: { transactionId: string; amount: number }[]; providerLinked: boolean; editable: boolean };
export type Allocation = { id: string; date: string; amount: number; note: string; category: string; categoryId: string };
export type BudgetAdjustment = { id: string; date: string; amount: number; note: string };
export type Obligation = { id: string; name: string; dueDate: string; amount: number; category: string; categoryId: string; account: string; accountId: string; cadence: string | null; active: boolean; covered: boolean; coveredBy: string | null };
export type DashboardData = {
  ledgerBalance: number; providerBalance: number | null; remainingToBudget: number;
  availableBreakdown: { income: number; adjustments: number; allocations: number; available: number };
  availableAdjustments: BudgetAdjustment[];
  allocationPercent: number; accounts: Account[]; managedAccounts: Account[]; categories: Category[]; managedCategories: Category[];
  activity: Entry[]; allocations: Allocation[]; payments: CardPayment[];
  trailing30: { income: number; spending: number; startDate: string; endDate: string };
  reviews: { id: string; kind: string; title: string; details: string | null; transaction: Entry | null }[];
  obligations: Obligation[];
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
export const kindLabel = (kind: string) => ({ expense: "Expense", income: "Income", refund: "Refund", card_payment: "Card payment", transfer_in: "Transfer in", transfer_out: "Transfer out", adjustment: "Reconciliation", manual: "Manual", notion_import: "Notion import", plaid: "Plaid", reconciliation: "Reconciliation", posted: "Posted", pending: "Pending", credit_card: "Credit card", checking: "Checking", savings: "Savings" }[kind] ?? kind.replaceAll("_", " "));
