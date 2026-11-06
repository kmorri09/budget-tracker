"use client";

import { useEffect, useId, useRef, useState } from "react";
import { money, type Category } from "../../lib/workspace-types";

export default function CashReserveDialog({ category, reviewToken, onClose, onSaved }: { category: Category; reviewToken: string; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const current = category.manualCashReserve ?? (category.cashReserve ?? 0) + (category.cashReserveShortfall ?? 0);
  const obligations = category.obligationReserve ?? 0;
  const protectedTarget = Math.max(current, obligations);
  const [amount, setAmount] = useState(current.toFixed(2)), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const value = Number(amount), free = Math.max(0, Math.min(category.available, category.cardFundingAvailable ?? category.available) - (category.unmatchedRefunds ?? 0) - protectedTarget);
  const valid = amount.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 21474836.47 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="entry-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Category funding</p><h2 id={titleId}>Adjust cash reserve</h2></div><button type="button" className="close-button" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div>
    <p className="field-help">{category.name} · {money(category.cashReserve ?? 0)} protected · {money(free)} free to spend.</p>
    {obligations > 0 && <p className="field-help">Active obligations set a {money(obligations)} reserve target. A higher manual amount raises that target.</p>}
    <p className="field-help">Categorized cash expenses draw down the manual reserve. The automatic target follows your active obligations and their payment matches.</p>
    {(category.cashReserveShortfall ?? 0) > 0 && <p className="form-warning">{money(category.cashReserveShortfall ?? 0)} of the requested reserve lacks category funding.</p>}
    <label>Cash reserve amount<input type="number" min="0" max="21474836.47" step="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    {valid && value > protectedTarget + free && <p className="form-warning">Allocate more money to this category before protecting this amount.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !valid || value > protectedTarget + free} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/cash-reserves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: category.id, targetCents: Math.round(value * 100), reviewToken }) });
        const result = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(result?.error ?? "Could not update the cash reserve.");
        onSaved();
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update the cash reserve."); } finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Save reserve"}</button></div>
  </dialog>;
}
