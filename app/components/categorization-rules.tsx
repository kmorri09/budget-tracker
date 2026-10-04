"use client";

import { useState } from "react";
import type { DashboardData } from "../../lib/workspace-types";
import { useConfirmDialog } from "./confirm-dialog";
import DataTable from "./data-table";

export default function CategorizationRules({ dashboard, onChanged }: { dashboard: DashboardData; onChanged: (message?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog: confirmationDialog } = useConfirmDialog();
  const rules = dashboard.categorizationRules ?? [];
  const categoryCount = new Set(rules.map(rule => rule.categoryId)).size;

  async function remove(id: string, matchText: string) {
    if (busy) return;
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
    <div className="view-heading rules-heading"><div><h2>Automatic categorization</h2><p>{rules.length} {rules.length === 1 ? "rule" : "rules"} across {categoryCount} {categoryCount === 1 ? "category" : "categories"}</p></div><a className="secondary-button" href="/#review">Review imports →</a></div>
    <p className="field-help rules-help">Add a rule by editing a Plaid import in Review and selecting “Always use this category.” Matching future expenses and refunds get that category and still appear in Review.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <DataTable title="Rules" rows={rules.map(rule => ({ id: rule.id, name: rule.matchText, category: rule.category }))}
      defaultPageSize={25}
      columns={[{ key: "name", label: "Description contains" }, { key: "category", label: "Assign category" }]}
      facets={[{ key: "category", label: "Category" }]}
      rowActions={[{ label: "Remove", disabled: busy, onClick: row => void remove(row.id, String(row.name)) }]}
      emptyMessage="Create your first rule from a Plaid import in Review using ‘Always use this category.’" />
    {confirmationDialog}</div>;
}
