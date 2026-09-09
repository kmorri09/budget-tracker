export type PlaidAccount = { account_id: string; name: string; official_name?: string | null; mask?: string | null; type: string; subtype?: string | null; balances: { current?: number | null; available?: number | null } };
export type PlaidTransaction = { transaction_id: string; pending_transaction_id?: string | null; account_id: string; amount: number; date: string; authorized_date?: string | null; name?: string | null; merchant_name?: string | null; pending?: boolean; personal_finance_category?: { primary?: string | null } | null };
export type NormalizedTransaction = { providerTransactionId: string; pendingTransactionId: string | null; providerAccountId: string; amountCents: number; kind: "expense" | "income" | "transfer_in" | "transfer_out"; date: string; description: string; pending: boolean; raw: PlaidTransaction };
export type LedgerMatchCandidate = { id: string; accountId: string; amountCents: number; kind: string; effectiveDate: string; description: string; source: string; status: string; providerTransactionId: string | null };
export type CardPaymentMatchCandidate = { id: string; fromAccountId: string; amountCents: number; effectiveDate: string; providerTransactionId: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;
export const CARD_PAYMENT_MATCH_DAYS = 5;

function cashDirection(kind: string) {
  if (["income", "refund", "transfer_in"].includes(kind)) return "in";
  if (["expense", "card_payment", "transfer_out"].includes(kind)) return "out";
  return null;
}

function dayDistance(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / DAY_MS;
}

function descriptionTokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(token => token.length > 2 && !["the", "payment", "purchase", "debit", "credit", "online"].includes(token)));
}

function descriptionScore(left: string, right: string) {
  const a = descriptionTokens(left), b = descriptionTokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

export function syncCutoverDate(connectedAt: Date, lookbackDays = 7) {
  return new Date(connectedAt.getTime() - lookbackDays * DAY_MS).toISOString().slice(0, 10);
}

// Match only high-confidence ledger duplicates: same account, exact cents,
// same cash direction, and posting dates no more than three days apart. A
// unique same-day match is accepted even when the bank and manual descriptions
// differ (for example employer legal name versus "paycheck").
export function findLedgerDuplicate(normalized: NormalizedTransaction, localAccountId: string, candidates: LedgerMatchCandidate[], excludeId?: string) {
  const direction = cashDirection(normalized.kind);
  const eligible = candidates.filter(candidate => candidate.id !== excludeId
    && candidate.accountId === localAccountId
    && candidate.status !== "removed"
    && ["manual", "notion_import"].includes(candidate.source)
    && (!candidate.providerTransactionId || candidate.providerTransactionId.startsWith("notion:"))
    && candidate.amountCents === normalized.amountCents
    && cashDirection(candidate.kind) === direction
    && dayDistance(candidate.effectiveDate, normalized.date) <= 3);
  const sameDay = eligible.filter(candidate => candidate.effectiveDate === normalized.date);
  if (sameDay.length === 1) return sameDay[0];
  if (!sameDay.length && eligible.length === 1) return eligible[0];
  const ranked = eligible.map(candidate => ({ candidate, score: descriptionScore(candidate.description, normalized.description) })).sort((a, b) => b.score - a.score);
  if (ranked[0]?.score >= 0.5 && ranked[0].score > (ranked[1]?.score ?? 0)) return ranked[0].candidate;
  return null;
}

// A bank-side card withdrawal and an existing card-payment record describe the
// same cash movement. Match only a unique exact account/amount payment within
// the normal posting-date drift so recurring equal payments remain reviewable.
export function findCardPaymentMatch(normalized: NormalizedTransaction, localAccountId: string, candidates: CardPaymentMatchCandidate[]) {
  if (normalized.kind !== "transfer_out") return null;
  const eligible = candidates.filter(candidate => candidate.fromAccountId === localAccountId
    && candidate.amountCents === normalized.amountCents
    && !candidate.providerTransactionId
    && dayDistance(candidate.effectiveDate, normalized.date) <= CARD_PAYMENT_MATCH_DAYS);
  const sameDay = eligible.filter(candidate => candidate.effectiveDate === normalized.date);
  if (sameDay.length === 1) return sameDay[0];
  if (!sameDay.length && eligible.length === 1) return eligible[0];
  return null;
}

export function accountType(account: PlaidAccount) {
  if (account.type === "credit" || account.subtype === "credit card") return "credit_card";
  if (account.subtype === "savings") return "savings";
  return "checking";
}

export function inferTransactionKind(transaction: PlaidTransaction): NormalizedTransaction["kind"] {
  const primary = transaction.personal_finance_category?.primary?.toUpperCase() ?? "";
  const description = `${transaction.merchant_name ?? ""} ${transaction.name ?? ""}`.toLowerCase();
  const transferLike = primary.includes("TRANSFER") || /\b(transfer|payment|e-?payment|paydown|autopay|credit card|card payment|credit crd|cardmember)\b/.test(description) || /\b(chase credit crd|wells fargo card|amex e-?payment)\b/.test(description);
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
