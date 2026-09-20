"use client";

import { useEffect, useId, useRef } from "react";
import { suggestCardPayments, type CardPaymentSuggestion } from "../../lib/card-payment-suggestions";
import { money, today, type DashboardData } from "../../lib/workspace-types";

export default function SuggestCardPaymentDialog({ dashboard, onClose, onChoose }: { dashboard: DashboardData; onClose: () => void; onChoose: (suggestion: CardPaymentSuggestion) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const suggestions = suggestCardPayments(dashboard, today());
  const hasCashAccount = dashboard.accounts.some(account => account.type !== "credit_card" && account.active);
  const totalSuggestedCents = suggestions.reduce((sum, suggestion) => sum + suggestion.amountCents, 0);
  const cashLedgerCents = dashboard.accounts.filter(account => account.type !== "credit_card" && account.active).reduce((sum, account) => sum + Math.max(0, Math.round(account.ledgerBalance * 100)), 0);

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={dialog} className="entry-dialog suggested-payment-dialog" aria-labelledby={titleId} onCancel={onClose}>
    <div className="modal-top"><div><p className="eyebrow">Card payment preview</p><h2 id={titleId}>Suggest card payment</h2></div><button type="button" className="close-button" aria-label="Close suggestions" onClick={onClose}>×</button></div>
    <p className="field-help">These amounts use posted, unpaid card charges and each category&apos;s current funding. Older charges receive coverage first, and recorded payments that have not been applied yet reduce the suggestion. Review the source account and amount before recording a payment.</p>
    {suggestions.length ? <div className="suggested-payment-list">{suggestions.map(suggestion => <article className="suggested-payment-card" key={suggestion.cardId}>
      <div className="suggested-payment-heading"><div><h3>{suggestion.cardName}</h3><p>{suggestion.applications.length} {suggestion.applications.length === 1 ? "charge" : "charges"} covered by category funding</p></div><strong>{money(suggestion.amountCents / 100)}</strong></div>
      {hasCashAccount && !dashboard.accounts.some(account => account.active && account.type !== "credit_card" && account.ledgerBalance >= suggestion.amountCents / 100) && <p className="form-warning">No single cash account shows enough ledger balance for this full amount. Review the purchase amounts and reduce them if needed.</p>}
      <details><summary>View suggested charges</summary><ul>{suggestion.applications.map(application => <li key={application.transactionId}><span><strong>{application.description}</strong><small>{application.date} · {application.category}</small></span><strong>{money(application.amountCents / 100)}</strong></li>)}</ul></details>
      <button type="button" className="primary-button" disabled={!hasCashAccount} onClick={() => onChoose(suggestion)}>Review payment</button>
    </article>)}</div> : <p className="empty-state">No posted card charges have category funding available for a new payment right now. Check category funding, uncategorized charges, or existing unapplied card payments.</p>}
    {hasCashAccount && totalSuggestedCents > cashLedgerCents && <p className="form-warning">Together, these suggestions exceed the positive cash ledger balances shown in your accounts. Review your source account before recording any payment.</p>}
    {!hasCashAccount && <p className="form-warning">Create a checking or savings account before recording a card payment.</p>}
    <div className="form-footer"><button type="button" className="secondary-button" onClick={onClose}>Close</button></div>
  </dialog>;
}
