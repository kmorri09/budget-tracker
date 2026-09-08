export type PlaidAccount = { account_id: string; name: string; official_name?: string | null; mask?: string | null; type: string; subtype?: string | null; balances: { current?: number | null; available?: number | null } };
export type PlaidTransaction = { transaction_id: string; pending_transaction_id?: string | null; account_id: string; amount: number; date: string; authorized_date?: string | null; name?: string | null; merchant_name?: string | null; pending?: boolean; personal_finance_category?: { primary?: string | null } | null };
export type NormalizedTransaction = { providerTransactionId: string; pendingTransactionId: string | null; providerAccountId: string; amountCents: number; kind: "expense" | "income" | "transfer_in" | "transfer_out"; date: string; description: string; pending: boolean; raw: PlaidTransaction };

export function accountType(account: PlaidAccount) {
  if (account.type === "credit" || account.subtype === "credit card") return "credit_card";
  if (account.subtype === "savings") return "savings";
  return "checking";
}

export function inferTransactionKind(transaction: PlaidTransaction): NormalizedTransaction["kind"] {
  const primary = transaction.personal_finance_category?.primary?.toUpperCase() ?? "";
  const description = `${transaction.merchant_name ?? ""} ${transaction.name ?? ""}`.toLowerCase();
  const transferLike = primary.includes("TRANSFER") || /\b(transfer|payment|paydown|autopay|credit card|card payment)\b/.test(description);
  if (transferLike) return transaction.amount < 0 ? "transfer_in" : "transfer_out";
  return transaction.amount < 0 ? "income" : "expense";
}

export function toNormalized(transaction: PlaidTransaction): NormalizedTransaction {
  return { providerTransactionId: transaction.transaction_id, pendingTransactionId: transaction.pending_transaction_id ?? null, providerAccountId: transaction.account_id, amountCents: Math.round(Math.abs(transaction.amount) * 100), kind: inferTransactionKind(transaction), date: transaction.date || transaction.authorized_date || new Date().toISOString().slice(0, 10), description: transaction.merchant_name || transaction.name || "Imported transaction", pending: Boolean(transaction.pending), raw: transaction };
}

export function mockProviderAccounts(): PlaidAccount[] {
  return [
    { account_id: "mock-checking-001", name: "Demo Checking", official_name: "Demo Checking", mask: "1234", type: "depository", subtype: "checking", balances: { current: 1842.35, available: 1842.35 } },
    { account_id: "mock-card-001", name: "Demo Credit Card", official_name: "Demo Credit Card", mask: "9876", type: "credit", subtype: "credit card", balances: { current: 327.42, available: 9672.58 } },
  ];
}
