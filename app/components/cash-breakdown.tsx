import { calculateCashBreakdown } from "../../lib/cash-breakdown";
import { money, type DashboardData } from "../../lib/workspace-types";

const colors = ["#277456", "#5f8b6b", "#8a9f63", "#af995e", "#9a7d92", "#658ca1", "#a87968", "#7a958b"];
const cents = (amount: number) => Math.round(amount * 100);

export default function CashBreakdown({ dashboard, viewCategory }: { dashboard: DashboardData; viewCategory: (category: string) => void }) {
  const cashCents = cents(dashboard.ledgerBalance);
  const breakdown = calculateCashBreakdown(cashCents, cents(dashboard.remainingToBudget), dashboard.categories.map(category => ({ id: category.id, name: category.name, availableCents: cents(category.available) })));
  const segments = [
    ...breakdown.fundedCategories.map((category, index) => ({ key: category.id, name: category.name, amountCents: category.availableCents, color: colors[index % colors.length] })),
    ...(breakdown.unassignedCents ? [{ key: "unassigned", name: "Available to assign", amountCents: breakdown.unassignedCents, color: "#bad5bf" }] : []),
    ...(breakdown.unmatchedCents ? [{ key: "unmatched", name: "Not matched to the budget", amountCents: breakdown.unmatchedCents, color: "#dce2de" }] : []),
  ];
  const cashMarker = breakdown.shortfallCents > 0 ? Math.max(0, cashCents / breakdown.scaleCents * 100) : null;

  return <section className="panel cash-breakdown" aria-labelledby="cash-breakdown-title">
    <div className="cash-breakdown-heading">
      <div><p className="eyebrow">Cash on hand</p><h2 id="cash-breakdown-title">Where your cash is planned</h2><p>Recorded cash across your accounts: <strong>{money(dashboard.ledgerBalance)}</strong></p></div>
      <span className="cash-breakdown-total">{money(breakdown.reservedCents / 100)}<small>in funded categories</small></span>
    </div>
    <p className="cash-breakdown-context">Category balances are shared across cash accounts. The chart compares your plan with recorded cash after entered transactions and card payments.</p>
    {breakdown.scaleCents > 0 ? <>
      <div className="cash-breakdown-bar" aria-hidden="true">
        {segments.map(segment => <span key={segment.key} title={`${segment.name}: ${money(segment.amountCents / 100)}`} style={{ width: `${segment.amountCents / breakdown.scaleCents * 100}%`, backgroundColor: segment.color }} />)}
        {cashMarker !== null && <span className="cash-breakdown-cash-marker" style={{ left: `${cashMarker}%` }} />}
      </div>
      {breakdown.shortfallCents > 0 && <p className="cash-breakdown-warning" role="status">Your positive category balances and unassigned budget exceed recorded cash by {money(breakdown.shortfallCents / 100)}. The marker shows where cash runs out.</p>}
      <div className="cash-breakdown-list">
        {breakdown.fundedCategories.map((category, index) => <div className="cash-breakdown-item" key={category.id}><span className="cash-breakdown-dot" style={{ backgroundColor: colors[index % colors.length] }} /><button className="text-link" onClick={() => viewCategory(category.name)}>{category.name}</button><strong>{money(category.availableCents / 100)}</strong></div>)}
        {breakdown.unassignedCents > 0 && <div className="cash-breakdown-item"><span className="cash-breakdown-dot" style={{ backgroundColor: "#bad5bf" }} /><span>Available to assign</span><strong>{money(breakdown.unassignedCents / 100)}</strong></div>}
        {breakdown.unmatchedCents > 0 && <div className="cash-breakdown-item"><span className="cash-breakdown-dot" style={{ backgroundColor: "#dce2de" }} /><span>Cash not matched to budget</span><strong>{money(breakdown.unmatchedCents / 100)}</strong></div>}
      </div>
    </> : <p className="empty-state">No positive recorded cash or funded category balances to chart.</p>}
    {breakdown.overassignedCents > 0 && <p className="cash-breakdown-warning">The budget is overassigned by {money(breakdown.overassignedCents / 100)}.</p>}
    {breakdown.overspentCents > 0 && <p className="cash-breakdown-caution">Other categories are overspent by {money(breakdown.overspentCents / 100)}. Available to assign is the budget figure; check these deficits before treating it as free cash.</p>}
    {dashboard.providerBalance !== null && cents(dashboard.providerBalance) !== cashCents && <p className="cash-breakdown-context">Last bank-reported cash total: {money(dashboard.providerBalance)}. Recorded payments and other entries may have changed the cash ledger since that refresh.</p>}
    <p className="cash-breakdown-context">Card statement amounts appear here only to the extent their purchases are reflected in funded categories.</p>
  </section>;
}
