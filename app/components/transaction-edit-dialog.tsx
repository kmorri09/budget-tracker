"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DashboardData } from "../../lib/workspace-types";

const kindOptions = [
  ["expense", "Expense"],
  ["income", "Income"],
  ["refund", "Refund"],
  ["card_payment", "Card payment (legacy)"],
  ["transfer_in", "Transfer in"],
  ["transfer_out", "Transfer out"],
  ["adjustment", "Reconciliation adjustment"],
] as const;

export default function TransactionEditDialog({ transaction, dashboard, onClose, onSaved }: { transaction: DashboardData["activity"][number]; dashboard: DashboardData; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

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
      };
      try {
        const response = await fetch("/api/entries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not update transaction.");
        onSaved();
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update transaction."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label>Description<input name="description" defaultValue={transaction.description} required maxLength={200} autoFocus /></label>
        <div className="form-grid"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={transaction.amount.toFixed(2)} required /></label><label>Date<input name="date" type="date" defaultValue={transaction.date} required /></label></div>
        <label>Account / payment method<select name="accountId" defaultValue={transaction.accountId} required>{dashboard.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <div className="form-grid"><label>Type<select name="kind" defaultValue={transaction.kind}>{kindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Category<select name="categoryId" defaultValue={transaction.categoryId ?? ""}><option value="">No category</option>{dashboard.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
        <label>Status<select name="status" defaultValue={transaction.status}><option value="posted">Posted</option><option value="pending">Pending</option><option value="cleared">Cleared</option><option value="void">Void</option></select></label>
        <label className="toggle-field"><input name="pending" type="checkbox" defaultChecked={transaction.pending} /> Mark as pending</label>
      </fieldset>
      <p className="field-help">Source: {transaction.source.replaceAll("_", " ")}. Source and payment coverage history stay auditable; changing the account changes the payment method.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </dialog>;
}
