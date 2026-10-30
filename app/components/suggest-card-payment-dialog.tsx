"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cardPaymentPreview, type CardPaymentSuggestion } from "../../lib/card-payment-suggestions";
import { money, today, type DashboardData } from "../../lib/workspace-types";

export default function SuggestCardPaymentDialog({ dashboard, onClose, onChoose }: { dashboard: DashboardData; onClose: () => void; onChoose: (suggestion: CardPaymentSuggestion) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState(dashboard);
  const [sourceId, setSourceId] = useState(dashboard.accounts.find(a => a.active && a.type !== "credit_card" && a.isDefaultCash)?.id ?? dashboard.accounts.find(a => a.active && a.type !== "credit_card")?.id ?? "");
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not refresh your budget. Retry before reviewing a payment.");
      setData(await response.json()); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not refresh your budget."); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); node?.close(); document.body.style.overflow = previousOverflow; };
  }, [refresh]);
  const preview = cardPaymentPreview(data, today(), sourceId);
  return <dialog ref={dialog} className="entry-dialog suggested-payment-dialog" aria-labelledby={titleId} onCancel={onClose}>
    <div className="modal-top"><div><p className="eyebrow">Card payment preview</p><h2 id={titleId}>Suggest card payment</h2></div><button type="button" className="close-button" aria-label="Close suggestions" onClick={onClose}>×</button></div>
    <p className="field-help">Refunds and prior payments reduce what is owed. Suggestions protect the money remaining in your other categories and share one cash limit across all cards. Funded obligations are already included in those category balances.</p>
    <label>Pay from<select value={sourceId} onChange={event => setSourceId(event.target.value)}>{data.accounts.filter(a => a.active && a.type !== "credit_card").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <dl className="payment-summary"><div><dt>Cash across accounts, including pending withdrawals</dt><dd>{money(preview.cashCents / 100)}</dd></div><div><dt>Protected in other categories</dt><dd>{money(preview.reservedCents / 100)}</dd></div><div><dt>Unassigned budget money kept available</dt><dd>{money(preview.unassignedCents / 100)}</dd></div><div><dt>Available for payments from this account</dt><dd>{money(preview.affordableCents / 100)}</dd></div><div><dt>Unpaid purchases backed by category funding</dt><dd>{money(preview.fundedCents / 100)}</dd></div><div><dt>Total suggested now</dt><dd>{money(preview.suggestedCents / 100)}</dd></div><div><dt>Cash after all suggestions</dt><dd>{money(preview.cashAfterCents / 100)}</dd></div></dl>
    {preview.shortfallCents > 0 && <p className="form-warning" role="status">Suggestions were reduced by {money(preview.shortfallCents / 100)} to protect other allocations and stay within the source account. Reallocate funds before paying more.</p>}
    {preview.needsBankVerification && <p className="form-warning">Some accounts have no recent bank-reported available balance. Their ledger balances are used conservatively. Verify availability with your bank before paying.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {refreshing && <p className="field-help" role="status">Refreshing balances and refund coverage…</p>}
    <div className="suggested-payment-list">{preview.fundedSuggestions.map(funded => {
      const suggestion = preview.suggestions.find(s => s.cardId === funded.cardId);
      return <article className="suggested-payment-card" key={funded.cardId}>
        <div className="suggested-payment-heading"><div><h3>{funded.cardName}</h3><p>Category funding: {money(funded.amountCents / 100)}</p></div><strong>Suggest {money((suggestion?.amountCents ?? 0) / 100)}</strong></div>
        <details><summary>View charges after refunds and payments</summary><ul>{funded.applications.map(application => <li key={application.transactionId}><span><strong>{application.description}</strong><small>{application.date} · {application.category} · funded {money(application.amountCents / 100)}</small></span><strong>{money((suggestion?.applications.find(a => a.transactionId === application.transactionId)?.amountCents ?? 0) / 100)} now</strong></li>)}</ul></details>
        <button type="button" className="primary-button" disabled={refreshing || Boolean(error) || !suggestion?.amountCents} onClick={() => suggestion && onChoose({ ...suggestion, sourceAccountId: sourceId })}>Review payment</button>
      </article>;
    })}</div>
    {!preview.fundedSuggestions.length && <p className="empty-state">No posted purchases currently need a funded payment after refunds, card credits, and prior payments.</p>}
    <div className="form-footer"><button className="secondary-button" disabled={refreshing} onClick={() => void refresh()}>Refresh</button><button className="secondary-button" onClick={onClose}>Close</button></div>
  </dialog>;
}
