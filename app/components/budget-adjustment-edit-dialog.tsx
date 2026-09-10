"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { BudgetAdjustment } from "../../lib/workspace-types";
import { useConfirmDialog } from "./confirm-dialog";

export default function BudgetAdjustmentEditDialog({ adjustment, onClose, onSaved }: { adjustment: BudgetAdjustment; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { confirm, dialog: confirmationDialog } = useConfirmDialog();

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  async function remove() {
    if (!await confirm({ title: "Delete this adjustment?", message: "Your available-to-assign balance will be recalculated immediately.", confirmLabel: "Delete adjustment", destructive: true })) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/budget/adjustments", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: adjustment.id }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not delete adjustment.");
      onSaved("Available adjustment deleted");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not delete adjustment."); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Manual control</p><h2 id={titleId}>Edit available adjustment</h2></div><button type="button" className="close-button" aria-label="Close adjustment editor" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">This changes available to assign without changing income, account balances, or category activity.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const response = await fetch("/api/budget/adjustments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: adjustment.id, amount: values.amount, date: values.date, note: values.note }) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not update adjustment.");
        onSaved("Available adjustment updated");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update adjustment."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <div className="form-grid"><label>Amount<input name="amount" type="number" step="0.01" defaultValue={adjustment.amount.toFixed(2)} required autoFocus /></label><label>Date<input name="date" type="date" defaultValue={adjustment.date} required /></label></div>
        <label>Reason<input name="note" defaultValue={adjustment.note} required maxLength={200} /></label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="danger-button" disabled={busy} onClick={() => void remove()}>Delete adjustment</button><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
    {confirmationDialog}</dialog>;
}
