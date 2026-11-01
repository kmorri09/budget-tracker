// Purchases alone are never credits. Incoming statement benefits stay in Dining.
export function isDiningBenefitDescription(description: string) {
  const name = description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return /\b(?:amex|american express) (?:dining|dunkin|grubhub) credit\b/.test(name)
    || /^(?:dining|dunkin|grubhub) (?:statement )?credit\b/.test(name)
    || /\bdunkin(?: donuts)?\b/.test(name) || /\bgrubhub\b/.test(name);
}

export function isDiningBenefitCredit(entry: { kind: string; description: string }) {
  return ["refund", "income", "transfer_in", "adjustment"].includes(entry.kind) && isDiningBenefitDescription(entry.description);
}
