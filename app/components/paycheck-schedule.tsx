"use client";

import { useState } from "react";
import { money, type DashboardData } from "../../lib/workspace-types";

export default function PaycheckSchedule({ paycheck, onSaved }: { paycheck: DashboardData["paycheck"]; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return <details className="panel">
    <summary>{paycheck ? `Next paycheck ${paycheck.nextDate} · about ${money(paycheck.amount)}` : "Set up paycheck planning"}</summary>
    <p className="field-help">Automatic reserves cover obligations due through the next paycheck, including bills due that day. The amount is an estimate for planning.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/budget/paycheck", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anchorDate: form.get("anchorDate"), amountCents: Math.round(Number(form.get("amount")) * 100) }) });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? "Could not save the paycheck schedule.");
        onSaved();
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save the paycheck schedule."); }
      finally { setBusy(false); }
    }}>
      <div className="form-grid">
        <label>Next scheduled payday<input name="anchorDate" type="date" defaultValue={paycheck?.nextDate} required /></label>
        <label>Expected amount every two weeks<input name="amount" type="number" min="0.01" max="21474836.47" step="0.01" defaultValue={paycheck?.amount.toFixed(2)} required /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="secondary-button" disabled={busy}>{busy ? "Saving…" : "Save paycheck schedule"}</button>
    </form>
  </details>;
}
