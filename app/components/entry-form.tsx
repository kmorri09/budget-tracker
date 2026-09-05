"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type ActionType, type DashboardData, today } from "../../lib/workspace-types";

export const actionLabels: Record<ActionType, string> = { transaction: "Add transaction", income: "Add income", allocation: "Allocate money", transfer: "Move category funds", payment: "Record card payment", category: "Add category", account: "Add account" };

// Native datalists support typing, keyboard selection, and the phone's own picker.
function Suggestion({ label, name, options, initial = "" }: { label: string; name: string; options: string[]; initial?: string }) {
  const id = useId();
  return <label>{label}<input name={name} list={id} defaultValue={initial} placeholder="Type to find…" autoComplete="off" required onChange={event => event.target.setCustomValidity("")} onBlur={event => event.target.setCustomValidity(options.includes(event.target.value) ? "" : "Choose an existing option from the list.")} /><datalist id={id}>{options.map(option => <option key={option} value={option} />)}</datalist></label>;
}

export default function EntryForm({ action, dashboard, onClose, onSaved }: { action: ActionType; dashboard: DashboardData; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const categoryNames = dashboard.categories.map(c => c.name);
  const accountNames = dashboard.accounts.map(a => a.name);
  const budgetOnly = action === "allocation" || action === "transfer";
  const needsCategory = ["transaction", "allocation", "transfer"].includes(action);
  const missing = !["account", "category"].includes(action) && ((!budgetOnly && !accountNames.length) || (needsCategory && !categoryNames.length));
  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Quick entry</p><h2 id={titleId}>{actionLabels[action]}</h2></div><button type="button" className="close-button" aria-label="Close form" disabled={busy} onClick={onClose}>×</button></div>
    {missing ? <div><p>Create {accountNames.length || budgetOnly ? "a category" : "an account"} first, then return here.</p><button className="secondary-button" onClick={onClose}>Close</button></div> : <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const endpoint = action === "account" ? "/api/accounts" : action === "category" ? "/api/categories" : "/api/entries";
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
        <label>Category name<input name="name" required maxLength={80} autoFocus /></label><div className="form-grid"><label>Icon<input name="icon" defaultValue="$" maxLength={4} /></label><label>Target amount<input name="target" type="number" min="0" step="0.01" defaultValue="0" /></label></div>
      </> : <>
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required autoFocus /></label>
        <div className="form-grid"><label>Date<input name="date" type="date" defaultValue={today()} required /></label>{!budgetOnly && <Suggestion label={action === "income" ? "Deposit account" : action === "payment" ? "Payment account (outflow)" : "Account"} name="accountId" options={accountNames} initial={accountNames.length === 1 ? accountNames[0] : ""} />}</div>
        <label>{budgetOnly ? "Note" : "Description"}<input name="description" required maxLength={200} placeholder={budgetOnly ? "What is this funding for?" : "What was this for?"} /></label>
        {(action === "transaction" || action === "allocation") && <Suggestion label="Category" name="categoryId" options={categoryNames} />}
        {action === "transfer" && <><Suggestion label="From category" name="fromCategoryId" options={categoryNames} /><Suggestion label="To category" name="toCategoryId" options={categoryNames} /></>}
        {budgetOnly && <p className="field-help">Changes your category funding, not your account balances. Funds roll forward indefinitely.</p>}
        {action === "payment" && <p className="field-help">Records an outflow on the selected account. Matching a payment to individual expenses or updating the receiving card is not supported by this form yet.</p>}
      </>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button></div>
    </form>}
  </dialog>;
}
