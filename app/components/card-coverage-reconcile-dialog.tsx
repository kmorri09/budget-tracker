"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type DashboardData, money, today } from "../../lib/workspace-types";
import Typeahead from "./typeahead";

export default function CardCoverageReconcileDialog({ dashboard, onClose, onSaved }: { dashboard: DashboardData; onClose: () => void; onSaved: (changed: number, state: "paid" | "unpaid") => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [card, setCard] = useState("All cards");
  const [coverage, setCoverage] = useState("Unpaid");
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("Migration card coverage reconciliation");
  const cardAccountIds = new Set(dashboard.accounts.filter(account => account.type === "credit_card").map(account => account.id));
  const purchases = useMemo(() => dashboard.activity.filter(entry => entry.kind === "expense" && cardAccountIds.has(entry.accountId)), [dashboard.activity, cardAccountIds]);
  const cards = [...new Set(purchases.map(entry => entry.account))].sort();
  const visible = purchases.filter(entry => {
    if (card !== "All cards" && entry.account !== card) return false;
    if (coverage !== "All statuses" && entry.paymentStatus !== coverage) return false;
    const needle = search.trim().toLowerCase();
    return !needle || `${entry.description} ${entry.category ?? ""} ${entry.account} ${entry.date}`.toLowerCase().includes(needle);
  });
  const allVisibleSelected = visible.length > 0 && visible.every(entry => selected.includes(entry.id));

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  function toggleVisible() {
    const visibleIds = new Set(visible.map(entry => entry.id));
    setSelected(current => allVisibleSelected ? current.filter(id => !visibleIds.has(id)) : [...new Set([...current, ...visibleIds])]);
  }

  async function reconcile(state: "paid" | "unpaid") {
    if (!selected.length) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/card-coverage/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionIds: selected, state, date, note }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not reconcile card coverage.");
      onSaved(result.changed ?? 0, state);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reconcile card coverage."); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="entry-dialog coverage-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Manual control</p><h2 id={titleId}>Reconcile card coverage</h2></div><button type="button" className="close-button" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">Force purchases to Paid or Unpaid without creating a card payment or changing any account or category balance.</p>
    <fieldset disabled={busy}>
      <div className="coverage-tools"><label>Find purchases<input type="search" placeholder="Description or category…" value={search} onChange={event => setSearch(event.target.value)} /></label><Typeahead label="Credit card" options={[{ value: "All cards", label: "All cards" }, ...cards.map(name => ({ value: name, label: name }))]} value={card} onChange={setCard} required={false} /><Typeahead label="Current coverage" options={[{ value: "All statuses", label: "All statuses" }, { value: "Unpaid", label: "Unpaid" }, { value: "Partially paid", label: "Partially paid" }, { value: "Paid", label: "Paid" }]} value={coverage} onChange={setCoverage} required={false} /></div>
      <div className="coverage-selection"><span><strong>{selected.length}</strong> selected · {visible.length} matching</span><button type="button" className="text-link" onClick={toggleVisible}>{allVisibleSelected ? "Clear matching" : `Select all ${visible.length} matching`}</button>{selected.length > 0 && <button type="button" className="text-link" onClick={() => setSelected([])}>Clear all</button>}</div>
      <div className="coverage-list">{visible.map(entry => <label key={entry.id} className="coverage-row"><input type="checkbox" checked={selected.includes(entry.id)} onChange={() => setSelected(current => current.includes(entry.id) ? current.filter(id => id !== entry.id) : [...current, entry.id])} /><span><strong>{entry.description}</strong><small>{entry.date} · {entry.account} · {entry.category ?? "Uncategorized"}</small></span><span><strong>{entry.paymentStatus}</strong><small>{money(entry.remainingToPay)} remaining</small></span></label>)}{!visible.length && <p className="empty-state">No matching card purchases.</p>}</div>
      <div className="coverage-metadata"><label>Adjustment date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Reason<input value={note} maxLength={200} onChange={event => setNote(event.target.value)} /></label></div>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-footer"><button type="button" className="secondary-button" disabled={busy || !selected.length} onClick={() => void reconcile("unpaid")}>Mark unpaid</button><button type="button" className="primary-button" disabled={busy || !selected.length} onClick={() => void reconcile("paid")}>Mark paid</button></div>
  </dialog>;
}
