export type RefundTransaction = { id: string; accountId: string; categoryId: string | null; kind: string; amountCents: number; effectiveDate: string; description: string; status: string; pending: boolean };
export type RefundDecision = { refundId: string; transactionId: string; amountCents: number; status: string };
export type RefundLink = { refundId: string; transactionId: string; amountCents: number; confidence: "automatic" | "confirmed" };

const merchant = (description: string) => description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const posted = (row: RefundTransaction, date: string) => row.status === "posted" && !row.pending && row.effectiveDate <= date;

// Recomputed for old and new entries alike. Removed/edited transactions cannot
// leave a stale link affecting coverage. Ambiguous matches require a decision.
export function matchCardRefunds(rows: RefundTransaction[], cardIds: Set<string>, decisions: RefundDecision[], throughDate: string) {
  const purchases = rows.filter(row => row.kind === "expense" && cardIds.has(row.accountId) && posted(row, throughDate)).sort((a, b) => a.id.localeCompare(b.id));
  const refunds = rows.filter(row => row.kind === "refund" && cardIds.has(row.accountId) && posted(row, throughDate)).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id));
  const remaining = new Map(purchases.map(row => [row.id, row.amountCents]));
  const credit = new Map(refunds.map(row => [row.id, row.amountCents]));
  const links: RefundLink[] = [];
  const dismissed = new Set(decisions.filter(d => d.status === "dismissed").map(d => `${d.refundId}:${d.transactionId}`));
  function eligible(refund: RefundTransaction, purchase: RefundTransaction) {
    return refund.accountId === purchase.accountId && purchase.effectiveDate <= refund.effectiveDate && !dismissed.has(`${refund.id}:${purchase.id}`);
  }
  function apply(refundId: string, transactionId: string, amountCents: number, confidence: RefundLink["confidence"]) {
    const amount = Math.min(amountCents, credit.get(refundId) ?? 0, remaining.get(transactionId) ?? 0);
    if (amount <= 0) return;
    links.push({ refundId, transactionId, amountCents: amount, confidence });
    credit.set(refundId, credit.get(refundId)! - amount);
    remaining.set(transactionId, remaining.get(transactionId)! - amount);
  }
  for (const decision of decisions.filter(d => d.status === "confirmed").sort((a, b) => `${a.refundId}:${a.transactionId}`.localeCompare(`${b.refundId}:${b.transactionId}`))) {
    const refund = refunds.find(row => row.id === decision.refundId), purchase = purchases.find(row => row.id === decision.transactionId);
    if (refund && purchase && eligible(refund, purchase)) apply(refund.id, purchase.id, decision.amountCents, "confirmed");
  }
  const candidates = (refund: RefundTransaction) => purchases.filter(purchase => eligible(refund, purchase) && (remaining.get(purchase.id) ?? 0) > 0 && merchant(refund.description) !== "" && merchant(purchase.description) === merchant(refund.description) && purchase.categoryId === refund.categoryId);
  // Exact matches first; then a partial refund only when one purchase remains.
  // Mutual uniqueness prevents two refunds claiming the same purchase by chance.
  for (const exactOnly of [true, false]) {
    const proposals = refunds.filter(r => (credit.get(r.id) ?? 0) > 0 && !decisions.some(d => d.refundId === r.id && d.status === "confirmed")).flatMap(refund => {
      const choices = candidates(refund).filter(p => !exactOnly || remaining.get(p.id) === credit.get(refund.id));
      return choices.length === 1 ? [{ refund, purchase: choices[0] }] : [];
    });
    for (const { refund, purchase } of proposals) {
      if (proposals.filter(p => p.purchase.id === purchase.id).length !== 1) continue;
      apply(refund.id, purchase.id, credit.get(refund.id)!, "automatic");
    }
  }
  return { links, refunds: refunds.map(refund => ({ ...refund, remainingCents: credit.get(refund.id) ?? 0, links: links.filter(link => link.refundId === refund.id), candidates: candidates(refund).map(p => ({ ...p, remainingCents: remaining.get(p.id) ?? 0 })) })) };
}

export function calculateCardPurchaseCoverage(rows: RefundTransaction[], cardIds: Set<string>, decisions: RefundDecision[], payments: { transactionId: string; amountCents: number }[], throughDate: string) {
  const refunds = matchCardRefunds(rows, cardIds, decisions, throughDate);
  const coverage = new Map<string, { refundedCents: number; paidCents: number; cardCreditCents: number; remainingCents: number; status: string }>();
  const creditByCard = new Map<string, number>();
  for (const refund of refunds.refunds) creditByCard.set(refund.accountId, (creditByCard.get(refund.accountId) ?? 0) + refund.remainingCents);
  const purchases = rows.filter(row => row.kind === "expense" && row.status !== "removed" && row.status !== "void" && cardIds.has(row.accountId)).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id));
  for (const purchase of purchases) {
    const refundedCents = refunds.links.filter(link => link.transactionId === purchase.id).reduce((sum, link) => sum + link.amountCents, 0);
    const paidCents = Math.min(purchase.amountCents, Math.max(0, payments.filter(p => p.transactionId === purchase.id).reduce((sum, p) => sum + p.amountCents, 0)));
    const excess = Math.max(0, paidCents + refundedCents - purchase.amountCents);
    creditByCard.set(purchase.accountId, (creditByCard.get(purchase.accountId) ?? 0) + excess);
    coverage.set(purchase.id, { refundedCents, paidCents, cardCreditCents: 0, remainingCents: Math.max(0, purchase.amountCents - refundedCents - paidCents), status: "Unpaid" });
  }
  for (const purchase of purchases) {
    const item = coverage.get(purchase.id)!;
    // Posted card credits can cover other posted purchases on this card, even
    // when the refunded purchase had already been paid. Cash is never invented.
    if (posted(purchase, throughDate)) {
      item.cardCreditCents = Math.min(item.remainingCents, creditByCard.get(purchase.accountId) ?? 0);
      item.remainingCents -= item.cardCreditCents;
      creditByCard.set(purchase.accountId, (creditByCard.get(purchase.accountId) ?? 0) - item.cardCreditCents);
    }
    item.status = item.refundedCents >= purchase.amountCents ? "Refunded" : item.remainingCents === 0 ? "Paid" : item.refundedCents > 0 ? "Partially refunded" : item.paidCents + item.cardCreditCents > 0 ? "Partially paid" : "Unpaid";
  }
  return { coverage, refunds, creditByCard };
}
