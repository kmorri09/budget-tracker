"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DashboardData } from "../../lib/workspace-types";
import Typeahead from "./typeahead";

const kindOptions = [
  ["expense", "Expense"],
  ["income", "Income"],
  ["refund", "Refund"],
  ["card_payment", "Card payment (legacy)"],
  ["transfer_in", "Transfer in"],
  ["transfer_out", "Transfer out"],
  ["adjustment", "Reconciliation adjustment"],
] as const;

export default function TransactionEditDialog({ transaction, dashboard, onClose, onSaved }: { transaction: DashboardData["activity"][number]; dashboard: DashboardData; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState(transaction.kind);
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? "");
  const [rememberCategory, setRememberCategory] = useState(false);
  const [ruleMatch, setRuleMatch] = useState(transaction.description);
  const accounts = dashboard.managedAccounts.filter(account => account.active || account.id === transaction.accountId);
  const categories = dashboard.managedCategories.filter(category => category.active || category.id === transaction.categoryId);

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  async function removeTransaction() {
    if (!window.confirm(`Delete “${transaction.description}”? This will remove it from account and category balances. The deletion remains in the audit trail.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/entries", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: transaction.id }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not delete transaction.");
      onSaved("Transaction deleted");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete transaction."); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Manual control</p><h2 id={titleId}>Edit transaction</h2></div><button type="button" className="close-button" aria-label="Close transaction editor" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Change the imported or manual record directly. Account is also the payment method used for this transaction.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const payload = {
        id: transaction.id,
        kind: String(values.kind),
        amount: String(values.amount),
        date: String(values.date),
        accountId: String(values.accountId),
        categoryId: String(values.categoryId ?? "") || null,
        description: String(values.description),
        status: String(values.status),
        pending: values.pending === "on",
        rememberCategory: values.rememberCategory === "on",
        categoryRuleMatch: String(values.categoryRuleMatch ?? ""),
      };
      try {
        const response = await fetch("/api/entries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not update transaction.");
        onSaved(result?.ruleSaved ? `Transaction updated; future Plaid imports containing “${ruleMatch.trim()}” will use this category` : "Transaction updated");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update transaction."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label>Description<input name="description" defaultValue={transaction.description} required maxLength={200} autoFocus /></label>
        <div className="form-grid"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={transaction.amount.toFixed(2)} required /></label><label>Date<input name="date" type="date" defaultValue={transaction.date} required /></label></div>
        <Typeahead label="Account / payment method" name="accountId" options={accounts.map(account => ({ value: account.id, label: `${account.name}${account.active ? "" : " (inactive)"}` }))} initialValue={transaction.accountId} />
        <div className="form-grid"><Typeahead label="Type" name="kind" options={kindOptions.map(([value, label]) => ({ value, label }))} value={kind} onChange={setKind} /><Typeahead label="Category" name="categoryId" required={false} options={[{ value: "", label: "No category" }, ...categories.map(category => ({ value: category.id, label: `${category.name}${category.active ? "" : " (inactive)"}` }))]} value={categoryId} onChange={setCategoryId} /></div>
        {transaction.source === "plaid" && ["expense", "refund"].includes(kind) && <div className="rule-builder"><label className="toggle-field"><input name="rememberCategory" type="checkbox" checked={rememberCategory} onChange={event => setRememberCategory(event.target.checked)} disabled={!categoryId} /> Always use this category for matching Plaid imports</label>{rememberCategory && <><label>Description contains<input name="categoryRuleMatch" value={ruleMatch} onChange={event => setRuleMatch(event.target.value)} minLength={3} maxLength={120} required /></label><p className="field-help">This categorizes the current transaction and future matching expenses or refunds. It does not rewrite older transactions.</p></>}</div>}
        <Typeahead label="Status" name="status" options={[{ value: "posted", label: "Posted" }, { value: "pending", label: "Pending" }, { value: "cleared", label: "Cleared" }, { value: "void", label: "Void" }]} initialValue={transaction.status} />
        <label className="toggle-field"><input name="pending" type="checkbox" defaultChecked={transaction.pending} /> Mark as pending</label>
      </fieldset>
      <p className="field-help">Source: {transaction.source.replaceAll("_", " ")}. Source and payment coverage history stay auditable; changing the account changes the payment method.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="danger-button" disabled={busy} onClick={() => void removeTransaction()}>Delete transaction</button><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </dialog>;
}
