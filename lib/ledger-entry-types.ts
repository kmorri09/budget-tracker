export function supportsBudgetCategory(kind: string) {
  return kind === "expense" || kind === "refund";
}

export function ledgerEntryNoun(kind: string) {
  switch (kind) {
    case "income": return "income";
    case "refund": return "refund";
    case "card_payment": return "card payment";
    case "transfer_in":
    case "transfer_out": return "transfer";
    case "adjustment": return "reconciliation adjustment";
    default: return "transaction";
  }
}

export function importedReviewTitle(kind: string, description: string) {
  return `Review imported ${ledgerEntryNoun(kind)}: ${description}`;
}

export function importedReviewDetails(kind: string, fallback: string) {
  switch (kind) {
    case "income": return "Confirm this deposit is income. If it came from another account, change its type to Transfer in instead.";
    case "refund": return "Assign the original spending category, or confirm this refund is already represented in your budget.";
    case "expense": return "Assign a category or confirm this imported activity is already represented in your budget.";
    case "adjustment": return "Confirm this is a reconciliation adjustment rather than income or spending.";
    case "card_payment": return "Confirm this is a card payment rather than new spending.";
    default: return fallback;
  }
}
