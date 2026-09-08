"use client";

import { useCallback, useEffect, useState } from "react";
import DataTable from "./components/data-table";
import EntryForm, { actionLabels } from "./components/entry-form";
import CategoryEditDialog from "./components/category-edit-dialog";
import CategoryReconcileDialog from "./components/category-reconcile-dialog";
import CardCoverageReconcileDialog from "./components/card-coverage-reconcile-dialog";
import TransactionEditDialog from "./components/transaction-edit-dialog";
import BudgetReconcileDialog from "./components/budget-reconcile-dialog";
import BankConnections from "./components/bank-connections";
import { type ActionType, type DashboardData, kindLabel, money, signedAmount, today } from "../lib/workspace-types";
import { categoriesAllocatedInLastDays } from "../lib/recent-allocations";
import "./workspace.css";

const navigation = [
  { key: "home", label: "Home", icon: "⌂" },
  { key: "transactions", label: "Transactions", icon: "⇅" },
  { key: "payments", label: "Card payments", icon: "↔" },
  { key: "categories", label: "Categories", icon: "▦" },
  { key: "allocations", label: "Allocations", icon: "⇄" },
  { key: "review", label: "Review", icon: "◎" },
  { key: "accounts", label: "Accounts", icon: "▤" },
] as const;
type Destination = typeof navigation[number]["key"];
const quickActions: ActionType[] = ["transaction", "income", "allocation", "transfer", "payment"];
const subtitles: Record<Destination, string> = {
  home: "Your rolling plan, at a glance.",
  transactions: "Every account entry, including income, expenses, payments, and reconciliation adjustments.",
  payments: "Payments from cash accounts to credit cards, with purchase coverage.",
  categories: "Where your money is assigned. Balances roll forward without a monthly reset.",
  allocations: "Your funding history. Moving funds creates a removal and an addition; it does not move cash.",
  review: "Check imported activity and other items that need your attention.",
  accounts: "Manage accounts, reconcile balances, and configure bank connections.",
};

export default function Home() {
  const [destination, setDestination] = useState<Destination>("home");
  const [action, setAction] = useState<ActionType | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [name, setName] = useState("Owner");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [drilldown, setDrilldown] = useState<{ category?: string; key: number }>({ key: 0 });
  const [editingCategory, setEditingCategory] = useState<DashboardData["categories"][number] | null>(null);
  const [reconcilingCategories, setReconcilingCategories] = useState(false);
  const [reconcilingCoverage, setReconcilingCoverage] = useState(false);
  const [reconcilingBudget, setReconcilingBudget] = useState(false);
  const [paymentTransactionIds, setPaymentTransactionIds] = useState<string[]>([]);
  const [editingTransaction, setEditingTransaction] = useState<DashboardData["activity"][number] | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error("Your budget could not be loaded. Please retry.");
      setDashboard(await response.json());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not connect."); }
  }, []);

  useEffect(() => {
    fetch("/api/auth/session").then(response => response.json()).then(session => {
      if (!session.user) { window.location.assign("/login"); return; }
      setName(session.user.displayName); void refresh();
    }).catch(() => setError("Could not check your session. Please reload this page."));
    function readHash() {
      const hash = window.location.hash.slice(1);
      const aliases: Record<string, string> = { budget: "categories", activity: "transactions", more: "accounts" };
      const key = aliases[hash] ?? hash;
      setDestination(navigation.some(item => item.key === key) ? key as Destination : "home");
    }
    readHash(); window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [refresh]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    if (!quickOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest(".quick-menu")) setQuickOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setQuickOpen(false); document.querySelector<HTMLButtonElement>(".quick-menu > button")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [quickOpen]);

  function navigate(next: Destination) { window.location.hash = next; setDestination(next); setQuickOpen(false); window.scrollTo({ top: 0 }); }
  function openAction(next: ActionType) { setQuickOpen(false); if (next !== "payment") setPaymentTransactionIds([]); setAction(next); }
  function viewCategory(category: string) { setDrilldown(current => ({ category, key: current.key + 1 })); navigate("transactions"); }
  function paySelected(rows: { id: string }[]) {
    const entries = rows.map(row => dashboard?.activity.find(entry => entry.id === row.id)).filter((entry): entry is DashboardData["activity"][number] => Boolean(entry));
    if (new Set(entries.map(entry => entry.accountId)).size !== 1) { setToast("Choose unpaid purchases from one credit card at a time"); return; }
    setPaymentTransactionIds(entries.map(entry => entry.id)); setAction("payment");
  }
  function saved() { setAction(null); setPaymentTransactionIds([]); setToast("Saved to your budget"); void refresh(); }
  const title = destination === "home" ? "Hello, " + name : navigation.find(item => item.key === destination)!.label;

  return <main className="app-shell workspace">
    <a href="#workspace-content" className="skip-link">Skip to content</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">$</span><span>Budget</span><small>private workspace</small></div>
      <p className="workspace-owner">{name}&apos;s rolling budget</p>
      <nav className="side-nav" aria-label="Primary navigation">{navigation.map(item => <button key={item.key} className={"nav-item " + (destination === item.key ? "active" : "")} aria-current={destination === item.key ? "page" : undefined} onClick={() => navigate(item.key)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.key === "review" && !!dashboard?.reviews.length && <em>{dashboard.reviews.length}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><p>Private workspace<br />Balances roll forward. Analytics use the last 30 days.</p></div>
    </aside>
    <div className="content-wrap" id="workspace-content" tabIndex={-1}>
      <header className="topbar"><div>{destination !== "home" && <p className="eyebrow">Your workspace</p>}<h1>{title}</h1></div><div className="top-actions"><div className="quick-menu"><button className="primary-button quick-trigger" aria-expanded={quickOpen} aria-haspopup="menu" aria-controls="quick-entry-menu" onClick={() => setQuickOpen(!quickOpen)}>Quick actions <span className="quick-chevron" aria-hidden="true" /></button>{quickOpen && <div id="quick-entry-menu" className="quick-popover" role="menu" onKeyDown={event => { if (event.key === "Escape") setQuickOpen(false); }}>{[...quickActions, "category", "account"].map(item => <button role="menuitem" key={item} onClick={() => openAction(item as ActionType)}>{actionLabels[item as ActionType]}</button>)}</div>}</div></div></header>
      <p className="page-description">{subtitles[destination]}</p>
      {error && <div className="error-banner" role="alert">{error} <button className="secondary-button" onClick={() => void refresh()}>Retry</button></div>}
      {!dashboard && !error && <p role="status">Loading your private budget…</p>}
      {dashboard && <>
        <section hidden={destination !== "home"} aria-label="Home"><Overview dashboard={dashboard} navigate={navigate} onAction={openAction} onReconcileBudget={() => setReconcilingBudget(true)} viewCategory={viewCategory} /></section>
        <section hidden={destination !== "transactions"} aria-label="Transactions">
          <div className="view-heading"><p>Money in is positive; money out is negative.</p><div className="section-actions"><button className="secondary-button" onClick={() => setReconcilingCoverage(true)}>Reconcile card coverage</button><button className="secondary-button" onClick={() => openAction("income")}>＋ Income</button><button className="primary-button" onClick={() => openAction("transaction")}>＋ Add transaction</button></div></div>
          <DataTable key={drilldown.key} initialCategory={drilldown.category} title="Transactions" dated amountKey="amount" amountLabel="Net amount" rows={dashboard.activity.map(entry => ({ id: entry.id, name: entry.description, date: entry.date, account: entry.account, category: entry.category ?? "Uncategorized", type: kindLabel(entry.kind), paymentStatus: entry.paymentStatus, status: entry.pending ? "Pending" : kindLabel(entry.status), source: kindLabel(entry.source), amount: signedAmount(entry), remainingToPay: entry.remainingToPay }))}
            columns={[{ key: "name", label: "Description" }, { key: "date", label: "Date" }, { key: "amount", label: "Amount", money: true }, { key: "category", label: "Category" }, { key: "account", label: "Account", detail: true }, { key: "type", label: "Type", detail: true }, { key: "paymentStatus", label: "Card coverage", detail: true }, { key: "status", label: "Status", detail: true }, { key: "source", label: "Source", detail: true }]}
            facets={[{ key: "category", label: "Category" }, { key: "account", label: "Account" }, { key: "type", label: "Type" }, { key: "paymentStatus", label: "Card coverage" }, { key: "status", label: "Status" }, { key: "source", label: "Source" }]}
            rowActions={[{ label: "Edit", onClick: row => { const transaction = dashboard.activity.find(entry => entry.id === row.id); if (transaction) setEditingTransaction(transaction); } }]}
            selection={{ actionLabel: "Create card payment", isEligible: row => row.type === "Expense" && row.paymentStatus !== "Paid" && row.paymentStatus !== "Not applicable" && Number(row.remainingToPay) > 0, onAction: paySelected }} />
        </section>
        <section hidden={destination !== "payments"} aria-label="Card payments">
          <div className="view-heading"><p>Each payment moves cash to a card and is applied to its oldest unpaid purchases.</p><div className="section-actions"><button className="primary-button" onClick={() => openAction("payment")}>＋ Record card payment</button></div></div>
          <DataTable title="Card payments" dated amountKey="amount" amountLabel="Payment amount" rows={dashboard.payments.map(payment => ({ id: payment.id, name: payment.description, date: payment.date, fromAccount: payment.fromAccount, toAccount: payment.toAccount, amount: payment.amount, applied: payment.applied, remaining: payment.remaining, status: payment.status, covered: payment.covered }))}
            columns={[{ key: "name", label: "Description" }, { key: "date", label: "Date" }, { key: "fromAccount", label: "From account" }, { key: "toAccount", label: "To card" }, { key: "amount", label: "Amount", money: true }, { key: "applied", label: "Applied to purchases", money: true, detail: true }, { key: "remaining", label: "Unapplied", money: true, detail: true }, { key: "status", label: "Status", detail: true }, { key: "covered", label: "Covered purchases", detail: true }]}
            facets={[{ key: "fromAccount", label: "From account" }, { key: "toAccount", label: "To card" }, { key: "status", label: "Status" }]} />
        </section>
        <section hidden={destination !== "categories"} aria-label="Categories">
          <div className="view-heading"><p>Available to assign: <strong>{money(dashboard.remainingToBudget)}</strong></p><div className="section-actions"><button className="secondary-button" onClick={() => setReconcilingCategories(true)}>Reconcile balances</button><button className="secondary-button" onClick={() => openAction("category")}>＋ Category</button><button className="primary-button" onClick={() => openAction("allocation")}>Allocate money</button></div></div>
          <p className="field-help">Use Edit to change a category&apos;s details, or View transactions to inspect its full history. Funding and spending totals below are lifetime amounts; Available is the current rolling balance.</p>
          <DataTable title="Categories" amountKey="available" amountLabel="Available" rows={dashboard.categories.map(category => ({ id: category.id, name: category.name, available: category.available, allocated: category.allocated, spent: category.spent, target: category.target, status: category.available < 0 ? "Overspent" : category.available === 0 ? "Empty" : category.target > category.available ? "Below target" : category.target > 0 ? "Funded" : "Available" }))}
            columns={[{ key: "name", label: "Category" }, { key: "available", label: "Available", money: true }, { key: "status", label: "Status" }, { key: "target", label: "Target", money: true, detail: true }, { key: "allocated", label: "Net funding", money: true, detail: true }, { key: "spent", label: "Net spending", money: true, detail: true }]} facets={[{ key: "status", label: "Status" }]}
            rowActions={[{ label: "Edit", onClick: row => { const category = dashboard.categories.find(item => item.id === row.id); if (category) setEditingCategory(category); } }, { label: "View transactions", onClick: row => viewCategory(String(row.name)) }]} />
        </section>
        <section hidden={destination !== "allocations"} aria-label="Allocations">
          <div className="view-heading"><p>Available to assign: <strong>{money(dashboard.remainingToBudget)}</strong></p><div className="section-actions"><button className="secondary-button" onClick={() => setReconcilingBudget(true)}>Reconcile available</button><button className="secondary-button" onClick={() => openAction("transfer")}>Move funds</button><button className="primary-button" onClick={() => openAction("allocation")}>＋ Allocate money</button></div></div>
          <DataTable title="Allocations" dated amountKey="amount" amountLabel="Net funding" rows={dashboard.allocations.map(allocation => ({ id: allocation.id, name: allocation.note || "Allocation", date: allocation.date, category: allocation.category, amount: allocation.amount, direction: allocation.amount < 0 ? "Removed" : "Added" }))}
            columns={[{ key: "name", label: "Note" }, { key: "date", label: "Date" }, { key: "category", label: "Category" }, { key: "amount", label: "Amount", money: true }, { key: "direction", label: "Direction", detail: true }]} facets={[{ key: "category", label: "Category" }, { key: "direction", label: "Direction" }]} />
        </section>
        <section hidden={destination !== "review"} aria-label="Review"><ReviewInbox dashboard={dashboard} onChanged={() => { setToast("Review updated"); void refresh(); }} /></section>
  <section hidden={destination !== "accounts"} aria-label="Accounts"><Accounts dashboard={dashboard} onAction={openAction} onChanged={(message) => { setToast(message ?? "Account updated"); void refresh(); }} /></section>
      </>}
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(item => <button key={item.key} className={"mobile-nav-item " + (destination === item.key ? "active" : "")} aria-current={destination === item.key ? "page" : undefined} onClick={() => navigate(item.key)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.key === "review" && !!dashboard?.reviews.length && <em>{dashboard.reviews.length}</em>}</button>)}</nav>
    {dashboard && action && <EntryForm action={action} dashboard={dashboard} initialPaymentTransactionIds={paymentTransactionIds} onClose={() => { setAction(null); setPaymentTransactionIds([]); }} onSaved={saved} />}
    {editingCategory && <CategoryEditDialog category={editingCategory} onClose={() => setEditingCategory(null)} onSaved={() => { setEditingCategory(null); setToast("Category details updated"); void refresh(); }} />}
    {dashboard && reconcilingCategories && <CategoryReconcileDialog categories={dashboard.categories} onClose={() => setReconcilingCategories(false)} onSaved={(count) => { setReconcilingCategories(false); setToast(count ? `${count} category ${count === 1 ? "balance" : "balances"} reconciled` : "Category balances already matched"); void refresh(); }} />}
    {dashboard && reconcilingCoverage && <CardCoverageReconcileDialog dashboard={dashboard} onClose={() => setReconcilingCoverage(false)} onSaved={(count, state) => { setReconcilingCoverage(false); setToast(count ? `${count} card ${count === 1 ? "purchase" : "purchases"} marked ${state}` : `Selected purchases were already ${state}`); void refresh(); }} />}
    {dashboard && reconcilingBudget && <BudgetReconcileDialog dashboard={dashboard} onClose={() => setReconcilingBudget(false)} onSaved={(delta) => { setReconcilingBudget(false); setToast(delta ? `Available to assign reconciled by ${money(delta)}` : "Available to assign already matched"); void refresh(); }} />}
    {editingTransaction && dashboard && <TransactionEditDialog transaction={editingTransaction} dashboard={dashboard} onClose={() => setEditingTransaction(null)} onSaved={(message) => { setEditingTransaction(null); setToast(message); void refresh(); }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

function Overview({ dashboard: data, navigate, onAction, onReconcileBudget, viewCategory }: { dashboard: DashboardData; navigate: (destination: Destination) => void; onAction: (action: ActionType) => void; onReconcileBudget: () => void; viewCategory: (category: string) => void }) {
  const overspent = data.categories.filter(c => c.available < 0);
  const recentlyAllocated = categoriesAllocatedInLastDays(data.categories, data.allocations, today());
  return <>
    <div className="hero-grid"><article className="balance-card"><p className="eyebrow light">Ledger balance</p><h2>{money(data.ledgerBalance)}</h2><p className="balance-sub">Across {data.accounts.filter(account => account.type !== "credit_card").length} cash accounts · excludes card debt</p><div className="balance-footer"><span>Your recorded balances</span><button onClick={() => navigate("accounts")}>Accounts & reconcile →</button></div></article><article className="remaining-card"><p className="eyebrow">Available to assign</p><h2>{money(data.remainingToBudget)}</h2><p className="remaining-description">Current unassigned money · rolls forward indefinitely</p><div className="remaining-actions"><button className="text-button" onClick={() => onAction("allocation")}>Allocate money →</button><button className="text-button" onClick={onReconcileBudget}>Explain & reconcile →</button></div></article></div>
    <section className="quick-section"><div className="section-heading"><h2>Quick actions</h2></div><div className="quick-actions">{quickActions.map((action, index) => <button key={action} onClick={() => onAction(action)}><span className={"action-icon action-icon-" + action}>{["＋", "↗", "▣", "⇄", "▤"][index]}</span><strong>{actionLabels[action]}</strong></button>)}</div></section>
    <div className="analytics-grid"><article className="panel"><p className="eyebrow">Income · last 30 days</p><h3>{money(data.trailing30.income)}</h3><small>{data.trailing30.startDate} – {data.trailing30.endDate}</small></article><article className="panel"><p className="eyebrow">Spending · last 30 days</p><h3>{money(data.trailing30.spending)}</h3><small>Expenses only · excludes payments, refunds, and reconciliation</small></article></div>
    <div className="main-grid"><article className="panel"><div className="section-heading"><div><h2>Category balances</h2><p className="section-context">Allocated in the last 28 days</p></div><button className="text-link" onClick={() => navigate("categories")}>All categories →</button></div>{!data.categories.length && <p className="empty-state">Add categories to start planning your money.</p>}{recentlyAllocated.map(category => <div className="overview-row" key={category.id}><button className="text-link" onClick={() => viewCategory(category.name)}>{category.name}</button><span className={category.available < 0 ? "negative" : ""}>{money(category.available)}<small>{category.available < 0 ? "Overspent" : "Available"}</small></span></div>)}{!!data.categories.length && !recentlyAllocated.length && <p className="empty-state">No categories were allocated money in the last 28 days.</p>}</article>
      <div className="right-stack"><article className="panel"><div className="section-heading"><h2>Needs attention</h2></div><button className="attention-link" onClick={() => navigate("review")}><span>Review inbox</span><strong>{data.reviews.length} open →</strong></button><button className="attention-link" onClick={() => navigate("categories")}><span>Overspent categories</span><strong>{overspent.length} →</strong></button></article><article className="panel"><div className="section-heading"><h2>Upcoming obligations</h2></div>{data.obligations.length ? [...data.obligations].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(item => <div className="overview-row" key={item.id}><span>{item.name}<small>{item.dueDate} · {item.category}</small></span><strong>{money(item.amount)}</strong></div>) : <p className="empty-state">No obligations yet.</p>}</article></div></div>
    <article className="panel activity-panel"><div className="section-heading"><h2>Recent transactions</h2><button className="text-link" onClick={() => navigate("transactions")}>All transactions →</button></div>{data.activity.slice(0, 8).map(entry => <div className="overview-row" key={entry.id}><span>{entry.description}<small>{entry.date} · {entry.account} · {entry.category ?? kindLabel(entry.kind)}</small></span><strong className={signedAmount(entry) < 0 ? "negative" : ""}>{money(signedAmount(entry))}</strong></div>)}{!data.activity.length && <p className="empty-state">No transactions yet. Add one or import your Notion snapshot from Accounts.</p>}</article>
  </>;
}

function ReviewInbox({ dashboard, onChanged }: { dashboard: DashboardData; onChanged: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [search, setSearch] = useState("");
  async function resolve(id?: string) {
    if (!id && !window.confirm("Resolve all " + dashboard.reviews.length + " open review items? This does not change the underlying transactions.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/reviews", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(id ? { id } : { all: true }), status: "resolved" }) });
      if (!response.ok) throw new Error("Could not resolve reviews. Please try again.");
      onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed."); } finally { setBusy(false); }
  }
  const visible = dashboard.reviews.filter(item => (item.title + " " + item.details).toLowerCase().includes(search.toLowerCase()));
  return <div className="panel"><div className="view-heading"><label className="table-search"><span className="sr-only">Search reviews</span><input type="search" placeholder="Search reviews…" value={search} onChange={event => setSearch(event.target.value)} /></label>{dashboard.reviews.length > 0 && <button className="secondary-button" disabled={busy} onClick={() => void resolve()}>Resolve all ({dashboard.reviews.length})</button>}</div><p className="field-help">Resolve marks a review as handled. It does not change an amount, category, or payment. Resolve all applies to the entire inbox, including hidden search results.</p>{error && <p className="form-error" role="alert">{error}</p>}{visible.map(item => <div className="review-item" key={item.id}><div><strong>{item.title}</strong><p>{item.details}</p></div><button className="secondary-button" disabled={busy} onClick={() => void resolve(item.id)}>Resolve</button></div>)}{!visible.length && <p className="empty-state">{dashboard.reviews.length ? "No matching reviews." : "Nothing needs review right now."}</p>}</div>;
}

function Accounts({ dashboard, onAction, onChanged }: { dashboard: DashboardData; onAction: (action: ActionType) => void; onChanged: (message?: string) => void }) {
  const [reconciling, setReconciling] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null), [balance, setBalance] = useState("");
  const [search, setSearch] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const visible = dashboard.accounts.filter(account => (account.name + " " + account.institution + " " + account.type).toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  async function removeAccount(account: DashboardData["accounts"][number]) {
    if (!window.confirm("Remove " + account.name + "? It will be archived from this workspace so its transaction history and audit trail remain intact.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not remove account.");
      onChanged("Account removed from this workspace");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed."); } finally { setBusy(false); }
  }
  return <>
    <div className="view-heading"><label className="table-search"><span className="sr-only">Search accounts</span><input type="search" placeholder="Find an account or bank…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="primary-button" onClick={() => onAction("account")}>＋ Add account</button></div>
    <p className="field-help account-management-note">Edit account details without changing its ledger. Removing an account archives it rather than deleting its history.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="account-grid">{visible.map(account => {
      const target = account.type === "credit_card" ? -Math.abs(Number(balance)) : Number(balance);
      const delta = balance.trim() && Number.isFinite(target) ? target - account.ledgerBalance : null;
      return <article className="panel account-card" key={account.id}>
        {editing === account.id ? <form className="account-edit-form" onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError("");
          const values = Object.fromEntries(new FormData(event.currentTarget));
          try {
            const response = await fetch("/api/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id, name: values.name, institution: values.institution, type: values.type, syncEnabled: values.syncEnabled === "on" }) });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.error ?? "Could not update account.");
            setEditing(null); onChanged("Account details updated");
          } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed."); } finally { setBusy(false); }
        }}>
          <div className="account-edit-heading"><h2>Edit account</h2><button className="text-link" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
          <label>Account name<input name="name" defaultValue={account.name} required maxLength={80} autoFocus /></label>
          <label>Bank or provider<input name="institution" defaultValue={account.institution} required maxLength={80} /></label>
          <label>Account type<select name="type" defaultValue={account.type}><option value="checking">Checking</option><option value="savings">Savings</option><option value="credit_card">Credit card</option></select></label>
          <label className="toggle-field"><input name="syncEnabled" type="checkbox" defaultChecked={account.syncEnabled} /> Enable automatic sync for this account</label>
          <div className="section-actions"><button className="primary-button" disabled={busy}>Save changes</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void removeAccount(account)}>Remove account</button></div>
        </form> : <>
          <div className="account-card-heading"><div><div className="account-title-row"><h2>{account.name}</h2>{account.isDefaultCash && <span className="account-default-badge">Default income</span>}</div><p className="field-help">{account.institution.replace(/\s*·\s*credit card$/i, "").trim()} · {kindLabel(account.type)} · {account.syncEnabled ? "Sync enabled" : "Manual"}</p></div><button className="icon-button account-menu-button" type="button" aria-label={"Edit " + account.name} onClick={() => { setEditing(account.id); setReconciling(null); }}>✎</button></div>
          <dl><div><dt>Ledger balance</dt><dd>{money(account.ledgerBalance)}</dd></div><div><dt>Last provider balance</dt><dd>{account.providerBalance === null ? "Not recorded" : money(account.providerBalance)}</dd></div></dl>{account.providerBalanceAt && <p className="field-help">Recorded {new Date(account.providerBalanceAt).toLocaleDateString()}</p>}
          {reconciling === account.id ? <form className="inline-form" onSubmit={async event => {
            event.preventDefault(); setBusy(true); setError("");
            try {
              const response = await fetch("/api/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id, providerBalance: balance }) });
              const result = await response.json().catch(() => null);
              if (!response.ok) throw new Error(result?.error ?? "Could not reconcile account.");
              setReconciling(null); onChanged("Account reconciled");
            } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed."); } finally { setBusy(false); }
          }}><label>{account.type === "credit_card" ? "Amount owed today (positive)" : "Provider balance today"}<input type="number" step="0.01" required value={balance} onChange={event => setBalance(event.target.value)} autoFocus disabled={busy} /></label>{delta !== null && <p className="field-help">Creates a <strong>{money(delta)}</strong> ledger adjustment. No expense or payment is created.</p>}<div className="section-actions"><button className="primary-button" disabled={busy}>Force reconcile</button><button className="secondary-button" disabled={busy} type="button" onClick={() => setReconciling(null)}>Cancel</button></div></form> : <div className="account-card-actions"><button className="secondary-button" disabled={busy} onClick={() => { setReconciling(account.id); setBalance(""); }}>Reconcile balance</button>{account.type !== "credit_card" && !account.isDefaultCash && <button className="text-link" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const response = await fetch("/api/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id, isDefaultCash: true }) }); const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.error ?? "Could not set the default income account."); onChanged("Default income account updated"); } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed."); } finally { setBusy(false); } }}>Make default</button>}<button className="text-link" disabled={busy} onClick={() => { setEditing(account.id); setReconciling(null); }}>Edit details</button></div>}
        </>}
      </article>;
    })}</div>
    {!visible.length && <p className="empty-state">{dashboard.accounts.length ? "No matching accounts." : "Add your checking, savings, or credit card accounts to get started."}</p>}
    <section className="panel settings-panel"><h2>Workspace settings</h2><div className="settings-row"><div><strong>Import from Notion</strong><p className="field-help">Upload a private snapshot directly to this app. Preview before importing.</p></div><a className="secondary-button" href="/import">Import Notion</a></div><BankConnections dashboard={dashboard} onChanged={(message) => onChanged(message)} /><div className="settings-row"><span>Private session</span><button className="secondary-button" onClick={async () => { try { const response = await fetch("/api/auth/logout", { method: "POST" }); if (!response.ok) throw new Error(); window.location.assign("/login"); } catch { setError("Could not sign out. Please try again."); } }}>Sign out</button></div></section>
  </>;
}
