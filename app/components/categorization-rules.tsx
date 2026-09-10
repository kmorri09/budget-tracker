"use client";

import { useState } from "react";
import type { DashboardData } from "../../lib/workspace-types";
import { useConfirmDialog } from "./confirm-dialog";

export default function CategorizationRules({ dashboard, onChanged }: { dashboard: DashboardData; onChanged: (message?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog: confirmationDialog } = useConfirmDialog();
  const rules = dashboard.categorizationRules ?? [];

  async function remove(id: string, matchText: string) {
    if (!await confirm({ title: `Remove the automatic rule for “${matchText}”?`, message: "Existing categorized transactions will not change.", confirmLabel: "Remove rule", destructive: true })) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/categorization-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not remove categorization rule.");
      onChanged("Automatic categorization rule removed");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not remove categorization rule."); }
    finally { setBusy(false); }
  }

  return <div className="categorization-rules">
    <div><strong>Automatic categorization</strong><p className="field-help">Rules created while reviewing Plaid imports apply to future matching expenses and refunds.</p></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {rules.length ? <div className="categorization-rule-list">{rules.map(rule => <div className="categorization-rule-row" key={rule.id}><span>Description contains <strong>“{rule.matchText}”</strong><small>Assign to {rule.category}</small></span><button type="button" className="text-link" disabled={busy} onClick={() => void remove(rule.id, rule.matchText)}>Remove</button></div>)}</div> : <p className="empty-state">No automatic categorization rules yet. Create one while editing a Plaid import from Review.</p>}
    {confirmationDialog}</div>;
}
