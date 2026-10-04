import { CARD_PAYMENT_MATCH_DAYS } from "./bank-sync-core";

type DuplicateEntry = { id: string; date: string; description: string; kind: string; signedCents: number; source: string; excluded: boolean; pending?: boolean };
export type PossibleLedgerDuplicate = { first: DuplicateEntry; second: DuplicateEntry; balanceEffectIfExcludedCents: number };

export function possibleLedgerDuplicates(entries: DuplicateEntry[]): PossibleLedgerDuplicate[] {
  const active = entries.filter(entry => !entry.excluded && entry.source === "plaid" && entry.kind !== "adjustment" && entry.signedCents !== 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const matches: PossibleLedgerDuplicate[] = [];
  const merchant = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  for (let index = 0; index < active.length; index++) {
    const first = active[index];
    for (const second of active.slice(index + 1)) {
      const days = (Date.parse(`${second.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 86_400_000;
      if (days > 14) break;
      const sameAmount = days <= 5 && first.signedCents === second.signedCents;
      const pendingReplacement = Boolean(first.pending) !== Boolean(second.pending) && Math.sign(first.signedCents) === Math.sign(second.signedCents);
      if (Number.isFinite(days) && (sameAmount || pendingReplacement) && merchant(first.description) && merchant(first.description) === merchant(second.description)) {
        matches.push({ first, second, balanceEffectIfExcludedCents: -first.signedCents });
      }
    }
  }
  return matches;
}

export type ReconciliationBankActivity = {
  id: string;
  date: string;
  description: string;
  kind: string;
  amountCents: number;
  signedCents: number;
  pending: boolean;
  removedByProvider: boolean;
  linkedToApp: boolean;
};

type LinkedEntry = { id: string; description: string; signedCents: number; pending: boolean; excluded: boolean; providerTransactionId: string | null; confirmedRestoration?: boolean };
export type LinkedBankDifference = { entryId: string; description: string; appSignedCents: number; bank: ReconciliationBankActivity; amountDifferenceCents: number; pendingDiffers: boolean };
export type RemovedPostedBankEntry = { entryId: string; description: string; appSignedCents: number; bank: ReconciliationBankActivity };

export function removedPostedBankEntries(entries: LinkedEntry[], bankActivity: ReconciliationBankActivity[], supersededProviderIds: ReadonlySet<string> = new Set()): RemovedPostedBankEntry[] {
  const bankById = new Map(bankActivity.map(row => [row.id, row]));
  return entries.flatMap(entry => {
    if (!entry.excluded || !entry.providerTransactionId || supersededProviderIds.has(entry.providerTransactionId)) return [];
    const bank = bankById.get(entry.providerTransactionId);
    if (!bank || bank.pending || !bank.removedByProvider) return [];
    return [{ entryId: entry.id, description: entry.description, appSignedCents: entry.signedCents, bank }];
  });
}

// A link only establishes identity. Check the final amount and state too,
// including older pending IDs still attached to an app entry.
export function linkedBankDifferences(entries: LinkedEntry[], bankActivity: ReconciliationBankActivity[], replacements: ReadonlyMap<string, string> = new Map()): LinkedBankDifference[] {
  const bankById = new Map(bankActivity.map(row => [row.id, row]));
  return entries.flatMap(entry => {
    if (entry.excluded || !entry.providerTransactionId) return [];
    let providerId = entry.providerTransactionId;
    const visited = new Set<string>();
    while (replacements.has(providerId) && !visited.has(providerId)) { visited.add(providerId); providerId = replacements.get(providerId)!; }
    const bank = bankById.get(providerId);
    if (!bank) return [];
    const amountDifferenceCents = bank.signedCents - entry.signedCents;
    const pendingDiffers = bank.pending !== entry.pending;
    if (!amountDifferenceCents && !pendingDiffers && (!bank.removedByProvider || entry.confirmedRestoration)) return [];
    return [{ entryId: entry.id, description: entry.description, appSignedCents: entry.signedCents, bank, amountDifferenceCents, pendingDiffers }];
  });
}

export type PaymentEvidence = {
  fromAccountName: string;
  toAccountName: string;
  bankSide: "withdrawal" | "credit";
  otherSideLinkedToBank: boolean;
  appliedCents: number;
  purchases: { id: string; date: string; description: string; amountCents: number }[];
  nearbyBankActivity: (ReconciliationBankActivity & { exactAmount: boolean })[];
};

// Include already linked activity and larger withdrawals: a per-purchase
// payment may duplicate part of a statement payment. These are clues, not
// automatic matches, and must never change the ledger.
export function nearbyPaymentBankActivity(
  payment: { date: string; amountCents: number; signedCents: number },
  bankActivity: ReconciliationBankActivity[],
  supersededProviderIds: ReadonlySet<string> = new Set(),
) {
  const dayDistance = (date: string) => Math.abs(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${payment.date}T00:00:00Z`)) / 86_400_000;
  return bankActivity
    .filter(item => !item.removedByProvider && !supersededProviderIds.has(item.id)
      && Math.sign(item.signedCents) === Math.sign(payment.signedCents)
      && dayDistance(item.date) <= CARD_PAYMENT_MATCH_DAYS)
    .map(item => ({ ...item, exactAmount: item.amountCents === payment.amountCents }))
    .sort((left, right) => Number(right.exactAmount) - Number(left.exactAmount)
      || dayDistance(left.date) - dayDistance(right.date)
      || left.id.localeCompare(right.id));
}
