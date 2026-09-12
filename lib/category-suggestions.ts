export type SuggestionCategory = { id: string; name: string; active?: boolean };
export type SuggestionHistory = { id?: string; description: string; categoryId: string | null; accountId?: string };
export type ProviderCategory = { primary?: string | null; detailed?: string | null; confidenceLevel?: string | null };
export type CategorySuggestion = {
  categoryId: string;
  category: string;
  confidence: "high" | "medium";
  source: "history" | "plaid" | "merchant";
  reason: string;
};

type Concept = { terms: string[]; label: string };

function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const providerConcepts: { matches: (primary: string, detailed: string) => boolean; concept: Concept }[] = [
  { matches: (_, detailed) => /GROCER|SUPERMARKET/.test(detailed), concept: { terms: ["groceries", "grocery"], label: "groceries" } },
  { matches: (_, detailed) => /VETERIN|PET_CARE|PET_SUPPL/.test(detailed), concept: { terms: ["dog", "pet", "pets"], label: "pet care" } },
  { matches: (_, detailed) => /HAIR|BEAUTY|BARBER/.test(detailed), concept: { terms: ["haircut", "hair", "personal care"], label: "hair and personal care" } },
  { matches: (_, detailed) => /(?:^|_)RENT$/.test(detailed), concept: { terms: ["rent", "housing"], label: "rent" } },
  { matches: (_, detailed) => /TELEPHONE|CELL_PHONE/.test(detailed), concept: { terms: ["phone", "mobile phone", "cell phone"], label: "phone service" } },
  { matches: (_, detailed) => /GAS_AND_ELECTRIC|ELECTRIC/.test(detailed), concept: { terms: ["electric", "electricity", "utilities", "utility"], label: "electric utilities" } },
  { matches: (_, detailed) => /INTERNET|CABLE|WATER|SEWAGE|GARBAGE/.test(detailed), concept: { terms: ["utilities", "utility", "internet", "cable"], label: "household utilities" } },
  { matches: (primary) => primary === "FOOD_AND_DRINK", concept: { terms: ["dining", "restaurants", "restaurant", "eating out", "food"], label: "food and drink" } },
  { matches: (primary) => primary === "TRANSPORTATION", concept: { terms: ["transportation", "transit", "fuel", "gas", "auto", "car"], label: "transportation" } },
  { matches: (primary) => primary === "TRAVEL", concept: { terms: ["travel", "vacation"], label: "travel" } },
  { matches: (primary) => primary === "ENTERTAINMENT", concept: { terms: ["fun", "entertainment"], label: "entertainment" } },
  { matches: (primary) => primary === "MEDICAL", concept: { terms: ["medical", "health", "healthcare", "dental"], label: "medical care" } },
  { matches: (primary) => primary === "PERSONAL_CARE", concept: { terms: ["personal care", "haircut"], label: "personal care" } },
  { matches: (primary) => primary === "INSURANCE", concept: { terms: ["insurance"], label: "insurance" } },
  { matches: (primary) => primary === "HOME_IMPROVEMENT", concept: { terms: ["home improvement", "household", "home"], label: "home improvement" } },
  { matches: (primary) => primary === "GENERAL_MERCHANDISE", concept: { terms: ["shopping", "merchandise"], label: "general merchandise" } },
  { matches: (primary) => primary === "BANK_FEES", concept: { terms: ["bank fees", "fees"], label: "bank fees" } },
  { matches: (primary) => primary === "LOAN_PAYMENTS", concept: { terms: ["loan payment", "loan transfer", "loans", "loan"], label: "loan payments" } },
];

const merchantConcepts: { pattern: RegExp; concept: Concept }[] = [
  { pattern: /\b(bagels?|bakery|cafe|coffee|restaurant|pizza|pizzeria|diner|grill|sushi|tacos?|burger|doordash|grubhub|uber eats)\b/i, concept: { terms: ["dining", "restaurants", "restaurant", "eating out", "food"], label: "dining" } },
  { pattern: /\b(grocer(?:y|ies)|supermarket|whole foods|trader joe'?s?|aldi|kroger|safeway)\b/i, concept: { terms: ["groceries", "grocery"], label: "groceries" } },
  { pattern: /\b(spotify|adobe|dropbox|microsoft 365)\b/i, concept: { terms: ["software", "subscriptions"], label: "software or subscriptions" } },
  { pattern: /\b(vet(?:erinary)?|petco|petsmart|pet supplies)\b/i, concept: { terms: ["dog", "pet", "pets"], label: "pet care" } },
  { pattern: /\b(barber|haircut|hair salon)\b/i, concept: { terms: ["haircut", "hair", "personal care"], label: "hair care" } },
  { pattern: /\b(verizon|t[ -]?mobile|at&t wireless|cellular)\b/i, concept: { terms: ["phone", "mobile phone", "cell phone"], label: "phone service" } },
  { pattern: /\b(electric|electricity|power company|utility)\b/i, concept: { terms: ["electric", "electricity", "utilities", "utility"], label: "utilities" } },
  { pattern: /\b(insurance|geico|progressive|state farm)\b/i, concept: { terms: ["insurance"], label: "insurance" } },
  { pattern: /\b(uber|lyft|transit|metro|parking|toll|gas station)\b/i, concept: { terms: ["transportation", "transit", "fuel", "gas", "auto", "car"], label: "transportation" } },
  { pattern: /\b(hotel|hyatt|marriott|airbnb|airline|delta air|united airlines|expedia)\b/i, concept: { terms: ["travel", "vacation"], label: "travel" } },
  { pattern: /\brent\b/i, concept: { terms: ["rent", "housing"], label: "rent" } },
];

function categoryMatchScore(name: string, term: string) {
  const normalizedName = normalizeText(name);
  const normalizedTerm = normalizeText(term);
  if (normalizedName === normalizedTerm) return 300 + normalizedTerm.length;
  if (normalizedName.startsWith(`${normalizedTerm} `)) return 200 + normalizedTerm.length;
  if (` ${normalizedName} `.includes(` ${normalizedTerm} `)) return 100 + normalizedTerm.length;
  return 0;
}

function categoryForConcept(categories: SuggestionCategory[], concept: Concept, history: SuggestionHistory[], accountId?: string) {
  const scored = categories
    .filter(category => category.active !== false)
    .map(category => ({ category, score: Math.max(...concept.terms.map(term => categoryMatchScore(category.name, term))) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.category.name.localeCompare(right.category.name));
  if (!scored.length) return null;
  const topScore = scored[0].score;
  const tied = scored.filter(candidate => candidate.score === topScore);
  if (tied.length === 1) return tied[0].category;
  if (!accountId) return null;
  const usage = tied.map(candidate => ({ ...candidate, count: history.filter(item => item.accountId === accountId && item.categoryId === candidate.category.id).length })).sort((left, right) => right.count - left.count);
  return usage[0].count > 0 && usage[0].count > (usage[1]?.count ?? 0) ? usage[0].category : null;
}

function fromHistory(description: string, categories: SuggestionCategory[], history: SuggestionHistory[]) {
  const normalized = normalizeText(description);
  const available = new Map(categories.filter(category => category.active !== false).map(category => [category.id, category]));
  const counts = new Map<string, number>();
  for (const item of history) {
    if (!item.categoryId || normalizeText(item.description) !== normalized || !available.has(item.categoryId)) continue;
    counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (!ranked.length || ranked[0][1] === (ranked[1]?.[1] ?? 0)) return null;
  const category = available.get(ranked[0][0])!;
  const count = ranked[0][1];
  return { categoryId: category.id, category: category.name, confidence: "high", source: "history", reason: count === 1 ? "You previously used this category for the same merchant." : `You used this category for ${count} previous transactions from the same merchant.` } satisfies CategorySuggestion;
}

export function suggestCategory({ description, accountId, categories, history, providerCategory }: { description: string; accountId?: string; categories: SuggestionCategory[]; history: SuggestionHistory[]; providerCategory?: ProviderCategory | null }) {
  const historical = fromHistory(description, categories, history);
  if (historical) return historical;

  const primary = providerCategory?.primary?.toUpperCase() ?? "";
  const detailed = providerCategory?.detailed?.toUpperCase() ?? "";
  const providerConfidence = providerCategory?.confidenceLevel?.toUpperCase() ?? "";
  if (primary && !["LOW", "UNKNOWN"].includes(providerConfidence)) {
    const match = providerConcepts.find(rule => rule.matches(primary, detailed));
    const category = match ? categoryForConcept(categories, match.concept, history, accountId) : null;
    if (match && category) {
      const confidence = ["VERY_HIGH", "HIGH"].includes(providerConfidence) ? "high" : "medium";
      return { categoryId: category.id, category: category.name, confidence, source: "plaid", reason: `Plaid identifies this as ${match.concept.label}${providerConfidence ? ` (${providerConfidence.toLowerCase().replace("_", " ")} confidence)` : ""}.` } satisfies CategorySuggestion;
    }
  }

  const merchantMatch = merchantConcepts.find(rule => rule.pattern.test(description));
  const category = merchantMatch ? categoryForConcept(categories, merchantMatch.concept, history, accountId) : null;
  return merchantMatch && category ? { categoryId: category.id, category: category.name, confidence: "medium", source: "merchant", reason: `The merchant name looks like ${merchantMatch.concept.label}.` } satisfies CategorySuggestion : null;
}
