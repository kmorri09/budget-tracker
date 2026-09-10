export type CategorizationRuleCandidate = {
  id: string;
  matchText: string;
  normalizedMatch: string;
  categoryId: string;
};

export function normalizeCategorizationMatch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function findCategorizationRule(description: string, rules: CategorizationRuleCandidate[]) {
  const normalizedDescription = normalizeCategorizationMatch(description);
  return [...rules]
    .filter(rule => normalizedDescription.includes(rule.normalizedMatch))
    .sort((a, b) => b.normalizedMatch.length - a.normalizedMatch.length || a.id.localeCompare(b.id))[0] ?? null;
}
