import type { DashboardData } from "./workspace-types";
import { paymentAffordability } from "./payment-affordability";

export type SuggestedApplication = {
  transactionId: string;
  amountCents: number;
  description: string;
  date: string;
  category: string;
};

export type CardPaymentSuggestion = {
  sourceAccountId?: string;
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
    // A card credit reduces the amount owed, but an unmatched refund must not
    // also appear as cash funding for unrelated purchases in its category.
    const unmatchedRefundCents = Math.max(0, Math.round((category.unmatchedRefunds ?? 0) * 100));
    const allocated = category.cardFundingAllocated ?? category.allocated;
    const available = category.cardFundingAvailable ?? category.available;
    // Actual effective net allocations are the ceiling. Bank cash, an unassigned
    // pool, or a positive balance alone are never proof of allocation funding.
    const allocatedCents = Number.isFinite(allocated) ? Math.max(0, Math.round(allocated * 100)) : 0;
    let fundedCents = Math.min(unpaidCents, allocatedCents, Math.max(0, Math.round(available * 100) + unpaidCents - unmatchedRefundCents));
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
  return [...suggestions.values()].map(suggestion => {
    const card = cards.get(suggestion.cardId)!;
    let remaining = Number.isFinite(card.ledgerBalance) ? Math.max(0, -Math.round(card.ledgerBalance * 100)) : suggestion.amountCents;
    const applications = suggestion.applications.flatMap(application => {
      const amountCents = Math.min(remaining, application.amountCents);
      remaining -= amountCents;
      return amountCents > 0 ? [{ ...application, amountCents }] : [];
    });
    return { ...suggestion, applications, amountCents: applications.reduce((n, a) => n + a.amountCents, 0) };
  }).filter(s => s.amountCents > 0).sort((a, b) => b.amountCents - a.amountCents || a.cardName.localeCompare(b.cardName));
}

export function cardPaymentPreview(dashboard: Pick<DashboardData, "accounts" | "managedCategories" | "activity" | "payments"> & Partial<Pick<DashboardData, "remainingToBudget">>, throughDate: string, sourceAccountId?: string, now = Date.now()) {
  const fundedSuggestions = suggestCardPayments(dashboard, throughDate);
  const affordability = paymentAffordability(dashboard, sourceAccountId, now);
  let remaining = affordability.affordableCents;
  const approved = new Map<string, CardPaymentSuggestion>();
  // One cash limit shared across every card. Use the same oldest-first order
  // across cards as across category funding; never promise the cash twice.
  const ordered = fundedSuggestions.flatMap(card => card.applications.map(application => ({ card, application }))).sort((a, b) => a.application.date.localeCompare(b.application.date) || a.application.transactionId.localeCompare(b.application.transactionId));
  for (const { card, application } of ordered) {
    const amountCents = Math.min(remaining, application.amountCents);
    if (amountCents <= 0) break;
    remaining -= amountCents;
    const suggestion = approved.get(card.cardId) ?? { cardId: card.cardId, cardName: card.cardName, amountCents: 0, applications: [] };
    suggestion.amountCents += amountCents;
    suggestion.applications.push({ ...application, amountCents });
    approved.set(card.cardId, suggestion);
  }
  const fundedCents = fundedSuggestions.reduce((sum, card) => sum + card.amountCents, 0);
  const suggestedCents = affordability.affordableCents - remaining;
  const unmatchedRefundCents = dashboard.managedCategories.reduce((sum, c) => sum + Math.max(0, Math.round((c.unmatchedRefunds ?? 0) * 100)), 0);
  return { ...affordability, unmatchedRefundCents, fundedCents, suggestedCents, shortfallCents: Math.max(0, fundedCents - suggestedCents), cashAfterCents: affordability.cashCents - suggestedCents, fundedSuggestions, suggestions: [...approved.values()] };
}
