"use client";

import { useEffect, useId, useRef, useState } from "react";
import { budgetToday } from "../../lib/budget-date";
import { money, type DashboardData, type Obligation } from "../../lib/workspace-types";
import Typeahead from "./typeahead";

export default function ObligationMatchDialog({ obligation, dashboard, onClose, onSaved }: { obligation: Obligation; dashboard?: DashboardData; onClose: () => void; onSaved: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [includeOtherAccounts, setIncludeOtherAccounts] = useState(false);
  const [selected, setSelected] = useState("");
  const today = budgetToday();
  const choices = dashboard ? [
    ...dashboard.activity.filter(entry => entry.status === "posted" && !entry.pending && entry.date <= today && ["expense", "transfer_out", "card_payment"].includes(entry.kind) && (includeOtherAccounts || entry.accountId === obligation.accountId)).map(entry => ({ id: entry.id, type: "transaction" as const, description: entry.description, date: entry.date, amount: entry.amount, account: entry.account, source: entry.category ?? "Transaction" })),
    ...dashboard.payments.filter(payment => payment.editable && payment.date <= today && (includeOtherAccounts || [payment.fromAccountId, payment.toAccountId].includes(obligation.accountId))).map(payment => ({ id: payment.id, type: "payment" as const, description: payment.description, date: payment.date, amount: payment.amount, account: `${payment.fromAccount} → ${payment.toAccount}`, source: "Recorded card payment" })),
  ].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const charge = dashboard ? choices.find(choice => `${choice.type}:${choice.id}` === selected) : obligation.suggestion;

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
    <div className="modal-top"><div><p className="eyebrow">Check the withdrawal</p><h2 id={titleId}>{dashboard ? "Match a charge" : "Review suggested charge"}</h2></div><button type="button" className="close-button" aria-label="Close charge review" disabled={busy} onClick={onClose}>×</button></div>
    {dashboard && <fieldset disabled={busy}>
      <p className="field-help">Choose the posted withdrawal or recorded card payment for <strong>{obligation.name}</strong>.</p>
      <label className="toggle-field"><input type="checkbox" checked={includeOtherAccounts} onChange={event => { setIncludeOtherAccounts(event.target.checked); setSelected(""); }} /> Include other accounts</label>
      <Typeahead key={String(includeOtherAccounts)} label="Matching charge" value={selected} onChange={setSelected} options={choices.map(choice => ({ value: `${choice.type}:${choice.id}`, label: `${choice.date} · ${money(choice.amount)} · ${choice.description} · ${choice.account} · ${choice.source}` }))} placeholder="Search by description, date, or amount" required={false} />
    </fieldset>}
    {charge && <><p className="field-help">Is this withdrawal the payment for <strong>{obligation.name}</strong>? Confirming will use its date and amount when estimating the next charge.</p>
      <dl className="review-facts obligation-match-facts">
        <div><dt>Charge description</dt><dd>{charge.description}</dd></div>
        <div><dt>Withdrawal date</dt><dd>{charge.date}</dd></div>
        <div><dt>Exact amount</dt><dd>{money(charge.amount)}</dd></div>
        <div><dt>Account</dt><dd>{charge.account}</dd></div>
        <div><dt>{dashboard && charge.type === "transaction" ? "Category" : "Source"}</dt><dd>{charge.source}</dd></div>
      </dl>
      <div className="obligation-match-plan"><strong>Planned obligation</strong><span>{obligation.name} · {money(obligation.amount)} · due {obligation.dueDate}</span></div>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-footer">{!dashboard && <button type="button" className="secondary-button" disabled={busy || !charge} onClick={() => void decide("dismissed")}>Not this charge</button>}<button type="button" className="secondary-button" disabled={busy} autoFocus={!dashboard} onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !charge} onClick={() => void decide("confirmed")}>{busy ? "Saving…" : "Confirm match"}</button></div>
  </dialog>;
}
