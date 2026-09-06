"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { money, today, type Category } from "../../lib/workspace-types";

export default function CategoryReconcileDialog({ categories, onClose, onSaved }: { categories: Category[]; onClose: () => void; onSaved: (count: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = useMemo(() => categories.filter(category => category.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [categories, search]);
  const entered = categories.flatMap(category => {
    const raw = drafts[category.id];
    if (raw === undefined || raw.trim() === "") return [];
    const desired = Number(raw);
    return Number.isFinite(desired) ? [{ id: category.id, desired, delta: desired - category.available, name: category.name }] : [];
  });

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={dialog} className="entry-dialog reconcile-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">One-time setup or correction</p><h2 id={titleId}>Reconcile category balances</h2></div><button type="button" className="close-button" aria-label="Close category reconciliation" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Enter the current <strong>Remaining</strong> value from Notion for each category you want to align. Leave the others blank. Negative balances are allowed.</p>
    <div className="reconcile-tools"><label>Adjustment date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Find category<input type="search" placeholder="Search categories…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <form onSubmit={async event => {
      event.preventDefault(); setError("");
      if (!entered.length) { setError("Enter at least one desired category balance."); return; }
      setBusy(true);
      try {
        const response = await fetch("/api/categories/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, balances: entered.map(item => ({ id: item.id, available: item.desired })) }) });
        const result = await response.json().catch(() => null) as { error?: string; adjusted?: number } | null;
        if (!response.ok) throw new Error(result?.error ?? "Could not reconcile category balances.");
        onSaved(result?.adjusted ?? 0);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reconcile category balances."); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="reconcile-list">{visible.map(category => {
        const raw = drafts[category.id] ?? "";
        const desired = Number(raw);
        const delta = raw.trim() && Number.isFinite(desired) ? desired - category.available : null;
        return <label className="reconcile-category" key={category.id}><span><strong>{category.name}</strong><small>App currently {money(category.available)}</small></span><span className="reconcile-input"><span className="sr-only">Desired remaining balance</span><input aria-label={"Desired balance for " + category.name} type="number" step="0.01" placeholder="Leave unchanged" value={raw} onChange={event => setDrafts(current => ({ ...current, [category.id]: event.target.value }))} />{delta !== null && <small className={delta < 0 ? "negative" : ""}>{delta === 0 ? "No change" : (delta > 0 ? "+" : "") + money(delta) + " adjustment"}</small>}</span></label>;
      })}</fieldset>
      {!visible.length && <p className="empty-state">No matching categories.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="reconcile-summary"><span>{entered.length} {entered.length === 1 ? "category" : "categories"} entered</span><strong>Net adjustment {money(entered.reduce((sum, item) => sum + item.delta, 0))}</strong></div>
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Applying…" : "Apply entered balances"}</button></div>
    </form>
  </dialog>;
}
