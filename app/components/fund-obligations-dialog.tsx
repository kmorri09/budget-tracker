"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { calculateObligationFunding } from "../../lib/obligation-funding";
import { money, today, type DashboardData } from "../../lib/workspace-types";
import Typeahead from "./typeahead";

const DEFAULT_SCOPE = "14";

function parseAmountCents(raw: string | undefined) {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw), cents = Math.round(value * 100);
  return Number.isFinite(value) && value >= 0 && cents <= 2_147_483_647 && Math.abs(value * 100 - cents) < 0.000001 ? cents : null;
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function FundObligationsDialog({ dashboard, onClose, onSaved }: { dashboard: DashboardData; onClose: () => void; onSaved: (count: number, amount: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const currentDate = today();
  const [scope, setScope] = useState(DEFAULT_SCOPE);
  const inScope = (days: string) => dashboard.obligations.filter(obligation => obligation.active && !obligation.covered && (days === "all" || obligation.nextChargeDate <= addDays(currentDate, Number(days)))).sort((a, b) => a.nextChargeDate.localeCompare(b.nextChargeDate));
  const [selected, setSelected] = useState<string[]>(() => inScope(DEFAULT_SCOPE).map(obligation => obligation.id));
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>(() => Object.fromEntries(dashboard.obligations.map(obligation => [obligation.id, obligation.expectedAmount.toFixed(2)])));
  const [date, setDate] = useState(currentDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = inScope(scope);
  const selectedObligations = dashboard.obligations.filter(obligation => obligation.active && !obligation.covered && selected.includes(obligation.id));
  const selectedAmounts = selectedObligations.map(obligation => ({ id: obligation.id, amountCents: parseAmountCents(amountInputs[obligation.id]) ?? 0 }));
  const invalidObligations = selectedObligations.filter(obligation => parseAmountCents(amountInputs[obligation.id]) === null);
  const tooLargeObligations = invalidObligations.filter(obligation => Number(amountInputs[obligation.id]) > 21474836.47);
  const amountById = new Map(selectedAmounts.map(item => [item.id, item.amountCents]));
  const funding = useMemo(() => calculateObligationFunding(
    selectedObligations.map(obligation => ({ id: obligation.id, categoryId: obligation.categoryId, name: obligation.name, amountCents: amountById.get(obligation.id) ?? 0 })),
    dashboard.categories.map(category => ({ id: category.id, name: category.name, availableCents: Math.round(category.available * 100) })),
  ), [dashboard.categories, selectedObligations, amountInputs]);
  const amount = funding.reduce((sum, group) => sum + group.allocationCents, 0) / 100;
  const unavailableCategories = selectedObligations.filter(obligation => (amountById.get(obligation.id) ?? 0) > 0 && !dashboard.categories.some(category => category.id === obligation.categoryId));
  const disabledReason = busy ? "Saving your allocations…"
    : !selectedObligations.length ? "Select at least one obligation to allocate money."
    : tooLargeObligations.length ? `Reduce the amount to $21,474,836.47 or less, or deselect: ${tooLargeObligations.map(obligation => obligation.name).join(", ")}.`
    : invalidObligations.length ? `Enter an amount of $0 or more with at most two decimal places, or deselect: ${invalidObligations.map(obligation => obligation.name).join(", ")}.`
    : !date ? "Choose an allocation date."
    : unavailableCategories.length ? `Assign an active category in Manage obligations before funding: ${unavailableCategories.map(obligation => obligation.name).join(", ")}.`
    : selectedAmounts.every(item => item.amountCents === 0) ? "All selected amounts are $0, so there is nothing to allocate. Enter a positive amount or select another obligation."
    : amount === 0 ? "These obligations are already covered by their categories’ available balances. No additional allocation is needed."
    : "";

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
    <p className="field-help">Choose the obligations to cover and adjust their amounts for this allocation. Set an amount to $0 to skip it this time. These edits apply to this allocation only. The app groups the remaining obligations by category and allocates only the difference between their combined amount and the category&apos;s current available balance.</p>
    <div className="obligation-tools"><Typeahead label="Due date window" options={[{ value: "14", label: "Due within 14 days" }, { value: "30", label: "Due within 30 days" }, { value: "60", label: "Due within 60 days" }, { value: "90", label: "Due within 90 days" }, { value: "all", label: "All active obligations" }]} value={scope} onChange={changeScope} required={false} /><label>Allocation date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div>
    <div className="obligation-selection"><span><strong>{selected.length}</strong> selected</span><button type="button" className="text-link" onClick={() => setSelected(visible.every(item => selected.includes(item.id)) ? selected.filter(id => !visible.some(item => item.id === id)) : [...new Set([...selected, ...visible.map(item => item.id)])])}>{visible.length && visible.every(item => selected.includes(item.id)) ? "Clear this window" : `Select all ${visible.length}`}</button></div>
    <div className="obligation-list">{visible.map(obligation => <div className="obligation-row" key={obligation.id}><input id={`select-${obligation.id}`} type="checkbox" checked={selected.includes(obligation.id)} aria-labelledby={`name-${obligation.id}`} onChange={() => setSelected(current => current.includes(obligation.id) ? current.filter(id => id !== obligation.id) : [...current, obligation.id])} /><span id={`name-${obligation.id}`}><strong>{obligation.name}</strong><small>{obligation.nextChargeDate < currentDate ? "Overdue" : `Expected ${obligation.nextChargeDate}`} · {obligation.category} · {obligation.amountSource === "observed" ? "latest charge" : "planned amount"}</small></span><label className="obligation-amount"><span className="sr-only">Amount for {obligation.name}</span><span aria-hidden="true">$</span><input type="number" min="0" max="21474836.47" step="0.01" inputMode="decimal" value={amountInputs[obligation.id] ?? ""} aria-invalid={selected.includes(obligation.id) && parseAmountCents(amountInputs[obligation.id]) === null} aria-describedby={selected.includes(obligation.id) && parseAmountCents(amountInputs[obligation.id]) === null ? reasonId : undefined} onChange={event => setAmountInputs(current => ({ ...current, [obligation.id]: event.target.value }))} /></label></div>)}{!visible.length && <p className="empty-state">No active obligations fall within this window.</p>}</div>
    {!!funding.length && <div className="funding-preview">{funding.map(group => <div key={group.categoryId}><span><strong>{group.category}</strong><small>{money(group.availableCents / 100)} currently available · {money(group.obligationCents / 100)} due</small></span><strong>{group.allocationCents ? `+${money(group.allocationCents / 100)}` : "Already funded"}</strong></div>)}</div>}
    {amount > dashboard.remainingToBudget && <p className="form-warning">This will allocate {money(amount - dashboard.remainingToBudget)} more than is currently available to assign.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="reconcile-summary"><span>{funding.length} {funding.length === 1 ? "category" : "categories"}</span><strong>Total allocation {money(amount)}</strong></div>
    {disabledReason && <p id={reasonId} className="field-help" role="status" aria-live="polite">{disabledReason}</p>}
    <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={!!disabledReason} aria-describedby={disabledReason ? reasonId : undefined} onClick={async () => {
      if (disabledReason) return;
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/obligations/fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obligations: selectedAmounts, date }) });
        const result = await response.json().catch(() => null) as { error?: string; categoriesFunded?: number; amount?: number } | null;
        if (!response.ok) throw new Error(result?.error ?? "Could not fund upcoming obligations.");
        onSaved(result?.categoriesFunded ?? 0, result?.amount ?? 0);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not fund upcoming obligations."); } finally { setBusy(false); }
    }}>{busy ? "Allocating…" : amount ? `Allocate ${money(amount)}` : "Allocate"}</button></div>
  </dialog>;
}
