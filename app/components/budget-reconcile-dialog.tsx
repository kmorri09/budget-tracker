"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { money, today, type DashboardData } from "../../lib/workspace-types";

export default function BudgetReconcileDialog({ dashboard, onClose, onSaved }: { dashboard: DashboardData; onClose: () => void; onSaved: (delta: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [desired, setDesired] = useState(dashboard.remainingToBudget.toFixed(2));
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("August 1 cutover balance");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const desiredNumber = Number(desired);
  const delta = useMemo(() => Number.isFinite(desiredNumber) ? desiredNumber - dashboard.remainingToBudget : null, [desiredNumber, dashboard.remainingToBudget]);

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={dialog} className="entry-dialog reconcile-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Cutover & corrections</p><h2 id={titleId}>Reconcile available to assign</h2></div><button type="button" className="close-button" aria-label="Close available-to-assign reconciliation" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Set the amount of money that should be left unassigned today. This creates an audited budget adjustment; it does not change account balances, category balances, or pretend the difference was income.</p>
    <dl className="budget-breakdown">
      <div><dt>Recorded income</dt><dd>{money(dashboard.availableBreakdown.income)}</dd></div>
      <div><dt>Cutover/manual adjustments</dt><dd>{money(dashboard.availableBreakdown.adjustments)}</dd></div>
      <div><dt>Net category funding</dt><dd>− {money(dashboard.availableBreakdown.allocations)}</dd></div>
      <div><dt>Current available to assign</dt><dd>{money(dashboard.availableBreakdown.available)}</dd></div>
    </dl>
    {!!dashboard.availableAdjustments.length && <details className="adjustment-history"><summary>Previous adjustments ({dashboard.availableAdjustments.length})</summary>{[...dashboard.availableAdjustments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(adjustment => <div key={adjustment.id}><span>{adjustment.note}<small>{adjustment.date}</small></span><strong>{adjustment.amount > 0 ? "+" : ""}{money(adjustment.amount)}</strong></div>)}</details>}
    <form onSubmit={async event => {
      event.preventDefault(); setError("");
      if (!Number.isFinite(desiredNumber)) { setError("Enter a valid desired balance."); return; }
      setBusy(true);
      try {
        const response = await fetch("/api/budget/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desiredBalance: desiredNumber, date, note }) });
        const result = await response.json().catch(() => null) as { error?: string; delta?: number } | null;
        if (!response.ok) throw new Error(result?.error ?? "Could not reconcile available to assign.");
        onSaved(result?.delta ?? 0);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reconcile available to assign."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label>Desired available to assign<input type="number" step="0.01" value={desired} onChange={event => setDesired(event.target.value)} autoFocus required /></label>
        <div className="form-grid"><label>Adjustment date<input type="date" value={date} onChange={event => setDate(event.target.value)} required /></label><label>Reason<input value={note} onChange={event => setNote(event.target.value)} maxLength={200} required /></label></div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="reconcile-summary"><span>Current {money(dashboard.remainingToBudget)} → desired {Number.isFinite(desiredNumber) ? money(desiredNumber) : "—"}</span><strong>{delta === null ? "Enter a balance" : delta === 0 ? "No adjustment" : `${delta > 0 ? "+" : ""}${money(delta)} adjustment`}</strong></div>
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || delta === null}>{busy ? "Applying…" : "Apply reconciliation"}</button></div>
    </form>
  </dialog>;
}
