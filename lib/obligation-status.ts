const DAY_MS = 86_400_000;
const GENERIC_WORDS = new Set(["the", "payment", "card", "balance", "statement", "bill", "transfer", "autopay", "online"]);

export type ObligationCoverage = { id?: string; type?: "transaction" | "payment"; amountCents: number; description: string; effectiveDate: string; accountId?: string; fromAccountId?: string; toAccountId?: string };
export type ObligationForCoverage = { id?: string; amountCents: number; name: string; dueDate: string; accountId: string; cadence?: string | null };
export type MatchDecision = { obligationId: string; candidateType: string; candidateId: string; status: string };
export type ObligationMatch = ObligationCoverage & { confidence: "automatic" | "confirmed"; score: number };
export type ObligationPlan = { nextChargeDate: string; expectedAmountCents: number; amountSource: "planned" | "observed"; lastCharge: ObligationMatch | null; previousCharge: ObligationMatch | null; covered: boolean; suggestion: ObligationCoverage | null; history: ObligationMatch[] };

function tokens(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(token => token.length > 2 && !GENERIC_WORDS.has(token));
}
function dayDistance(a: string, b: string) { return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS; }
function addDays(date: string, days: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10); }
function cadenceKind(cadence?: string | null) {
  const value = cadence?.trim().toLowerCase() ?? "";
  if (/\b(biweekly|bi-weekly|fortnightly|every 2 weeks)\b/.test(value)) return "biweekly";
  if (/\b(weekly|every week)\b/.test(value)) return "weekly";
  if (/\b(quarterly|every 3 months)\b/.test(value)) return "quarterly";
  if (/\b(annual|annually|yearly|every year)\b/.test(value)) return "yearly";
  if (/\b(monthly|every month)\b/.test(value)) return "monthly";
  return "once";
}
function addMonths(anchor: string, count: number) {
  const [year, month, day] = anchor.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}
export function nextOccurrence(anchor: string, cadence: string | null | undefined, after: string) {
  const kind = cadenceKind(cadence);
  if (kind === "once") return anchor;
  let step = 0;
  let date = anchor;
  while (date < after && step < 1200) {
    step++;
    date = kind === "weekly" ? addDays(anchor, step * 7) : kind === "biweekly" ? addDays(anchor, step * 14) : addMonths(anchor, step * (kind === "quarterly" ? 3 : kind === "yearly" ? 12 : 1));
  }
  return date;
}
function nearestScheduledDate(obligation: ObligationForCoverage, candidateDate: string) {
  const kind = cadenceKind(obligation.cadence);
  if (kind === "once") return obligation.dueDate;
  let date = obligation.dueDate;
  let previous = date;
  if (candidateDate < date) {
    for (let step = -1; date > candidateDate && step > -1200; step--) {
      previous = date;
      date = kind === "weekly" ? addDays(obligation.dueDate, step * 7) : kind === "biweekly" ? addDays(obligation.dueDate, step * 14) : addMonths(obligation.dueDate, step * (kind === "quarterly" ? 3 : kind === "yearly" ? 12 : 1));
    }
    return dayDistance(previous, candidateDate) <= dayDistance(date, candidateDate) ? previous : date;
  }
  for (let step = 1; date < candidateDate && step < 1200; step++) {
    previous = date;
    date = kind === "weekly" ? addDays(obligation.dueDate, step * 7) : kind === "biweekly" ? addDays(obligation.dueDate, step * 14) : addMonths(obligation.dueDate, step * (kind === "quarterly" ? 3 : kind === "yearly" ? 12 : 1));
  }
  return dayDistance(previous, candidateDate) <= dayDistance(date, candidateDate) ? previous : date;
}
export function matchStrength(obligation: ObligationForCoverage, candidate: ObligationCoverage): "automatic" | "possible" | null {
  if (cadenceKind(obligation.cadence) === "once" && candidate.effectiveDate < addDays(obligation.dueDate, -14)) return null;
  const accountMatches = candidate.accountId === obligation.accountId || candidate.fromAccountId === obligation.accountId || candidate.toAccountId === obligation.accountId;
  if (!accountMatches) return null;
  const obligationTokens = tokens(obligation.name);
  const candidateTokens = new Set(tokens(candidate.description));
  const nameCoverage = obligationTokens.filter(token => candidateTokens.has(token)).length / Math.max(obligationTokens.length, 1);
  if (!nameCoverage) return null;
  const dateGap = dayDistance(nearestScheduledDate(obligation, candidate.effectiveDate), candidate.effectiveDate);
  const amountGap = Math.abs(obligation.amountCents - candidate.amountCents);
  if (nameCoverage >= 0.7 && dateGap <= 7 && amountGap <= Math.max(1000, obligation.amountCents * 0.15)) return "automatic";
  if (dateGap <= 14 && amountGap <= Math.max(5000, obligation.amountCents * 0.35)) return "possible";
  return null;
}
export function planObligations(obligations: ObligationForCoverage[], candidates: ObligationCoverage[], decisions: MatchDecision[], today: string) {
  const result = new Map<string, ObligationPlan>();
  const decisionMap = new Map(decisions.map(decision => [`${decision.obligationId}:${decision.candidateType}:${decision.candidateId}`, decision.status]));
  const historyStart = addMonths(today, -18);
  const scored = obligations.flatMap(obligation => candidates.flatMap(candidate => {
    if (!obligation.id || !candidate.id || !candidate.type || candidate.effectiveDate > today || candidate.effectiveDate < historyStart) return [];
    const decision = decisionMap.get(`${obligation.id}:${candidate.type}:${candidate.id}`);
    if (decision === "dismissed") return [];
    const strength = matchStrength(obligation, candidate);
    if (!strength && decision !== "confirmed") return [];
    const score = (decision === "confirmed" ? 100 : strength === "automatic" ? 50 : 20)
      - dayDistance(nearestScheduledDate(obligation, candidate.effectiveDate), candidate.effectiveDate)
      - Math.abs(obligation.amountCents - candidate.amountCents) / Math.max(obligation.amountCents, 1) * 10
      + tokens(obligation.name).filter(token => new Set(tokens(candidate.description)).has(token)).length / Math.max(tokens(obligation.name).length, 1) * 20;
    return [{ obligation, candidate, decision, strength, score }];
  }));
  const assigned = new Set<string>();
  const assignedCycles = new Set<string>();
  const matches = new Map<string, ObligationMatch[]>();
  for (const pair of scored.filter(pair => pair.decision === "confirmed" || pair.strength === "automatic").sort((a, b) => b.score - a.score)) {
    const key = `${pair.candidate.type}:${pair.candidate.id}`;
    const cycle = `${pair.obligation.id}:${nearestScheduledDate(pair.obligation, pair.candidate.effectiveDate)}`;
    if (assigned.has(key) || assignedCycles.has(cycle)) continue;
    const rivals = scored.filter(other => other.candidate === pair.candidate && other.obligation.id !== pair.obligation.id && (other.decision === "confirmed" || other.strength === "automatic"));
    if (pair.decision !== "confirmed" && rivals.some(other => Math.abs(other.score - pair.score) < 5)) continue;
    const cycleRivals = scored.filter(other => other.obligation === pair.obligation && other.candidate !== pair.candidate && nearestScheduledDate(other.obligation, other.candidate.effectiveDate) === nearestScheduledDate(pair.obligation, pair.candidate.effectiveDate) && (other.decision === "confirmed" || other.strength === "automatic"));
    if (pair.decision !== "confirmed" && cycleRivals.some(other => Math.abs(other.score - pair.score) < 5)) continue;
    assigned.add(key);
    assignedCycles.add(cycle);
    matches.set(pair.obligation.id!, [...(matches.get(pair.obligation.id!) ?? []), { ...pair.candidate, confidence: pair.decision === "confirmed" ? "confirmed" : "automatic", score: pair.score }]);
  }
  for (const obligation of obligations) {
    const history = (matches.get(obligation.id ?? "") ?? []).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const lastCharge = history[0] ?? null;
    const kind = cadenceKind(obligation.cadence);
    const covered = kind === "once" && Boolean(lastCharge);
    const anchor = lastCharge && kind !== "once" ? lastCharge.effectiveDate : obligation.dueDate;
    const after = lastCharge && lastCharge.effectiveDate >= today ? addDays(lastCharge.effectiveDate, 1) : today;
    const nextChargeDate = kind === "once" ? obligation.dueDate : nextOccurrence(anchor, obligation.cadence, after);
    const suggestions = scored.filter(pair => pair.obligation === obligation && (pair.strength === "possible" || pair.strength === "automatic") && !assigned.has(`${pair.candidate.type}:${pair.candidate.id}`) && !assignedCycles.has(`${obligation.id}:${nearestScheduledDate(obligation, pair.candidate.effectiveDate)}`)).sort((a, b) => b.candidate.effectiveDate.localeCompare(a.candidate.effectiveDate) || b.score - a.score);
    result.set(obligation.id ?? "", { nextChargeDate, expectedAmountCents: lastCharge?.amountCents ?? obligation.amountCents, amountSource: lastCharge ? "observed" : "planned", lastCharge, previousCharge: history[1] ?? null, covered, suggestion: suggestions[0]?.candidate ?? null, history });
  }
  return result;
}

export function isObligationCovered(obligation: ObligationForCoverage, candidates: ObligationCoverage[], today: string) {
  return candidates.some(candidate => candidate.effectiveDate <= today && matchStrength(obligation, candidate) === "automatic");
}
