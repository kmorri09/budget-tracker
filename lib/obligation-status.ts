const DAY_MS = 24 * 60 * 60 * 1000;
const GENERIC_WORDS = new Set(["the", "payment", "card", "balance", "statement", "bill", "transfer"]);

export type ObligationCoverage = { amountCents: number; description: string; effectiveDate: string; accountId?: string; fromAccountId?: string; toAccountId?: string };
export type ObligationForCoverage = { amountCents: number; name: string; dueDate: string; accountId: string };

function tokens(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(token => token.length > 2 && !GENERIC_WORDS.has(token));
}

function datesAreClose(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / DAY_MS <= 14;
}

export function isObligationCovered(obligation: ObligationForCoverage, candidates: ObligationCoverage[], today: string) {
  const obligationTokens = tokens(obligation.name);
  if (!obligationTokens.length) return false;
  return candidates.some(candidate => {
    if (candidate.amountCents !== obligation.amountCents || candidate.effectiveDate > today || !datesAreClose(candidate.effectiveDate, obligation.dueDate)) return false;
    const candidateTokens = new Set(tokens(candidate.description));
    if (!obligationTokens.some(token => candidateTokens.has(token))) return false;
    return !candidate.accountId || candidate.accountId === obligation.accountId || candidate.fromAccountId === obligation.accountId || candidate.toAccountId === obligation.accountId || candidate.description.toLowerCase().includes(obligation.name.toLowerCase());
  });
}
