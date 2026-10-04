"use client";

import { useEffect, useId, useRef, useState } from "react";
import { money, today, type DashboardData } from "../../lib/workspace-types";

export default function CoverOverspendingDialog({ dashboard, onClose, onSaved }: { dashboard: DashboardData; onClose: () => void; onSaved: (count: number, amount: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const overspent = dashboard.categories.filter(category => category.active && Math.round(category.available * 100) < 0).sort((a, b) => a.name.localeCompare(b.name));
  const visible = overspent.filter(category => category.name.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = overspent.filter(category => selected.includes(category.id));
  const amount = chosen.reduce((sum, category) => sum - Math.round(category.available * 100), 0) / 100;

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    searchInput.current?.focus();
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={dialog} className="entry-dialog reconcile-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Category funding</p><h2 id={titleId}>Cover overspending</h2></div><button type="button" className="close-button" aria-label="Close cover overspending" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Choose the categories to bring current. Each receives enough money from available to assign to bring its negative Available balance to $0.00.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || !chosen.length) return;
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/categories/cover-overspending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryIds: chosen.map(category => category.id), date }) });
        const result = await response.json().catch(() => null) as { error?: string; categoriesFunded?: number; amount?: number } | null;
        if (!response.ok) throw new Error(result?.error ?? "Could not cover overspending.");
        onSaved(result?.categoriesFunded ?? 0, result?.amount ?? 0);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not cover overspending."); } finally { setBusy(false); }
    }}>
      <div className="reconcile-tools"><label>Allocation date<input type="date" value={date} required disabled={busy} onChange={event => setDate(event.target.value)} /></label><label>Find category<input ref={searchInput} type="search" placeholder="Search overspent categories…" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} /></label></div>
      {!!overspent.length && <div className="obligation-selection"><span><strong>{chosen.length}</strong> selected</span><button type="button" className="text-link" disabled={busy} onClick={() => setSelected(overspent.map(category => category.id))}>Select all {overspent.length}</button><button type="button" className="text-link" disabled={busy || !chosen.length} onClick={() => setSelected([])}>Clear selection</button></div>}
      <fieldset disabled={busy} className="reconcile-list cover-overspending-list">{visible.map(category => <label className="coverage-row" key={category.id}><input type="checkbox" checked={selected.includes(category.id)} onChange={() => setSelected(current => current.includes(category.id) ? current.filter(id => id !== category.id) : [...current, category.id])} /><span><strong>{category.name}</strong><small>Available {money(category.available)}</small></span><span><strong>+{money(-Math.round(category.available * 100) / 100)}</strong><small>$0.00 after allocation</small></span></label>)}</fieldset>
      {!visible.length && <p className="empty-state">{overspent.length ? "No matching overspent categories." : "All active categories have zero or positive available balances."}</p>}
      <p className="field-help">Available to assign: {money(dashboard.remainingToBudget)} · After allocation: {money(dashboard.remainingToBudget - amount)}</p>
      {!!chosen.length && amount > dashboard.remainingToBudget && <p className="form-warning">This will allocate {money(amount - dashboard.remainingToBudget)} more than is currently available to assign.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="reconcile-summary"><span>{chosen.length} {chosen.length === 1 ? "category" : "categories"}</span><strong>Total allocation {money(amount)}</strong></div>
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !chosen.length}>{busy ? "Allocating…" : `Allocate ${money(amount)}`}</button></div>
    </form>
  </dialog>;
}
