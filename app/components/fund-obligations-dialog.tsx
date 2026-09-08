"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { calculateObligationFunding } from "../../lib/obligation-funding";
import { money, today, type DashboardData } from "../../lib/workspace-types";

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function FundObligationsDialog({ dashboard, onClose, onSaved }: { dashboard: DashboardData; onClose: () => void; onSaved: (count: number, amount: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const currentDate = today();
  const [scope, setScope] = useState("30");
  const inScope = (days: string) => dashboard.obligations.filter(obligation => days === "all" || obligation.dueDate <= addDays(currentDate, Number(days))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const [selected, setSelected] = useState<string[]>(() => inScope("30").map(obligation => obligation.id));
  const [date, setDate] = useState(currentDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = inScope(scope);
  const selectedObligations = dashboard.obligations.filter(obligation => selected.includes(obligation.id));
  const funding = useMemo(() => calculateObligationFunding(
    selectedObligations.map(obligation => ({ id: obligation.id, categoryId: obligation.categoryId, name: obligation.name, amountCents: Math.round(obligation.amount * 100) })),
    dashboard.categories.map(category => ({ id: category.id, name: category.name, availableCents: Math.round(category.available * 100) })),
  ), [dashboard.categories, selectedObligations]);
  const amount = funding.reduce((sum, group) => sum + group.allocationCents, 0) / 100;

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  function changeScope(next: string) {
    setScope(next);
    setSelected(inScope(next).map(obligation => obligation.id));
  }

  return <dialog ref={dialog} className="entry-dialog obligation-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Automatic allocation</p><h2 id={titleId}>Fund upcoming obligations</h2></div><button type="button" className="close-button" aria-label="Close obligation funding" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Choose the obligations to cover. The app groups them by category and allocates only the difference between their combined amount and the category&apos;s current available balance.</p>
    <div className="obligation-tools"><label>Due date window<select value={scope} onChange={event => changeScope(event.target.value)}><option value="30">Due within 30 days</option><option value="60">Due within 60 days</option><option value="90">Due within 90 days</option><option value="all">All active obligations</option></select></label><label>Allocation date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div>
    <div className="obligation-selection"><span><strong>{selected.length}</strong> selected</span><button type="button" className="text-link" onClick={() => setSelected(visible.every(item => selected.includes(item.id)) ? selected.filter(id => !visible.some(item => item.id === id)) : [...new Set([...selected, ...visible.map(item => item.id)])])}>{visible.length && visible.every(item => selected.includes(item.id)) ? "Clear this window" : `Select all ${visible.length}`}</button></div>
    <div className="obligation-list">{visible.map(obligation => <label className="obligation-row" key={obligation.id}><input type="checkbox" checked={selected.includes(obligation.id)} onChange={() => setSelected(current => current.includes(obligation.id) ? current.filter(id => id !== obligation.id) : [...current, obligation.id])} /><span><strong>{obligation.name}</strong><small>{obligation.dueDate < currentDate ? "Overdue" : `Due ${obligation.dueDate}`} · {obligation.category}</small></span><strong>{money(obligation.amount)}</strong></label>)}{!visible.length && <p className="empty-state">No active obligations fall within this window.</p>}</div>
    {!!funding.length && <div className="funding-preview">{funding.map(group => <div key={group.categoryId}><span><strong>{group.category}</strong><small>{money(group.availableCents / 100)} currently available · {money(group.obligationCents / 100)} due</small></span><strong>{group.allocationCents ? `+${money(group.allocationCents / 100)}` : "Already funded"}</strong></div>)}</div>}
    {amount > dashboard.remainingToBudget && <p className="form-warning">This will allocate {money(amount - dashboard.remainingToBudget)} more than is currently available to assign.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="reconcile-summary"><span>{funding.length} {funding.length === 1 ? "category" : "categories"}</span><strong>Total allocation {money(amount)}</strong></div>
    <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !selected.length || amount === 0} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/obligations/fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obligationIds: selected, date }) });
        const result = await response.json().catch(() => null) as { error?: string; categoriesFunded?: number; amount?: number } | null;
        if (!response.ok) throw new Error(result?.error ?? "Could not fund upcoming obligations.");
        onSaved(result?.categoriesFunded ?? 0, result?.amount ?? 0);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not fund upcoming obligations."); } finally { setBusy(false); }
    }}>{busy ? "Allocating…" : amount ? `Allocate ${money(amount)}` : "Already funded"}</button></div>
  </dialog>;
}
