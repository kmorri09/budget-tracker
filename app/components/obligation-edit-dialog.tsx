"use client";

import { useEffect, useId, useRef, useState } from "react";
import { today, type DashboardData, type Obligation } from "../../lib/workspace-types";
import Typeahead from "./typeahead";
import { useConfirmDialog } from "./confirm-dialog";

export default function ObligationEditDialog({ obligation, dashboard, onClose, onSaved }: { obligation: Obligation | null; dashboard: DashboardData; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog: confirmationDialog } = useConfirmDialog();
  const editing = Boolean(obligation);
  const accounts = dashboard.managedAccounts.filter(account => account.active || account.id === obligation?.accountId);
  const categories = dashboard.managedCategories.filter(category => category.active || category.id === obligation?.categoryId);

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  async function removeObligation() {
    if (!obligation || !await confirm({ title: `Delete “${obligation.name}”?`, message: "This removes it permanently. Existing allocations are not changed.", confirmLabel: "Delete obligation", destructive: true })) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/obligations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: obligation.id }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not delete obligation.");
      onSaved("Obligation deleted");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete obligation."); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Upcoming planning</p><h2 id={titleId}>{editing ? "Edit obligation" : "Add obligation"}</h2></div><button type="button" className="close-button" aria-label="Close obligation editor" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Obligations are planning reminders. They do not create transactions or move money until you use Fund upcoming obligations.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const payload = { ...(obligation ? { id: obligation.id } : {}), name: String(values.name), amount: String(values.amount), dueDate: String(values.dueDate), categoryId: String(values.categoryId), accountId: String(values.accountId), cadence: String(values.cadence ?? ""), active: values.active === "on" };
      try {
        const response = await fetch("/api/obligations", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? `Could not ${editing ? "update" : "create"} obligation.`);
        onSaved(editing ? "Obligation updated" : "Obligation created");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save obligation."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label>Name<input name="name" defaultValue={obligation?.name ?? ""} required maxLength={120} autoFocus /></label>
        <div className="form-grid"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={obligation?.amount.toFixed(2) ?? ""} required /></label><label>Due date<input name="dueDate" type="date" defaultValue={obligation?.dueDate ?? today()} required /></label></div>
        <div className="form-grid"><Typeahead label="Category" name="categoryId" options={categories.map(category => ({ value: category.id, label: `${category.name}${category.active ? "" : " (inactive)"}` }))} initialValue={obligation?.categoryId ?? ""} /><Typeahead label="Account" name="accountId" options={accounts.map(account => ({ value: account.id, label: `${account.name}${account.active ? "" : " (inactive)"}` }))} initialValue={obligation?.accountId ?? ""} /></div>
        <label>Cadence (optional)<input name="cadence" defaultValue={obligation?.cadence ?? ""} placeholder="e.g. Monthly, annual, one time" maxLength={40} /></label>
        <label className="toggle-field"><input name="active" type="checkbox" defaultChecked={obligation?.active ?? true} /> Active and eligible for funding</label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer">{obligation && <button type="button" className="danger-button" disabled={busy} onClick={() => void removeObligation()}>Delete obligation</button>}<button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add obligation"}</button></div>
    </form>
    {confirmationDialog}</dialog>;
}
