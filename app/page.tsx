"use client";

import { useCallback, useEffect, useState } from "react";
import DataTable from "./components/data-table";
import EntryForm, { actionLabels } from "./components/entry-form";
import { type ActionType, type DashboardData, kindLabel, money, signedAmount } from "../lib/workspace-types";
import "./workspace.css";

const navigation = [
  { key: "home", label: "Home", icon: "⌂" },
  { key: "transactions", label: "Transactions", icon: "⇅" },
  { key: "categories", label: "Categories", icon: "▦" },
  { key: "allocations", label: "Allocations", icon: "⇄" },
  { key: "review", label: "Review", icon: "◎" },
] as const;
type Destination = typeof navigation[number]["key"] | "accounts";
const quickActions: ActionType[] = ["transaction", "income", "allocation", "transfer", "payment"];
const subtitles: Record<Destination, string> = {
  home: "Your rolling plan, at a glance.",
  transactions: "Every account entry, including income, expenses, payments, and reconciliation adjustments.",
  categories: "Where your money is assigned. Balances roll forward without a monthly reset.",
  allocations: "Your funding history. Moving funds creates a removal and an addition; it does not move cash.",
  review: "Check imported activity and other items that need your attention.",
  accounts: "Manage your accounts, reconcile balances, and access workspace settings.",
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
      setDestination(key === "accounts" || navigation.some(item => item.key === key) ? key as Destination : "home");
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
  function openAction(next: ActionType) { setQuickOpen(false); setAction(next); }
  function viewCategory(category: string) { setDrilldown(current => ({ category, key: current.key + 1 })); navigate("transactions"); }
  function saved() { setAction(null); setToast("Saved to your budget"); void refresh(); }
  const title = destination === "home" ? "Hello, " + name : destination === "accounts" ? "Accounts & settings" : navigation.find(item => item.key === destination)!.label;

  return <main className="app-shell workspace">
    <a href="#workspace-content" className="skip-link">Skip to content</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">$</span><span>Budget</span><small>private workspace</small></div>
      <p className="workspace-owner">{name}&apos;s rolling budget</p>
      <nav className="side-nav" aria-label="Primary navigation">{navigation.map(item => <button key={item.key} className={"nav-item " + (destination === item.key ? "active" : "")} aria-current={destination === item.key ? "page" : undefined} onClick={() => navigate(item.key)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.key === "review" && !!dashboard?.reviews.length && <em>{dashboard.reviews.length}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><button className={"nav-item " + (destination === "accounts" ? "active" : "")} aria-current={destination === "accounts" ? "page" : undefined} onClick={() => navigate("accounts")}><span aria-hidden="true">⚙</span>Accounts & settings</button><p>Private workspace<br />Balances roll forward. Analytics use the last 30 days.</p></div>
    </aside>
    <div className="content-wrap" id="workspace-content" tabIndex={-1}>
      <header className="topbar"><div><p className="eyebrow">{destination === "home" ? "Today" : "Your workspace"}</p><h1>{title}</h1></div><div className="top-actions"><button className="settings-shortcut secondary-button" aria-label="Accounts and settings" onClick={() => navigate("accounts")}>⚙ <span>Accounts</span></button><div className="quick-menu"><button className="primary-button" aria-expanded={quickOpen} aria-controls="quick-entry-menu" onClick={() => setQuickOpen(!quickOpen)}>＋ Add</button>{quickOpen && <div id="quick-entry-menu" className="quick-popover" onKeyDown={event => { if (event.key === "Escape") setQuickOpen(false); }}>{[...quickActions, "category", "account"].map(item => <button key={item} onClick={() => openAction(item as ActionType)}>{actionLabels[item as ActionType]}</button>)}</div>}</div></div></header>
      <p className="page-description">{subtitles[destination]}</p>
      {error && <div className="error-banner" role="alert">{error} <button className="secondary-button" onClick={() => void refresh()}>Retry</button></div>}
      {!dashboard && !error && <p role="status">Loading your private budget…</p>}
      {dashboard && <>
        <section hidden={destination !== "home"} aria-label="Home"><Overview dashboard={dashboard} navigate={navigate} onAction={openAction} viewCategory={viewCategory} /></section>
        <section hidden={destination !== "transactions"} aria-label="Transactions">
          <div className="view-heading"><p>Money in is positive; money out is negative.</p><div className="section-actions"><button className="secondary-button" onClick={() => openAction("income")}>＋ Income</button><button className="primary-button" onClick={() => openAction("transaction")}>＋ Add transaction</button></div></div>
          <DataTable key={drilldown.key} initialCategory={drilldown.category} title="Transactions" dated amountKey="amount" amountLabel="Net amount" rows={dashboard.activity.map(entry => ({ id: entry.id, name: entry.description, date: entry.date, account: entry.account, category: entry.category ?? "Uncategorized", type: kindLabel(entry.kind), status: entry.pending ? "Pending" : kindLabel(entry.status), source: kindLabel(entry.source), amount: signedAmount(entry) }))}
            columns={[{ key: "name", label: "Description" }, { key: "date", label: "Date" }, { key: "amount", label: "Amount", money: true }, { key: "category", label: "Category" }, { key: "account", label: "Account", detail: true }, { key: "type", label: "Type", detail: true }, { key: "status", label: "Status", detail: true }, { key: "source", label: "Source", detail: true }]}
            facets={[{ key: "category", label: "Category" }, { key: "account", label: "Account" }, { key: "type", label: "Type" }, { key: "status", label: "Status" }, { key: "source", label: "Source" }]} />
        </section>
        <section hidden={destination !== "categories"} aria-label="Categories">
          <div className="view-heading"><p>Available to assign: <strong>{money(dashboard.remainingToBudget)}</strong></p><div className="section-actions"><button className="secondary-button" onClick={() => openAction("category")}>＋ Category</button><button className="primary-button" onClick={() => openAction("allocation")}>Allocate money</button></div></div>
          <p className="field-help">Choose a category name to see its transactions across all dates. Funding and spending totals below are lifetime amounts; Available is the current rolling balance.</p>
          <DataTable title="Categories" amountKey="available" amountLabel="Available" onRow={row => viewCategory(String(row.name))} rows={dashboard.categories.map(category => ({ id: category.id, name: category.name, available: category.available, allocated: category.allocated, spent: category.spent, target: category.target, status: category.available < 0 ? "Overspent" : category.available === 0 ? "Empty" : category.target > category.available ? "Below target" : category.target > 0 ? "Funded" : "Available" }))}
            columns={[{ key: "name", label: "Category" }, { key: "available", label: "Available", money: true }, { key: "status", label: "Status" }, { key: "target", label: "Target", money: true, detail: true }, { key: "allocated", label: "Net funding", money: true, detail: true }, { key: "spent", label: "Net spending", money: true, detail: true }]} facets={[{ key: "status", label: "Status" }]} />
        </section>
        <section hidden={destination !== "allocations"} aria-label="Allocations">
          <div className="view-heading"><p>Available to assign: <strong>{money(dashboard.remainingToBudget)}</strong></p><div className="section-actions"><button className="secondary-button" onClick={() => openAction("transfer")}>Move funds</button><button className="primary-button" onClick={() => openAction("allocation")}>＋ Allocate money</button></div></div>
          <DataTable title="Allocations" dated amountKey="amount" amountLabel="Net funding" rows={dashboard.allocations.map(allocation => ({ id: allocation.id, name: allocation.note || "Allocation", date: allocation.date, category: allocation.category, amount: allocation.amount, direction: allocation.amount < 0 ? "Removed" : "Added" }))}
            columns={[{ key: "name", label: "Note" }, { key: "date", label: "Date" }, { key: "category", label: "Category" }, { key: "amount", label: "Amount", money: true }, { key: "direction", label: "Direction", detail: true }]} facets={[{ key: "category", label: "Category" }, { key: "direction", label: "Direction" }]} />
        </section>
        <section hidden={destination !== "review"} aria-label="Review"><ReviewInbox dashboard={dashboard} onChanged={() => { setToast("Review updated"); void refresh(); }} /></section>
        <section hidden={destination !== "accounts"} aria-label="Accounts and settings"><Accounts dashboard={dashboard} onAction={openAction} onChanged={() => { setToast("Account reconciled"); void refresh(); }} /></section>
      </>}
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(item => <button key={item.key} className={"mobile-nav-item " + (destination === item.key ? "active" : "")} aria-current={destination === item.key ? "page" : undefined} onClick={() => navigate(item.key)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.key === "review" && !!dashboard?.reviews.length && <em>{dashboard.reviews.length}</em>}</button>)}</nav>
    {dashboard && action && <EntryForm action={action} dashboard={dashboard} onClose={() => setAction(null)} onSaved={saved} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

function Overview({ dashboard: data, navigate, onAction, viewCategory }: { dashboard: DashboardData; navigate: (destination: Destination) => void; onAction: (action: ActionType) => void; viewCategory: (category: string) => void }) {
  const overspent = data.categories.filter(c => c.available < 0);
  return <>
    <div className="hero-grid"><article className="balance-card"><p className="eyebrow light">Ledger balance</p><h2>{money(data.ledgerBalance)}</h2><p className="balance-sub">Across {data.accounts.filter(account => account.type !== "credit_card").length} cash accounts · excludes card debt</p><div className="balance-footer"><span>Your recorded balances</span><button onClick={() => navigate("accounts")}>Accounts & reconcile →</button></div></article><article className="remaining-card"><p className="eyebrow">Available to assign</p><h2>{money(data.remainingToBudget)}</h2><p className="remaining-description">Current unassigned money · rolls forward indefinitely</p><button className="text-button" onClick={() => onAction("allocation")}>Allocate money →</button></article></div>
    <section className="quick-section"><div className="section-heading"><h2>Quick actions</h2></div><div className="quick-actions">{quickActions.map((action, index) => <button key={action} onClick={() => onAction(action)}><span className={"action-icon action-icon-" + action}>{["＋", "↗", "▣", "⇄", "▤"][index]}</span><strong>{actionLabels[action]}</strong></button>)}</div></section>
    <div className="analytics-grid"><article className="panel"><p className="eyebrow">Income · last 30 days</p><h3>{money(data.trailing30.income)}</h3><small>{data.trailing30.startDate} – {data.trailing30.endDate}</small></article><article className="panel"><p className="eyebrow">Spending · last 30 days</p><h3>{money(data.trailing30.spending)}</h3><small>Expenses only · excludes payments, refunds, and reconciliation</small></article></div>
    <div className="main-grid"><article className="panel"><div className="section-heading"><h2>Category balances</h2><button className="text-link" onClick={() => navigate("categories")}>All categories →</button></div>{!data.categories.length && <p className="empty-state">Add categories to start planning your money.</p>}{[...data.categories].sort((a, b) => a.available - b.available).slice(0, 6).map(category => <div className="overview-row" key={category.id}><button className="text-link" onClick={() => viewCategory(category.name)}>{category.icon} {category.name}</button><span className={category.available < 0 ? "negative" : ""}>{money(category.available)}<small>{category.available < 0 ? "Overspent" : "Available"}</small></span></div>)}</article>
      <div className="right-stack"><article className="panel"><div className="section-heading"><h2>Needs attention</h2></div><button className="attention-link" onClick={() => navigate("review")}><span>Review inbox</span><strong>{data.reviews.length} open →</strong></button><button className="attention-link" onClick={() => navigate("categories")}><span>Overspent categories</span><strong>{overspent.length} →</strong></button></article><article className="panel"><div className="section-heading"><h2>Upcoming obligations</h2></div>{data.obligations.length ? [...data.obligations].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(item => <div className="overview-row" key={item.id}><span>{item.name}<small>{item.dueDate} · {item.category}</small></span><strong>{money(item.amount)}</strong></div>) : <p className="empty-state">No obligations yet.</p>}</article></div></div>
    <article className="panel activity-panel"><div className="section-heading"><h2>Recent transactions</h2><button className="text-link" onClick={() => navigate("transactions")}>All transactions →</button></div>{data.activity.slice(0, 8).map(entry => <div className="overview-row" key={entry.id}><span>{entry.description}<small>{entry.date} · {entry.account} · {entry.category ?? kindLabel(entry.kind)}</small></span><strong className={signedAmount(entry) < 0 ? "negative" : ""}>{money(signedAmount(entry))}</strong></div>)}{!data.activity.length && <p className="empty-state">No transactions yet. Add one or import your Notion snapshot in Accounts & settings.</p>}</article>
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

function Accounts({ dashboard, onAction, onChanged }: { dashboard: DashboardData; onAction: (action: ActionType) => void; onChanged: () => void }) {
  const [reconciling, setReconciling] = useState<string | null>(null), [balance, setBalance] = useState("");
  const [search, setSearch] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const visible = dashboard.accounts.filter(account => (account.name + " " + account.institution + " " + account.type).toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return <>
    <div className="view-heading"><label className="table-search"><span className="sr-only">Search accounts</span><input type="search" placeholder="Find an account or bank…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="primary-button" onClick={() => onAction("account")}>＋ Add account</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="account-grid">{visible.map(account => {
      const target = account.type === "credit_card" ? -Math.abs(Number(balance)) : Number(balance);
      const delta = balance.trim() && Number.isFinite(target) ? target - account.ledgerBalance : null;
      return <article className="panel account-card" key={account.id}><h2>{account.name}</h2><p className="field-help">{account.institution} · {kindLabel(account.type)} · {account.syncEnabled ? "Sync enabled" : "Manual"}</p><dl><div><dt>Ledger balance</dt><dd>{money(account.ledgerBalance)}</dd></div><div><dt>Last provider balance</dt><dd>{account.providerBalance === null ? "Not recorded" : money(account.providerBalance)}</dd></div></dl>{account.providerBalanceAt && <p className="field-help">Recorded {new Date(account.providerBalanceAt).toLocaleDateString()}</p>}
        {reconciling === account.id ? <form className="inline-form" onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError("");
          try {
            const response = await fetch("/api/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id, providerBalance: balance }) });
            const result = await response.json().catch(() => null);
            if (!response.ok) throw new Error(result?.error ?? "Could not reconcile account.");
            setReconciling(null); onChanged();
          } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed."); } finally { setBusy(false); }
        }}><label>{account.type === "credit_card" ? "Amount owed today (positive)" : "Provider balance today"}<input type="number" step="0.01" required value={balance} onChange={event => setBalance(event.target.value)} autoFocus disabled={busy} /></label>{delta !== null && <p className="field-help">Creates a <strong>{money(delta)}</strong> ledger adjustment. No expense or payment is created.</p>}<div className="section-actions"><button className="primary-button" disabled={busy}>Force reconcile</button><button className="secondary-button" disabled={busy} type="button" onClick={() => setReconciling(null)}>Cancel</button></div></form> : <button className="secondary-button" disabled={busy} onClick={() => { setReconciling(account.id); setBalance(""); }}>Reconcile balance</button>}
      </article>;
    })}</div>
    {!visible.length && <p className="empty-state">{dashboard.accounts.length ? "No matching accounts." : "Add your checking, savings, or credit card accounts to get started."}</p>}
    <section className="panel settings-panel"><h2>Workspace settings</h2><div className="settings-row"><div><strong>Import from Notion</strong><p className="field-help">Upload a private snapshot directly to this app. Preview before importing.</p></div><a className="secondary-button" href="/import">Import Notion</a></div><div className="settings-row"><div><strong>Bank connections</strong><p className="field-help">Account connection setup is not available in this UI yet. All accounts support manual entries.</p></div></div><div className="settings-row"><span>Private session</span><button className="secondary-button" onClick={async () => { try { const response = await fetch("/api/auth/logout", { method: "POST" }); if (!response.ok) throw new Error(); window.location.assign("/login"); } catch { setError("Could not sign out. Please try again."); } }}>Sign out</button></div></section>
  </>;
}
