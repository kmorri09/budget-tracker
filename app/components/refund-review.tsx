"use client";

import { useState } from "react";
import { money, type DashboardData, type RefundReview as Review } from "../../lib/workspace-types";

export default function RefundReview({ refund, dashboard, onSaved, formId, disabled = false, onBusyChange }: { refund: Review; dashboard: DashboardData; onSaved: (message: string) => void; formId?: string; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [transactionId, setTransactionId] = useState("");
  const [amount, setAmount] = useState((refund.remaining || refund.amount).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = busy || disabled;
  const entry = dashboard.activity.find(t => t.id === refund.id);
  const candidates = dashboard.activity.filter(t => t.accountId === entry?.accountId && t.kind === "expense" && t.status === "posted" && !t.pending && t.date <= refund.date);
  async function decide(id: string, value: number, status: "confirmed" | "dismissed") {
    setBusy(true); onBusyChange?.(true); setError("");
    try {
      const response = await fetch("/api/card-refunds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refundId: refund.id, transactionId: id, amount: value, status }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not save the refund match.");
      onSaved(status === "confirmed" ? result?.reviewResolved ? "Refund matched and reviewed; card coverage recalculated" : "Refund matched; card coverage recalculated" : "Refund match dismissed; card credit preserved");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save the refund match."); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <section className="refund-review" aria-label="Refund coverage">
    <h3>Refund coverage</h3>
    <p className="field-help">{money(refund.amount)} credited to {refund.account}. Matching explains which purchases were refunded; it does not move cash or count the refund twice.</p>
    <ul>{refund.links.map(link => <li key={link.transactionId}>{link.description} · {link.date} · {money(link.amount)} ({link.confidence}) <button type="button" className="text-link" disabled={saving} onClick={() => void decide(link.transactionId, link.amount, "dismissed")}>Remove match</button></li>)}</ul>
    {refund.remaining > 0 && <p className="field-help">{money(refund.remaining)} remains unmatched. It is already included as credit on this card. Choose the original purchase if the automatic match is ambiguous.</p>}
    <label>Original purchase<select name="refundTransactionId" form={formId} value={transactionId} disabled={saving} onChange={event => setTransactionId(event.target.value)}><option value="">Choose a purchase</option>{candidates.map(t => <option key={t.id} value={t.id}>{t.description} · {t.date} · {money(t.amount)}{refund.candidates.some(c => c.transactionId === t.id) ? " · suggested match" : ""}</option>)}</select></label>
    <label>Refund amount to match<input name="refundMatchAmount" form={formId} type="number" min="0.01" step="0.01" max={refund.amount} value={amount} disabled={saving} required={!!transactionId} onChange={event => setAmount(event.target.value)} /></label>
    {formId ? <p className="field-help">Save includes the selected purchase match. Matching the full refund clears it from the matching queue.</p> : <button className="secondary-button" type="button" disabled={saving || !transactionId || !(Number(amount) > 0)} onClick={() => void decide(transactionId, Number(amount), "confirmed")}>Match refund to purchase</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
