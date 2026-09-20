"use client";

import { useEffect, useId, useRef, useState } from "react";
import { money, type Obligation } from "../../lib/workspace-types";

export default function ObligationMatchDialog({ obligation, onClose, onSaved }: { obligation: Obligation; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const charge = obligation.suggestion;

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  async function decide(status: "confirmed" | "dismissed") {
    if (!charge) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/obligations/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obligationId: obligation.id, candidateType: charge.type, candidateId: charge.id, status }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not save match decision.");
      onSaved(status === "confirmed" ? "Charge matched to obligation" : "Suggested charge dismissed");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save match decision."); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="entry-dialog obligation-match-dialog" aria-labelledby={titleId} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-top"><div><p className="eyebrow">Check the withdrawal</p><h2 id={titleId}>Review suggested charge</h2></div><button type="button" className="close-button" aria-label="Close charge review" disabled={busy} onClick={onClose}>×</button></div>
    {charge && <><p className="field-help">Is this withdrawal the payment for <strong>{obligation.name}</strong>? Confirming will use its date and amount when estimating the next charge.</p>
      <dl className="review-facts obligation-match-facts">
        <div><dt>Charge description</dt><dd>{charge.description}</dd></div>
        <div><dt>Withdrawal date</dt><dd>{charge.date}</dd></div>
        <div><dt>Exact amount</dt><dd>{money(charge.amount)}</dd></div>
        <div><dt>Account</dt><dd>{charge.account}</dd></div>
        <div><dt>Source</dt><dd>{charge.source}</dd></div>
      </dl>
      <div className="obligation-match-plan"><strong>Planned obligation</strong><span>{obligation.name} · {money(obligation.amount)} · due {obligation.dueDate}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => void decide("dismissed")}>Not this charge</button><button type="button" className="secondary-button" disabled={busy} autoFocus onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={() => void decide("confirmed")}>{busy ? "Saving…" : "Confirm match"}</button></div>
    </>}
  </dialog>;
}
