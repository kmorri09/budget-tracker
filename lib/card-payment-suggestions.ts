import type { DashboardData } from "./workspace-types";

export type SuggestedApplication = {
  transactionId: string;
  amountCents: number;
  description: string;
  date: string;
  category: string;
};

export type CardPaymentSuggestion = {
  cardId: string;
  cardName: string;
  amountCents: number;
  applications: SuggestedApplication[];
};

// Category availability already includes the card charges. Adding their unpaid
// balances back reveals how much funding can still be applied to those charges.
export function suggestCardPayments(dashboard: Pick<DashboardData, "accounts" | "managedCategories" | "activity" | "payments">, throughDate: string): CardPaymentSuggestion[] {
  const cards = new Map(dashboard.accounts.filter(account => account.type === "credit_card" && account.active).map(account => [account.id, account]));
  const categories = new Map(dashboard.managedCategories.map(category => [category.id, category]));
  const unappliedByCard = new Map<string, number>();
  for (const payment of dashboard.payments) {
    if (!payment.editable || payment.date > throughDate || !cards.has(payment.toAccountId)) continue;
    unappliedByCard.set(payment.toAccountId, (unappliedByCard.get(payment.toAccountId) ?? 0) + Math.max(0, Math.round(payment.remaining * 100)));
  }
  const unpaidByCategory = new Map<string, { entry: DashboardData["activity"][number]; remainingCents: number }[]>();

  const charges = dashboard.activity.filter(entry => entry.kind === "expense" && entry.status !== "removed" && !entry.pending && entry.date <= throughDate && cards.has(entry.accountId) && entry.remainingToPay > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const entry of charges) {
    const unpaidCents = Math.round(entry.remainingToPay * 100);
    const credit = unappliedByCard.get(entry.accountId) ?? 0;
    const remainingCents = Math.max(0, unpaidCents - credit);
    unappliedByCard.set(entry.accountId, Math.max(0, credit - unpaidCents));
    if (!remainingCents || !entry.categoryId || !categories.has(entry.categoryId)) continue;
    const entries = unpaidByCategory.get(entry.categoryId) ?? [];
    entries.push({ entry, remainingCents });
    unpaidByCategory.set(entry.categoryId, entries);
  }

  const suggestions = new Map<string, CardPaymentSuggestion>();
  for (const [categoryId, entries] of unpaidByCategory) {
    const category = categories.get(categoryId)!;
    const unpaidCents = entries.reduce((sum, item) => sum + item.remainingCents, 0);
    let fundedCents = Math.min(unpaidCents, Math.max(0, Math.round(category.available * 100) + unpaidCents));
    for (const { entry, remainingCents } of entries) {
      if (fundedCents <= 0) break;
      const appliedCents = Math.min(fundedCents, remainingCents);
      fundedCents -= appliedCents;
      const card = cards.get(entry.accountId)!;
      const suggestion = suggestions.get(card.id) ?? { cardId: card.id, cardName: card.name, amountCents: 0, applications: [] };
      suggestion.amountCents += appliedCents;
      suggestion.applications.push({ transactionId: entry.id, amountCents: appliedCents, description: entry.description, date: entry.date, category: category.name });
      suggestions.set(card.id, suggestion);
    }
  }
  return [...suggestions.values()].sort((a, b) => b.amountCents - a.amountCents || a.cardName.localeCompare(b.cardName));
}
