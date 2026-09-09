"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { money, type DashboardData } from "../../lib/workspace-types";

export default function CardPaymentEditDialog({ payment, dashboard, onClose, onSaved }: { payment: DashboardData["payments"][number]; dashboard: DashboardData; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(payment.amount.toFixed(2));
  const [date, setDate] = useState(payment.date);
  const [toAccountId, setToAccountId] = useState(payment.toAccountId);
  const [applications, setApplications] = useState<Record<string, string>>(Object.fromEntries(payment.applications.map(application => [application.transactionId, application.amount.toFixed(2)])));
  const currentByTransaction = useMemo(() => new Map(payment.applications.map(application => [application.transactionId, application.amount])), [payment.applications]);
  const purchases = dashboard.activity.filter(entry => entry.kind === "expense" && entry.accountId === toAccountId && entry.date <= date && entry.remainingToPay + (currentByTransaction.get(entry.id) ?? 0) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const applied = Object.values(applications).reduce((sum, value) => sum + (Number(value) || 0), 0);

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  async function removePayment(suppressProviderTransaction = false) {
    const effect = payment.providerLinked ? suppressProviderTransaction ? "Its linked bank activity will also be ignored without letting Plaid import it again." : "Its linked bank activity will return to Review as transfers." : "Its purchase applications will be reversed and both account balances will be updated.";
    if (!window.confirm(`Delete “${payment.description}”? ${effect}`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/card-payments", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: payment.id, suppressProviderTransaction }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not delete card payment.");
      onSaved(result?.suppressedProviderTransaction ? "Card payment and linked bank activity removed" : result?.restoredProviderTransaction ? "Card payment deleted; linked bank activity returned to Review" : "Card payment deleted");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete card payment."); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="entry-dialog coverage-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Manual control</p><h2 id={titleId}>Edit card payment</h2></div><button type="button" className="close-button" aria-label="Close card payment editor" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Editing the payment updates its two account balances. Purchase applications control which card transactions are marked paid.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const selectedApplications = Object.entries(applications).filter(([, value]) => Number(value) > 0).map(([transactionId, value]) => ({ transactionId, amount: Number(value) }));
      try {
        const response = await fetch("/api/card-payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: payment.id, description: values.description, amount, date, fromAccountId: values.fromAccountId, toAccountId, applications: selectedApplications }) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not update card payment.");
        onSaved("Card payment updated");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update card payment."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label>Description<input name="description" defaultValue={payment.description} required maxLength={200} autoFocus /></label>
        <div className="form-grid"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></label><label>Date<input name="date" type="date" value={date} onChange={event => { const nextDate = event.target.value; setDate(nextDate); setApplications(current => Object.fromEntries(Object.entries(current).filter(([transactionId]) => dashboard.activity.find(entry => entry.id === transactionId)?.date && dashboard.activity.find(entry => entry.id === transactionId)!.date <= nextDate))); }} required /></label></div>
        <div className="form-grid"><label>From account<select name="fromAccountId" defaultValue={payment.fromAccountId} required>{dashboard.accounts.filter(account => account.type !== "credit_card").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>To credit card<select name="toAccountId" value={toAccountId} onChange={event => { setToAccountId(event.target.value); setApplications({}); }} required>{dashboard.accounts.filter(account => account.type === "credit_card").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
        <div className="payment-allocations"><p className="field-help">Applied {money(applied)} of {money(Number(amount) || 0)}. Clear an amount to unapply that purchase.</p>{purchases.map(entry => {
          const maximum = entry.remainingToPay + (currentByTransaction.get(entry.id) ?? 0);
          return <div className="payment-allocation-row" key={entry.id}><span><strong>{entry.description}</strong><small>{entry.date} · {entry.paymentStatus} · up to {money(maximum)}</small></span><span className="payment-allocation-controls"><input aria-label={`Amount applied to ${entry.description}`} type="number" min="0.01" max={maximum} step="0.01" placeholder="0.00" value={applications[entry.id] ?? ""} onChange={event => setApplications(current => ({ ...current, [entry.id]: event.target.value }))} /><button className="secondary-button" type="button" onClick={() => setApplications(current => ({ ...current, [entry.id]: maximum.toFixed(2) }))}>Full amount</button></span></div>;
        })}{!purchases.length && <p className="empty-state">No eligible purchases for this card and date.</p>}</div>
      </fieldset>
      {payment.providerLinked && <p className="field-help">This payment is linked to Plaid activity on one or both accounts. Editing preserves those links. If that activity is already in a starting balance, delete and ignore it; otherwise return it to Review.</p>}
      {applied > (Number(amount) || 0) && <p className="form-error">Applied purchases exceed the payment amount.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer">{payment.providerLinked ? <><button type="button" className="danger-button" disabled={busy} onClick={() => void removePayment(true)}>Delete &amp; ignore bank activity</button><button type="button" className="text-link" disabled={busy} onClick={() => void removePayment(false)}>Delete; return activity to Review</button></> : <button type="button" className="danger-button" disabled={busy} onClick={() => void removePayment()}>Delete payment</button>}<button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || applied > (Number(amount) || 0)}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </dialog>;
}
