"use client";

import { useEffect, useRef, useState } from "react";
import { calculateCashBreakdown } from "../../lib/cash-breakdown";
import { money, type DashboardData } from "../../lib/workspace-types";

const colors = ["#277456", "#5f8b6b", "#8a9f63", "#af995e", "#9a7d92", "#658ca1", "#a87968", "#7a958b"];
const cents = (amount: number) => Math.round(amount * 100);

export default function CashBreakdown({ dashboard }: { dashboard: DashboardData }) {
  const cashCents = cents(dashboard.ledgerBalance);
  const breakdown = calculateCashBreakdown(cashCents, cents(dashboard.remainingToBudget), dashboard.categories.map(category => ({ id: category.id, name: category.name, availableCents: cents(category.available) })));
  const segments = [
    ...breakdown.fundedCategories.map((category, index) => ({ key: category.id, name: category.name, amountCents: category.availableCents, color: colors[index % colors.length] })),
    ...(breakdown.unassignedCents ? [{ key: "unassigned", name: "Available to assign", amountCents: breakdown.unassignedCents, color: "#bad5bf" }] : []),
    ...(breakdown.unmatchedCents ? [{ key: "unmatched", name: "Not matched to the budget", amountCents: breakdown.unmatchedCents, color: "#dce2de" }] : []),
  ];
  const cashMarker = breakdown.shortfallCents > 0 ? Math.max(0, cashCents / breakdown.scaleCents * 100) : null;
  const cashForUnassignedCents = Math.min(breakdown.unassignedCents, Math.max(0, cashCents - breakdown.reservedCents));
  const labelsRef = useRef<HTMLDivElement>(null);
  const [visibleLabels, setVisibleLabels] = useState<Set<string>>(() => new Set());
  const segmentSignature = segments.map(segment => `${segment.key}:${segment.name}:${segment.amountCents}`).join("|");

  useEffect(() => {
    const row = labelsRef.current;
    if (!row) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const visible = new Set<string>();
      Array.from(row.children).forEach((cell, index) => {
        const label = cell.firstElementChild as HTMLElement | null;
        if (label && label.scrollWidth + 8 <= cell.clientWidth) visible.add(segments[index].key);
      });
      setVisibleLabels(previous => previous.size === visible.size && [...previous].every(key => visible.has(key)) ? previous : visible);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    document.fonts.ready.then(measure);
    return () => { active = false; observer.disconnect(); };
  }, [segmentSignature]);

  return <section className="panel cash-breakdown" aria-labelledby="cash-breakdown-title">
    <div className="cash-breakdown-heading">
      <div><p className="eyebrow">Cash on hand</p><h2 id="cash-breakdown-title">Where your cash is planned</h2><p>Recorded cash across your accounts: <strong>{money(dashboard.ledgerBalance)}</strong></p></div>
      <span className="cash-breakdown-total">{money(breakdown.reservedCents / 100)}<small>in funded categories</small></span>
    </div>
    {breakdown.shortfallCents > 0 && <div className="cash-breakdown-shortfall" role="status">
      <strong>Cash shortfall: {money(breakdown.shortfallCents / 100)}</strong>
      <p>Your budget shows {money((breakdown.reservedCents + breakdown.unassignedCents) / 100)} across funded categories and available to assign, but your accounts only have {money(dashboard.ledgerBalance)} in recorded cash.</p>
      {breakdown.reservedCents <= breakdown.positiveCashCents && breakdown.unassignedCents > 0 && <p>Your funded categories are covered. Only <b>{money(cashForUnassignedCents / 100)}</b> of the <b>{money(breakdown.unassignedCents / 100)}</b> available to assign is backed by recorded cash.</p>}
    </div>}
    <p className="cash-breakdown-context">Category balances are shared across cash accounts. The chart compares your plan with recorded cash after entered transactions and card payments.</p>
    {breakdown.scaleCents > 0 ? <>
      <div className="cash-breakdown-labels" ref={labelsRef} aria-hidden="true">
        {segments.map(segment => <div className="cash-breakdown-label-cell" key={segment.key} style={{ width: `${segment.amountCents / breakdown.scaleCents * 100}%` }}><span style={{ visibility: visibleLabels.has(segment.key) ? "visible" : "hidden" }}>{segment.name}</span></div>)}
      </div>
      <div className="cash-breakdown-bar" role="img" aria-label={[...segments.map(segment => `${segment.name}: ${money(segment.amountCents / 100)}`), ...(cashMarker !== null ? [`Recorded cash limit: ${money(dashboard.ledgerBalance)}. Striped area: ${money(breakdown.shortfallCents / 100)} not covered by recorded cash.`] : [])].join("; ")}>
        {segments.map(segment => <span className="cash-breakdown-segment" key={segment.key} title={`${segment.name}: ${money(segment.amountCents / 100)}`} style={{ width: `${segment.amountCents / breakdown.scaleCents * 100}%`, backgroundColor: segment.color }} />)}
        {cashMarker !== null && <>
          <span className="cash-breakdown-uncovered" style={{ left: `${cashMarker}%` }} title={`${money(breakdown.shortfallCents / 100)} not covered by recorded cash`} />
          <span className="cash-breakdown-cash-marker" style={{ left: `${cashMarker}%` }} title={`Recorded cash runs out here: ${money(dashboard.ledgerBalance)}`} />
        </>}
      </div>
      {cashMarker !== null && <div className="cash-breakdown-legend">
        <span><i className="cash-breakdown-limit-key" aria-hidden="true" />Red line: recorded cash ends at {money(dashboard.ledgerBalance)}</span>
        <span><i className="cash-breakdown-uncovered-key" aria-hidden="true" />Striped area: {money(breakdown.shortfallCents / 100)} not covered by cash</span>
      </div>}
    </> : <p className="empty-state">No positive recorded cash or funded category balances to chart.</p>}
    {breakdown.overassignedCents > 0 && <p className="cash-breakdown-warning">The budget is overassigned by {money(breakdown.overassignedCents / 100)}.</p>}
    {breakdown.overspentCents > 0 && <p className="cash-breakdown-caution">Other categories are overspent by {money(breakdown.overspentCents / 100)}. Available to assign is the budget figure; check these deficits before treating it as free cash.</p>}
    {dashboard.providerBalance !== null && cents(dashboard.providerBalance) !== cashCents && <p className="cash-breakdown-context">Last bank-reported cash total: {money(dashboard.providerBalance)}. Recorded payments and other entries may have changed the cash ledger since that refresh.</p>}
    <p className="cash-breakdown-context">Card statement amounts appear here only to the extent their purchases are reflected in funded categories.</p>
  </section>;
}
