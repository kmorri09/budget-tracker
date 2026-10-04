export type LedgerTransaction = { kind: string; amountCents: number; status?: string };
export type LedgerPayment = { fromAccountId: string; toAccountId: string; amountCents: number };

export function transactionBalanceEffectCents(kind: string, amountCents: number) {
  if (["income", "refund", "transfer_in", "adjustment"].includes(kind)) return amountCents;
  return -amountCents;
}

export function calculateAccountLedgerCents(
  accountId: string,
  openingBalanceCents: number,
  transactions: LedgerTransaction[],
  payments: LedgerPayment[],
) {
  const transactionCents = transactions
    .filter(transaction => transaction.status !== "removed")
    .reduce((sum, transaction) => sum + transactionBalanceEffectCents(transaction.kind, transaction.amountCents), 0);
  const paymentCents = payments.reduce((sum, payment) => {
    if (payment.fromAccountId === accountId) return sum - payment.amountCents;
    if (payment.toAccountId === accountId) return sum + payment.amountCents;
    return sum;
  }, 0);
  return openingBalanceCents + transactionCents + paymentCents;
}
