"use client";

import { useCallback, useEffect, useState } from "react";
import { kindLabel, money, signedAmount, type DashboardData, type ReviewHistoryItem } from "../../lib/workspace-types";

export default function ReviewHistory({ dashboard, onBack, onChanged, onEdit }: { dashboard: DashboardData; onBack: () => void; onChanged: () => void; onEdit: (transaction: DashboardData["activity"][number]) => void }) {
  const [items, setItems] = useState<ReviewHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (offset: number) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/reviews?offset=${offset}`, { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not load review history.");
      setItems(current => offset ? [...current, ...result.items] : result.items);
      setHasMore(Boolean(result.hasMore));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load review history."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(0); }, [load, dashboard]);

  async function reopen(id: string) {
    setBusyId(id); setError("");
    try {
      const response = await fetch("/api/reviews", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reopen: true }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not reopen this review.");
      onChanged(); onBack();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reopen this review."); }
    finally { setBusyId(null); }
  }

  return <div className="panel review-history">
    <div className="view-heading"><div><button className="text-link" onClick={onBack}>← Open reviews</button><h2>Review history</h2></div></div>
    <p className="field-help">These items were cleared from Review. Older entries may say “Resolved” when the exact action was not recorded. Reopening brings back the reminder; it does not undo a saved transaction edit, card payment, or bank activity exclusion.</p>
    {error && <p className="form-error" role="alert">{error} <button className="secondary-button" onClick={() => void load(0)}>Retry</button></p>}
    <div className="review-history-list">{items.map(item => {
      const currentEntry = item.transaction ? dashboard.activity.find(entry => entry.id === item.transaction?.id) : null;
      const reviewed = item.reviewedTransaction;
      const current = item.transaction;
      const showCurrent = current && (!reviewed || ["description", "amount", "kind", "date", "account", "category", "status"].some(key => current[key as keyof typeof current] !== reviewed[key as keyof typeof reviewed]));
      return <article className="review-history-item" key={item.id}>
        <div className="review-history-heading"><div><strong>{item.title}</strong><small>{item.resolution} · {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : "Date unavailable"}</small></div><span>{item.status === "dismissed" ? "Dismissed" : "Reviewed"}</span></div>
        {reviewed && <div className="review-history-transaction"><span>At approval: {reviewed.description} · {reviewed.date} · {reviewed.account}{reviewed.category ? ` · ${reviewed.category}` : ""} · {kindLabel(reviewed.kind)} · {kindLabel(reviewed.status)}</span><strong>{money(signedAmount(reviewed))}</strong></div>}
        {showCurrent && <div className="review-history-transaction"><span>Current entry: {current.description} · {current.date} · {current.account}{current.category ? ` · ${current.category}` : ""} · {kindLabel(current.kind)} · {kindLabel(current.status)}</span><strong>{money(signedAmount(current))}</strong></div>}
        {!current && !reviewed && <p className="field-help">No linked transaction is available for this review.</p>}
        <div className="review-history-actions">
          {currentEntry && <button className="secondary-button" disabled={Boolean(busyId)} onClick={() => onEdit(currentEntry)}>Edit current transaction</button>}
          {item.canReopen ? <button className="secondary-button" disabled={Boolean(busyId)} onClick={() => void reopen(item.id)}>{busyId === item.id ? "Reopening…" : "Reopen review"}</button> : item.resolution === "Ignored historical activity" || item.resolution === "Transaction deleted" ? <span>This entry was explicitly excluded. Check the statement, then add a correction in <a href="/#transactions">Transactions</a> if it should count.</span> : <span>Removed entry: investigate in <a href="/#accounts">Accounts</a> before restoring it.</span>}
        </div>
      </article>;
    })}</div>
    {!loading && !items.length && !error && <p className="empty-state">No past reviews yet.</p>}
    {loading && <p className="field-help" role="status">Loading review history…</p>}
    {hasMore && !loading && <button className="secondary-button review-history-more" onClick={() => void load(items.length)}>Show more</button>}
  </div>;
}
