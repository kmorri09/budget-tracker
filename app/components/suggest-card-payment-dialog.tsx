"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cardPaymentPreview, type CardPaymentSuggestion } from "../../lib/card-payment-suggestions";
import { money, today, type DashboardData } from "../../lib/workspace-types";
import styles from "./suggest-card-payment-dialog.module.css";

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
  const source = preview.accounts.find(account => account.accountId === sourceId);
  const cashLimited = preview.shortfallCents > 0;
  return <dialog ref={dialog} className="entry-dialog suggested-payment-dialog" aria-labelledby={titleId} onCancel={onClose}>
    <div className="modal-top"><div><p className="eyebrow">Card payment preview</p><h2 id={titleId}>Suggest card payment</h2></div><button type="button" className="close-button" aria-label="Close suggestions" onClick={onClose}>×</button></div>
    <section className={styles.result} aria-label="Suggested payment total">
      <p className={styles.kicker}>Suggested total across all cards</p>
      <strong className={styles.total}>{money(preview.suggestedCents / 100)}</strong>
      <p>{cashLimited ? "Available cash limits this suggestion. Some eligible purchases must wait." : preview.suggestedCents > 0 ? "These purchases pass both the category allocation and cash checks." : "No payment passes both checks right now."}</p>
      <label>Pay from<select value={sourceId} onChange={event => setSourceId(event.target.value)}>{data.accounts.filter(a => a.active && a.type !== "credit_card").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    </section>
    <section className={styles.explanation} aria-label="How the suggestion is calculated">
      <h3>Two checks determine the suggestion</h3>
      <p className={styles.intro}>The suggested total is the smaller of these two amounts.</p>
      <div className={styles.checks}>
        <section className={styles.check} aria-label="Category allocation check">
          <h4><span>1</span> Category allocation check</h4>
          <strong>{money(preview.fundedCents / 100)}</strong>
          <p>Eligible unpaid purchases</p>
          <small>Unpaid card spending covered by existing category allocations, after refunds and prior payments. This is not a bank balance.</small>
        </section>
        <section className={styles.check} aria-label="Cash check">
          <h4><span>2</span> Cash check</h4>
          <strong>{money(preview.affordableCents / 100)}</strong>
          <p>Cash limit for card payments</p>
          <small>Cash left after protecting other category balances and unassigned money, limited to the selected account. Shared across all cards.</small>
        </section>
      </div>
      {cashLimited && <p className={styles.deferred} role="status"><strong>{money(preview.shortfallCents / 100)} of eligible purchases must wait.</strong> They pass the category check, but there is not enough cash left to include them while protecting your other budget money.</p>}
      <p className={styles.rule}>Suggestions use only money already allocated. Reviewing or recording a suggestion leaves allocations unchanged.</p>
      <details className={styles.calculation}>
        <summary>How the cash limit is calculated</summary>
        <dl className="payment-summary">
          <div><dt>Cash across accounts, after pending withdrawals</dt><dd>{money(preview.cashCents / 100)}</dd></div>
          <div><dt>Less: protected category balances</dt><dd>−{money(preview.reservedCents / 100)}</dd></div>
          <div><dt>Less: unassigned money kept untouched</dt><dd>−{money(preview.unassignedCents / 100)}</dd></div>
          <div className={styles.subtotal}><dt>Cash limit across all accounts</dt><dd>{money(preview.totalAffordableCents / 100)}</dd></div>
          <div><dt>Available in {source?.name ?? "selected account"}</dt><dd>{money((source?.availableCents ?? 0) / 100)}</dd></div>
          <div className={styles.subtotal}><dt>Cash limit using this account</dt><dd>{money(preview.affordableCents / 100)}</dd></div>
        </dl>
        <p>The lower of the all-account limit and the selected account’s balance applies. Neither amount creates a new allocation.</p>
        <div className={styles.cashAfter}><span>Cash remaining after all suggested payments</span><strong>{money(preview.cashAfterCents / 100)}</strong></div>
        <p>This remaining cash includes protected category balances and unassigned money; it is not extra spending money.</p>
      </details>
    </section>
    {preview.unmatchedRefundCents > 0 && <p className="form-warning">{money(preview.unmatchedRefundCents / 100)} in unmatched refunds is excluded from cash funding. Those credits already reduce card debt. Review their original purchases in Card payments → Refunds to review.</p>}
    {preview.needsBankVerification && <p className="form-warning">Some accounts have no recent bank-reported available balance. Their ledger balances are used conservatively. Verify availability with your bank before paying.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {refreshing && <p className="field-help" role="status">Refreshing balances and refund coverage…</p>}
    <h3 className={styles.paymentsTitle}>Payments to review</h3>
    <p className={styles.intro}>The suggested total is split below. Older eligible purchases receive cash first.</p>
    <div className="suggested-payment-list">{preview.fundedSuggestions.map(funded => {
      const suggestion = preview.suggestions.find(s => s.cardId === funded.cardId);
      const deferred = funded.applications.flatMap(application => {
        const includedCents = suggestion?.applications.find(a => a.transactionId === application.transactionId)?.amountCents ?? 0;
        const amountCents = application.amountCents - includedCents;
        return amountCents > 0 ? [{ ...application, amountCents }] : [];
      });
      return <article className="suggested-payment-card" key={funded.cardId}>
        <div className="suggested-payment-heading"><div><h3>{funded.cardName}</h3><p>Eligible purchases before cash check: {money(funded.amountCents / 100)}</p></div><strong>{suggestion?.amountCents ? `Suggest ${money(suggestion.amountCents / 100)}` : "No payment suggested"}</strong></div>
        {!!suggestion?.applications.length && <details><summary>View charges included in this payment</summary><ul>{suggestion.applications.map(application => <li key={application.transactionId}><span><strong>{application.description}</strong><small>{application.date} · {application.category}</small></span><strong>{money(application.amountCents / 100)}</strong></li>)}</ul></details>}
        {!!deferred.length && <details><summary>Deferred by cash limit ({deferred.length})</summary><p className="field-help">These amounts are not included in this payment. The shared cash limit is assigned to older charges first.</p><ul>{deferred.map(application => <li key={application.transactionId}><span><strong>{application.description}</strong><small>{application.date} · {application.category} · deferred</small></span><strong>{money(application.amountCents / 100)} deferred</strong></li>)}</ul></details>}

        <button type="button" className="primary-button" disabled={refreshing || Boolean(error) || !suggestion?.amountCents} onClick={() => suggestion && onChoose({ ...suggestion, sourceAccountId: sourceId })}>Review payment</button>
      </article>;
    })}</div>
    {!preview.fundedSuggestions.length && <p className="empty-state">No posted purchases currently need a funded payment after refunds, card credits, and prior payments.</p>}
    <div className="form-footer"><button className="secondary-button" disabled={refreshing} onClick={() => void refresh()}>Refresh</button><button className="secondary-button" onClick={onClose}>Close</button></div>
  </dialog>;
}
