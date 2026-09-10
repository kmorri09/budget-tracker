"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Allocation, DashboardData } from "../../lib/workspace-types";
import Typeahead from "./typeahead";

export default function AllocationEditDialog({ allocation, dashboard, onClose, onSaved }: { allocation: Allocation; dashboard: DashboardData; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const categories = dashboard.managedCategories.filter(category => category.active || category.id === allocation.categoryId);

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  async function remove() {
    if (!window.confirm(`Delete this ${allocation.amount < 0 ? "removal" : "allocation"} of ${Math.abs(allocation.amount).toLocaleString("en-US", { style: "currency", currency: "USD" })}? Category and available-to-assign balances will be recalculated.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/allocations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: allocation.id }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not delete allocation.");
      onSaved("Allocation deleted");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete allocation."); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Manual control</p><h2 id={titleId}>Edit allocation</h2></div><button type="button" className="close-button" aria-label="Close allocation editor" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Negative amounts remove funding. Transfer entries are stored as two allocations, so edit or delete both sides when correcting a transfer.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const response = await fetch("/api/allocations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: allocation.id, amount: values.amount, date: values.date, categoryId: values.categoryId, note: values.note }) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not update allocation.");
        onSaved("Allocation updated");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update allocation."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <div className="form-grid"><label>Net amount<input name="amount" type="number" step="0.01" defaultValue={allocation.amount.toFixed(2)} required autoFocus /></label><label>Date<input name="date" type="date" defaultValue={allocation.date} required /></label></div>
        <Typeahead label="Category" name="categoryId" options={categories.map(category => ({ value: category.id, label: `${category.name}${category.active ? "" : " (inactive)"}` }))} initialValue={allocation.categoryId} />
        <label>Note<input name="note" defaultValue={allocation.note} maxLength={200} /></label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="danger-button" disabled={busy} onClick={() => void remove()}>Delete allocation</button><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </dialog>;
}
