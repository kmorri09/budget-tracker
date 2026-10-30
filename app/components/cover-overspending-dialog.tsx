"use client";

import { useEffect, useId, useRef, useState } from "react";
import { money, today, type DashboardData } from "../../lib/workspace-types";
import { dashboardCashExpenseFunding } from "../../lib/cash-expense-funding";

export default function CoverOverspendingDialog({ dashboard, mode = "all", onEditTransaction, onClose, onSaved }: { dashboard: DashboardData; mode?: "all" | "cash"; onEditTransaction?: (entry: DashboardData["activity"][number]) => void; onClose: () => void; onSaved: (count: number, amount: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cashPlan = dashboardCashExpenseFunding(dashboard, date);
  const cashAmounts = new Map(cashPlan.shortfalls.map(item => [item.categoryId, item.amountCents]));
  const cashOnly = mode === "cash";
  const heading = cashOnly ? "Cover cash expenses" : "Cover overspending";
  const overspent = dashboard.categories.filter(category => category.active && (cashOnly ? cashAmounts.has(category.id) : Math.round(category.available * 100) < 0)).sort((a, b) => a.name.localeCompare(b.name));
  const allocationCents = (category: typeof overspent[number]) => cashOnly ? cashAmounts.get(category.id) ?? 0 : -Math.round(category.available * 100);
  const uncategorized = cashOnly ? dashboard.activity.filter(entry => cashPlan.uncategorizedIds.includes(entry.id)) : [];
  const visible = overspent.filter(category => category.name.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = overspent.filter(category => selected.includes(category.id));
  const amount = chosen.reduce((sum, category) => sum + allocationCents(category), 0) / 100;

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    searchInput.current?.focus();
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={dialog} className="entry-dialog reconcile-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">{cashOnly ? "Urgent cash funding" : "Category funding"}</p><h2 id={titleId}>{heading}</h2></div><button type="button" className="close-button" aria-label={`Close ${heading.toLowerCase()}`} disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">{cashOnly ? "These expenses have already left your cash accounts. Allocate from available to assign to cover their funding shortfalls. Existing allocations and category refunds cover cash spending first; credit-card purchases are excluded. Only posted or cleared expenses through the allocation date are included." : "Choose the categories to bring current. Each receives enough money from available to assign to bring its negative Available balance to $0.00."}</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || !chosen.length) return;
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/categories/cover-overspending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryIds: chosen.map(category => category.id), date, mode }) });
        const result = await response.json().catch(() => null) as { error?: string; categoriesFunded?: number; amount?: number } | null;
        if (!response.ok) throw new Error(result?.error ?? `Could not ${heading.toLowerCase()}.`);
        onSaved(result?.categoriesFunded ?? 0, result?.amount ?? 0);
      } catch (failure) { setError(failure instanceof Error ? failure.message : `Could not ${heading.toLowerCase()}.`); } finally { setBusy(false); }
    }}>
      <div className="reconcile-tools"><label>Allocation date<input type="date" value={date} required disabled={busy} onChange={event => setDate(event.target.value)} /></label><label>Find category<input ref={searchInput} type="search" placeholder={cashOnly ? "Search cash funding shortfalls…" : "Search overspent categories…"} value={search} disabled={busy} onChange={event => setSearch(event.target.value)} /></label></div>
      {!!overspent.length && <div className="obligation-selection"><span><strong>{chosen.length}</strong> selected</span><button type="button" className="text-link" disabled={busy} onClick={() => setSelected(overspent.map(category => category.id))}>Select all {overspent.length}</button><button type="button" className="text-link" disabled={busy || !chosen.length} onClick={() => setSelected([])}>Clear selection</button></div>}
      <fieldset disabled={busy} className="reconcile-list cover-overspending-list">{visible.map(category => <label className="coverage-row" key={category.id}><input type="checkbox" checked={selected.includes(category.id)} onChange={() => setSelected(current => current.includes(category.id) ? current.filter(id => id !== category.id) : [...current, category.id])} /><span><strong>{category.name}</strong><small>{cashOnly ? "Unfunded cash spending" : `Available ${money(category.available)}`}</small></span><span><strong>+{money(allocationCents(category) / 100)}</strong><small>{cashOnly ? "Cash expenses covered" : "$0.00 after allocation"}</small></span></label>)}</fieldset>
      {!visible.length && <p className="empty-state">{overspent.length ? "No matching categories." : cashOnly ? "All categorized cash expenses are funded." : "All active categories have zero or positive available balances."}</p>}
      {!!uncategorized.length && <div className="form-warning"><strong>{uncategorized.length} cash {uncategorized.length === 1 ? "expense needs" : "expenses need"} an active category first</strong><p>Choose a category, save the expense, then reopen Cover cash expenses to fund it.</p>{uncategorized.map(entry => <button type="button" className="attention-link" disabled={busy} key={entry.id} onClick={() => onEditTransaction?.(entry)}><span>{entry.description}<small>{entry.date} · {entry.account}</small></span><strong>{money(entry.amount)} →</strong></button>)}</div>}
      <p className="field-help">Available to assign: {money(dashboard.remainingToBudget)} · After allocation: {money(dashboard.remainingToBudget - amount)}</p>
      {!!chosen.length && amount > dashboard.remainingToBudget && <p className="form-warning">This will allocate {money(amount - dashboard.remainingToBudget)} more than is currently available to assign.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="reconcile-summary"><span>{chosen.length} {chosen.length === 1 ? "category" : "categories"}</span><strong>Total allocation {money(amount)}</strong></div>
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !chosen.length}>{busy ? "Allocating…" : `Allocate ${money(amount)}`}</button></div>
    </form>
  </dialog>;
}
