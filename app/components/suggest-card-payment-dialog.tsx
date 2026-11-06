"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cardPaymentPreview, type CardPaymentSuggestion } from "../../lib/card-payment-suggestions";
import { money, today, type DashboardData } from "../../lib/workspace-types";
import styles from "./suggest-card-payment-dialog.module.css";

export default function SuggestCardPaymentDialog({ dashboard, skippedPurchaseIds, onSkippedPurchasesChange, onClose, onChoose }: { dashboard: DashboardData; skippedPurchaseIds: ReadonlySet<string>; onSkippedPurchasesChange: (ids: Set<string>) => void; onClose: () => void; onChoose: (suggestion: CardPaymentSuggestion) => void }) {
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
  const preview = cardPaymentPreview(data, today(), sourceId, undefined, skippedPurchaseIds);
  const source = preview.accounts.find(account => account.accountId === sourceId);
  const cashLimited = preview.shortfallCents > 0;
  const protectedCategories = data.managedCategories.filter(category => (category.cashReserve ?? 0) > 0 || (category.obligationReserve ?? 0) > 0);
  const eligiblePurchases = preview.fundedSuggestions.flatMap(card => card.applications);
  const includedPurchases = preview.suggestions.flatMap(card => card.applications);
  const skippedPurchases = data.activity.filter(entry => skippedPurchaseIds.has(entry.id) && entry.remainingToPay > 0);
  function restorePurchase(id: string) {
    const next = new Set(skippedPurchaseIds);
    next.delete(id);
    onSkippedPurchasesChange(next);
  }
  return <dialog ref={dialog} className="entry-dialog suggested-payment-dialog" aria-labelledby={titleId} onCancel={onClose}>
    <div className="modal-top"><div><p className="eyebrow">Card payment preview</p><h2 id={titleId}>Suggest card payment</h2></div><button type="button" className="close-button" aria-label="Close suggestions" onClick={onClose}>×</button></div>
    <section className={styles.result} aria-label="Suggested payment total">
      <p className={styles.kicker}>Suggested total across all cards</p>
      <strong className={styles.total} aria-live="polite">{money(preview.suggestedCents / 100)}</strong>
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
          <small>Cash left after protecting category balances, active obligations, and unassigned money, limited to the selected account. Shared across all cards.</small>
        </section>
      </div>
      {cashLimited && <p className={styles.deferred} role="status"><strong>{money(preview.shortfallCents / 100)} of eligible purchases must wait.</strong> They pass the category check, but there is not enough cash left to include them while protecting your other budget money.</p>}
      {preview.obligationShortfallCents > 0 && <p className={styles.deferred}><strong>{money(preview.obligationShortfallCents / 100)} in active obligations still needs category funding.</strong> The cash check accounts for this gap before suggesting card payments.</p>}
      <p className={styles.rule}>Suggestions use only money already allocated. Reviewing or recording a suggestion leaves allocations unchanged.</p>
      {protectedCategories.length > 0 && <details className={styles.calculation}>
        <summary>Cash reserves by category</summary>
        <p>Category balances already deduct card purchases. Eligible purchases can use the funding for those charges while the cash reserve stays protected.</p>
        {protectedCategories.map(category => {
          const eligibleCents = eligiblePurchases.filter(purchase => purchase.categoryId === category.id).reduce((sum, purchase) => sum + purchase.amountCents, 0);
          const includedCents = includedPurchases.filter(purchase => purchase.categoryId === category.id).reduce((sum, purchase) => sum + purchase.amountCents, 0);
          return <section key={category.id} className={styles.reserveCategory}>
            <h4>{category.name}</h4>
            <dl className="payment-summary">
              <div><dt>Protected cash reserve</dt><dd>{money(category.cashReserve ?? 0)}</dd></div>
              {!!category.obligationReserve && <div><dt>Active obligation reserve target</dt><dd>{money(category.obligationReserve)}</dd></div>}
              {!!category.cashReserveShortfall && <div><dt>Reserve funding shortfall</dt><dd>{money(category.cashReserveShortfall)}</dd></div>}
              <div><dt>Eligible card purchases before the cash check</dt><dd>{money(eligibleCents / 100)}</dd></div>
              <div><dt>Included in suggested payments</dt><dd>{money(includedCents / 100)}</dd></div>
            </dl>
          </section>;
        })}
      </details>}
      <details className={styles.calculation}>
        <summary>How the cash limit is calculated</summary>
        <dl className="payment-summary">
          <div><dt>Cash across accounts, after pending withdrawals</dt><dd>{money(preview.cashCents / 100)}</dd></div>
          <div><dt>Less: protected category balances</dt><dd>−{money(preview.reservedCents / 100)}</dd></div>
          <div><dt>Less: unassigned money kept untouched</dt><dd>−{money(preview.unassignedCents / 100)}</dd></div>
          {preview.additionalObligationHoldCents > 0 && <div><dt>Less: additional cash held for unfunded obligations</dt><dd>−{money(preview.additionalObligationHoldCents / 100)}</dd></div>}
          <div className={styles.subtotal}><dt>Cash limit across all accounts</dt><dd>{money(preview.totalAffordableCents / 100)}</dd></div>
          <div><dt>Available in {source?.name ?? "selected account"}</dt><dd>{money((source?.availableCents ?? 0) / 100)}</dd></div>
          <div className={styles.subtotal}><dt>Cash limit using this account</dt><dd>{money(preview.affordableCents / 100)}</dd></div>
        </dl>
        <p>The lower of the all-account limit and the selected account’s balance applies. Neither amount creates a new allocation.</p>
        <div className={styles.cashAfter}><span>Cash remaining after all suggested payments</span><strong>{money(preview.cashAfterCents / 100)}</strong></div>
        <p>This remaining cash includes protected category balances and unassigned money; it is not extra spending money.</p>
      </details>
    </section>
    {preview.unmatchedRefundCents > 0 && <p className="form-warning">{money(preview.unmatchedRefundCents / 100)} in unmatched refunds is excluded from cash funding. Those credits already reduce card debt. Review their original purchases in Reviews → Refunds to review.</p>}
    {preview.needsBankVerification && <p className="form-warning">Some accounts have no recent bank-reported available balance. Their ledger balances are used conservatively. Verify availability with your bank before paying.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {refreshing && <p className="field-help" role="status">Refreshing balances and refund coverage…</p>}
    <h3 className={styles.paymentsTitle}>Payments to review</h3>
    <p className={styles.intro}>Skip a charge to give other eligible purchases in its category a turn. Older eligible purchases receive cash first.</p>
    {skippedPurchaseIds.size > 0 && <div className="suggested-payment-card">
      <div className="suggested-payment-heading"><div><h3>Skipped purchases</h3><p>Skipped while this page is open. Restore a purchase to include it in suggestions again.</p></div><button type="button" className="text-link" onClick={() => onSkippedPurchasesChange(new Set())}>Restore all</button></div>
      {!!skippedPurchases.length && <ul>{skippedPurchases.map(purchase => <li key={purchase.id}>
        <span><strong>{purchase.description}</strong><small>{purchase.date} · {purchase.category} · {purchase.account}</small></span>
        <button type="button" className="text-link" aria-label={`Restore ${purchase.description}`} onClick={() => restorePurchase(purchase.id)}>Restore</button>
      </li>)}</ul>}
    </div>}
    <div className="suggested-payment-list">{preview.fundedSuggestions.map(funded => {
      const suggestion = preview.suggestions.find(s => s.cardId === funded.cardId);
      const deferred = funded.applications.flatMap(application => {
        const includedCents = suggestion?.applications.find(a => a.transactionId === application.transactionId)?.amountCents ?? 0;
        const amountCents = application.amountCents - includedCents;
        return amountCents > 0 ? [{ ...application, amountCents }] : [];
      });
      return <article className="suggested-payment-card" key={funded.cardId}>
        <div className="suggested-payment-heading"><div><h3>{funded.cardName}</h3><p>Eligible purchases before cash check: {money(funded.amountCents / 100)}</p></div><strong>{suggestion?.amountCents ? `Suggest ${money(suggestion.amountCents / 100)}` : "No payment suggested"}</strong></div>
        {!!suggestion?.applications.length && <details><summary>View charges included in this payment</summary><ul>{suggestion.applications.map(application => <li key={application.transactionId}>
          <span><strong>{application.description}</strong><small>{application.date} · {application.category}</small></span>
          <span className={styles.purchaseActions}><strong>{money(application.amountCents / 100)}</strong><button type="button" className="text-link" aria-label={`Skip ${application.description}`} onClick={() => onSkippedPurchasesChange(new Set(skippedPurchaseIds).add(application.transactionId))}>Skip</button></span>
        </li>)}</ul></details>}
        {!!deferred.length && <details><summary>Deferred by cash limit ({deferred.length})</summary><p className="field-help">These amounts are not included in this payment. The shared cash limit is assigned to older charges first.</p><ul>{deferred.map(application => <li key={application.transactionId}><span><strong>{application.description}</strong><small>{application.date} · {application.category} · deferred</small></span><strong>{money(application.amountCents / 100)} deferred</strong></li>)}</ul></details>}

        <button type="button" className="primary-button" disabled={refreshing || Boolean(error) || !suggestion?.amountCents} onClick={() => suggestion && onChoose({ ...suggestion, sourceAccountId: sourceId })}>Review payment</button>
      </article>;
    })}</div>
    {!preview.fundedSuggestions.length && <p className="empty-state">{skippedPurchaseIds.size ? "No eligible purchases remain after your skips." : "No posted purchases currently need a funded payment after refunds, card credits, and prior payments."}</p>}
    <div className="form-footer"><button className="secondary-button" disabled={refreshing} onClick={() => void refresh()}>Refresh</button><button className="secondary-button" onClick={onClose}>Close</button></div>
  </dialog>;
}
