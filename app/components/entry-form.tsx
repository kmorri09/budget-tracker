"use client";

import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { type ActionType, type DashboardData, today } from "../../lib/workspace-types";

export const actionLabels: Record<ActionType, string> = { transaction: "Add transaction", income: "Add income", allocation: "Allocate money", transfer: "Move category funds", payment: "Record card payment", category: "Add category", account: "Add account" };

// Native datalists support typing, keyboard selection, and the phone's own picker.
function Suggestion({ label, name, options, initial = "", value, onChange }: { label: string; name: string; options: string[]; initial?: string; value?: string; onChange?: (value: string) => void }) {
  const id = useId();
  return <label>{label}<input name={name} list={id} {...(value === undefined ? { defaultValue: initial } : { value, onChange: event => onChange?.(event.target.value) })} placeholder="Type to find…" autoComplete="off" required onChange={event => { event.target.setCustomValidity(""); onChange?.(event.target.value); }} onBlur={event => event.target.setCustomValidity(options.includes(event.target.value) ? "" : "Choose an existing option from the list.")} /><datalist id={id}>{options.map(option => <option key={option} value={option} />)}</datalist></label>;
}

export default function EntryForm({ action, dashboard, initialPaymentTransactionIds = [], onClose, onSaved }: { action: ActionType; dashboard: DashboardData; initialPaymentTransactionIds?: string[]; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const categoryNames = dashboard.categories.map(c => c.name);
  const accountNames = dashboard.accounts.map(a => a.name);
  const cashAccountNames = dashboard.accounts.filter(account => account.type !== "credit_card").map(account => account.name);
  const creditCardNames = dashboard.accounts.filter(account => account.type === "credit_card").map(account => account.name);
  const initialPaymentEntries = dashboard.activity.filter(entry => initialPaymentTransactionIds.includes(entry.id) && entry.remainingToPay > 0);
  const initialPaymentCard = initialPaymentEntries[0]?.account ?? (creditCardNames.length === 1 ? creditCardNames[0] : "");
  const initialApplications = Object.fromEntries(initialPaymentEntries.map(entry => [entry.id, entry.remainingToPay.toFixed(2)]));
  const initialPaymentAmount = initialPaymentEntries.reduce((sum, entry) => sum + entry.remainingToPay, 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualPayment, setManualPayment] = useState(initialPaymentEntries.length > 0);
  const [toCard, setToCard] = useState(initialPaymentCard);
  const [applicationAmounts, setApplicationAmounts] = useState<Record<string, string>>(initialApplications);
  const [paymentAmount, setPaymentAmount] = useState(initialPaymentAmount > 0 ? initialPaymentAmount.toFixed(2) : "");
  const budgetOnly = action === "allocation" || action === "transfer";
  const needsCategory = ["transaction", "allocation", "transfer"].includes(action);
  const missing = action === "payment"
    ? !cashAccountNames.length || !creditCardNames.length
    : !["account", "category"].includes(action) && ((!budgetOnly && !accountNames.length) || (needsCategory && !categoryNames.length));
  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  function updateApplication(transactionId: string, value: string) {
    const next = { ...applicationAmounts, [transactionId]: value };
    setApplicationAmounts(next);
    const total = Object.values(next).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    setPaymentAmount(total > 0 ? total.toFixed(2) : "");
  }
  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Quick entry</p><h2 id={titleId}>{actionLabels[action]}</h2></div><button type="button" className="close-button" aria-label="Close form" disabled={busy} onClick={onClose}>×</button></div>
    {missing ? <div><p>{action === "payment" ? "Create at least one cash account and one credit-card account first, then return here." : `Create ${accountNames.length || budgetOnly ? "a category" : "an account"} first, then return here.`}</p><button className="secondary-button" onClick={onClose}>Close</button></div> : <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
        const values = Object.fromEntries(new FormData(event.currentTarget));
        const applications = Object.entries(values).filter(([key, value]) => key.startsWith("application_") && String(value).trim() !== "").map(([key, value]) => ({ transactionId: key.slice("application_".length), amount: Number(value) }));
        for (const key of Object.keys(values)) if (key.startsWith("application_")) delete values[key];
        if (action === "payment" && manualPayment) (values as Record<string, unknown>).applications = applications;
      try {
        const endpoint = action === "account" ? "/api/accounts" : action === "category" ? "/api/categories" : action === "payment" ? "/api/card-payments" : "/api/entries";
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, kind: action }) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not save. Please try again.");
        onSaved();
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
      {action === "account" ? <>
        <label>Account name<input name="name" required maxLength={80} placeholder="Everyday checking" autoFocus /></label>
        <label>Bank or provider<input name="institution" required maxLength={80} /></label>
        <fieldset className="type-options"><legend>Account type</legend>{[["checking", "Checking"], ["savings", "Savings"], ["credit_card", "Credit card"]].map(([value, label]) => <label key={value}><input type="radio" name="type" value={value} defaultChecked={value === "checking"} />{label}</label>)}</fieldset>
        <label>Opening ledger balance<input name="openingBalance" type="number" step="0.01" defaultValue="0" required /></label><p className="field-help">For credit cards, enter debt as a negative balance. You can also start at zero and force reconcile afterward. New accounts are manual.</p>
      </> : action === "category" ? <>
        <label>Category name<input name="name" required maxLength={80} autoFocus /></label><div className="form-grid"><label>Icon (optional)<input name="icon" placeholder="e.g. 🏠" maxLength={4} /></label><label>Target amount<input name="target" type="number" min="0" step="0.01" defaultValue="0" /></label></div>
      </> : <>
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required autoFocus {...(action === "payment" ? { value: paymentAmount, onChange: (event: ChangeEvent<HTMLInputElement>) => setPaymentAmount(event.target.value) } : {})} /></label>
        <div className="form-grid"><label>Date<input name="date" type="date" defaultValue={today()} required /></label>{action === "payment" ? <Suggestion label="From account" name="fromAccountId" options={cashAccountNames} initial={cashAccountNames.length === 1 ? cashAccountNames[0] : ""} /> : !budgetOnly && <Suggestion label={action === "income" ? "Deposit account" : "Account"} name="accountId" options={accountNames} initial={accountNames.length === 1 ? accountNames[0] : ""} />}</div>
        {action === "payment" && <Suggestion label="To credit card" name="toAccountId" options={creditCardNames} value={toCard} onChange={value => { setToCard(value); if (value !== toCard) { setApplicationAmounts({}); setPaymentAmount(""); } }} />}
        <label>{budgetOnly ? "Note" : "Description"}<input name="description" required maxLength={200} defaultValue={action === "payment" && initialPaymentEntries.length ? `Payment for ${initialPaymentEntries.length} selected ${initialPaymentEntries.length === 1 ? "purchase" : "purchases"}` : ""} placeholder={budgetOnly ? "What is this funding for?" : "What was this for?"} /></label>
        {(action === "transaction" || action === "allocation") && <Suggestion label="Category" name="categoryId" options={categoryNames} />}
        {action === "transfer" && <><Suggestion label="From category" name="fromCategoryId" options={categoryNames} /><Suggestion label="To category" name="toCategoryId" options={categoryNames} /></>}
        {budgetOnly && <p className="field-help">Changes your category funding, not your account balances. Funds roll forward indefinitely.</p>}
        {action === "payment" && <>
          <fieldset className="type-options"><legend>Apply payment</legend><label><input type="radio" name="allocationMode" value="fifo" checked={!manualPayment} onChange={() => setManualPayment(false)} /> Oldest unpaid purchases first</label><label><input type="radio" name="allocationMode" value="manual" checked={manualPayment} onChange={() => setManualPayment(true)} /> Choose purchases manually</label></fieldset>
          {manualPayment && <div className="payment-allocations"><p className="field-help">Choose full amounts or enter partial amounts. The payment total updates as you make selections.</p>{dashboard.activity.filter(entry => entry.kind === "expense" && entry.accountId === dashboard.accounts.find(account => account.name === toCard)?.id && entry.remainingToPay > 0).sort((a, b) => Number(initialPaymentTransactionIds.includes(b.id)) - Number(initialPaymentTransactionIds.includes(a.id)) || a.date.localeCompare(b.date)).map(entry => <div className="payment-allocation-row" key={entry.id}><span><strong>{entry.description}</strong><small>{entry.date} · {entry.paymentStatus} · {entry.remainingToPay.toFixed(2)} remaining</small></span><span className="payment-allocation-controls"><input aria-label={`Amount to apply to ${entry.description}`} name={"application_" + entry.id} type="number" min="0.01" max={entry.remainingToPay} step="0.01" placeholder="0.00" value={applicationAmounts[entry.id] ?? ""} onChange={event => updateApplication(entry.id, event.target.value)} /><button className="secondary-button" type="button" onClick={() => updateApplication(entry.id, entry.remainingToPay.toFixed(2))}>Full amount</button></span></div>)}{!dashboard.activity.some(entry => entry.kind === "expense" && entry.accountId === dashboard.accounts.find(account => account.name === toCard)?.id && entry.remainingToPay > 0) && <p className="empty-state">No unpaid purchases found for this card.</p>}</div>}
          {!manualPayment && <p className="field-help">Moves money from the selected cash account to the card and automatically applies it to the oldest unpaid card purchases. Review coverage in Card payments.</p>}
        </>}
      </>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button></div>
    </form>}
  </dialog>;
}
