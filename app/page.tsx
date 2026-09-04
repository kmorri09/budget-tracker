"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ActionType = "transaction" | "income" | "allocation" | "transfer" | "payment" | null;
type NavKey = "home" | "budget" | "activity" | "review" | "more";

const demoCategories = [
  { name: "Housing", icon: "🏠", available: 0, target: 0, status: "No activity yet", tone: "blue" },
  { name: "Food", icon: "🥬", available: 0, target: 0, status: "No activity yet", tone: "green" },
  { name: "Transportation", icon: "🚗", available: 0, target: 0, status: "No activity yet", tone: "amber" },
  { name: "Travel", icon: "✈️", available: 0, target: 0, status: "No activity yet", tone: "purple" },
  { name: "Utilities", icon: "💡", available: 0, target: 0, status: "No activity yet", tone: "orange" },
  { name: "Fees", icon: "💳", available: 0, target: 0, status: "No activity yet", tone: "slate" },
];

const demoActivity = [
  { merchant: "Example purchase", meta: "Food · Demo card · Pending", amount: "-$12.00", icon: "•", state: "pending" },
  { merchant: "Example income", meta: "Income · Demo checking · Today", amount: "+$100.00", icon: "↗", state: "income" },
  { merchant: "Example import", meta: "Needs review · Demo card · Yesterday", amount: "-$20.00", icon: "•", state: "review" },
  { merchant: "Example bill", meta: "Utilities · Demo checking · Today", amount: "-$15.00", icon: "•", state: "cleared" },
];

const navItems: { key: NavKey; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "⌂" },
  { key: "budget", label: "Budget", icon: "▤" },
  { key: "activity", label: "Activity", icon: "↯" },
  { key: "review", label: "Review", icon: "◎" },
  { key: "more", label: "More", icon: "•••" },
];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function Progress({ value, target, tone }: { value: number; target: number; tone: string }) {
  const percent = Math.max(0, Math.min(100, Math.round((value / target) * 100)));
  return (
    <div className={`progress progress-${tone}`} aria-label={`${percent}% funded`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function ActionIcon({ type }: { type: Exclude<ActionType, null> }) {
  const icons = { transaction: "＋", income: "↗", allocation: "▣", transfer: "⇄", payment: "▤" };
  return <span className={`action-icon action-icon-${type}`}>{icons[type]}</span>;
}

type DashboardData = {
  ledgerBalance: number;
  providerBalance: number | null;
  remainingToBudget: number;
  allocationPercent: number;
  accounts: { id: string; name: string; institution: string; type: string; syncEnabled: boolean; ledgerBalance: number }[];
  categories: { id: string; name: string; icon: string; available: number; target: number }[];
  activity: { id: string; description: string; amount: number; kind: string; status: string; pending: boolean; date: string; category: string | null; account: string }[];
  trailing30: { income: number; spending: number; startDate: string; endDate: string };
  reviews: { id: string; kind: string; title: string; details: string | null }[];
};

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavKey>("home");
  const [action, setAction] = useState<ActionType>(null);
  const [showActions, setShowActions] = useState(false);
  const [toast, setToast] = useState("");
  const [authState, setAuthState] = useState<{ configured: boolean; required: boolean; user: { displayName: string } | null } | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const incomeTotal = 100;
  const remainingToBudget = dashboard?.remainingToBudget ?? 100;
  const allocationPercent = dashboard?.allocationPercent ?? 0;
  const ledgerBalance = dashboard?.ledgerBalance ?? 100;
  const accountCount = dashboard?.accounts.length ?? 3;
  const providerBalance = dashboard?.providerBalance ?? (authState?.configured ? null : 100);
  const providerDifference = providerBalance === null ? null : providerBalance - ledgerBalance;
  const dashboardCategories = dashboard?.categories.map((category, index) => ({ ...category, tone: ["blue", "green", "amber", "purple", "orange", "slate"][index % 6], status: category.available <= 0 ? "Needs funding" : "Rolling balance" })) ?? demoCategories;
  const dashboardActivity = dashboard?.activity.map((item) => ({ merchant: item.description, meta: `${item.category ?? "Needs review"} · ${item.account} · ${item.pending ? "Pending" : item.date}`, amount: `${item.kind === "income" || item.kind === "refund" ? "+" : "-"}${money(item.amount)}`, icon: item.kind === "income" ? "↗" : "•", state: item.kind === "income" ? "income" : item.pending ? "pending" : item.category ? "cleared" : "review" })) ?? demoActivity;

  useEffect(() => {
    fetch("/api/auth/session").then((response) => response.json()).then(setAuthState).catch(() => setAuthState({ configured: false, required: true, user: null }));
  }, []);

  useEffect(() => {
    if (!authState?.user) return;
    fetch("/api/dashboard").then((response) => response.ok ? response.json() : null).then((data) => data && setDashboard(data)).catch(() => undefined);
  }, [authState]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function openAction(next: Exclude<ActionType, null>) {
    setShowActions(false);
    setAction(next);
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    const response = await fetch("/api/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      kind: action,
      amount: values.amount,
      date: values.date,
      accountId: values.accountId,
      categoryId: values.categoryId,
      fromCategoryId: values.fromCategoryId,
      toCategoryId: values.toCategoryId,
      description: values.description ?? "Manual entry",
    }) });
    if (response.status === 401 && authState?.required) {
      setToast("Sign in before saving entries");
      return;
    }
    if (!response.ok && authState?.configured) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setToast(body?.error ?? "Could not save entry");
      return;
    }
    setAction(null);
    setToast(authState?.configured ? "Saved to your budget" : "Saved in prototype mode · connect Railway to persist");
  }

  const pageTitle = navItems.find((item) => item.key === activeNav)?.label ?? "Home";

  if (!authState) return <AuthLoading />;
  if (authState.required && !authState.user) return <LoginRequired />;

  const displayName = authState?.user?.displayName ?? "Owner";
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">$</span><span>Budget</span><small>private workspace</small></div>
        <div className="account-switcher"><span className="avatar">{displayName[0]}</span><span><strong>{displayName}&apos;s budget</strong><small>Rolling plan</small></span><span className="chevron">⌄</span></div>
        <nav className="side-nav" aria-label="Primary navigation">
          {navItems.map((item) => <button key={item.key} className={activeNav === item.key ? "nav-item active" : "nav-item"} onClick={() => setActiveNav(item.key)}><span>{item.icon}</span>{item.label}{item.key === "review" && <em>3</em>}</button>)}
        </nav>
        <div className="sidebar-bottom"><a className="muted-link" href="/import">↥ Import from Notion</a><button className="muted-link">⚙ Settings</button><p>Last synced<br /><strong>Today at 9:42 AM</strong></p></div>
      </aside>

      <section className="content-wrap">
        <header className="topbar">
          <div><p className="eyebrow">Today</p><h1>{pageTitle === "Home" ? `Good morning, ${displayName}` : pageTitle}</h1></div>
          <div className="top-actions"><button className="icon-button" aria-label="Search">⌕</button><button className="icon-button notification" aria-label="Notifications">♧<span /></button><button className="profile-button">K</button></div>
        </header>

        {activeNav === "home" ? (
          <>
            <section className="hero-grid">
              <div className="balance-card">
                <div className="card-heading"><div><p className="eyebrow light">Ledger balance</p><h2>{money(ledgerBalance)}</h2></div><span className="balance-icon">↗</span></div>
                <p className="balance-sub">Across {accountCount} configured accounts</p>
                <div className="balance-detail"><span>Provider balance <strong>{providerBalance === null ? "Not connected" : money(providerBalance)}</strong></span>{providerDifference === null ? <span /> : <span className="difference">{providerDifference >= 0 ? "+" : "-"}{money(Math.abs(providerDifference))}</span>}</div>
                <div className="balance-footer"><span><i className="dot dot-green" />{providerBalance === null ? "Manual ledger" : "Up to date"}</span><button onClick={() => setToast(providerBalance === null ? "Connect an account in Settings" : "Balance reconciliation opened")}>Reconcile</button></div>
              </div>
              <div className="remaining-card"><div className="card-heading"><div><p className="eyebrow">Available to assign</p><h2>{money(remainingToBudget)}</h2><p className="remaining-description">Current unassigned cash · rolls forward indefinitely</p></div><span className="soft-icon">◎</span></div><div className="remaining-bar" aria-label={`${allocationPercent}% of income allocated`}><span style={{ width: `${allocationPercent}%` }} /></div><div className="remaining-labels"><span>Allocation coverage</span><span>{allocationPercent}% assigned</span></div><button className="text-button" onClick={() => setActiveNav("budget")}>View budget <span>→</span></button></div>
            </section>

            <section className="quick-section"><div className="section-heading"><div><p className="eyebrow">Quick actions</p><h2>Keep your budget current</h2></div><button className="link-button" onClick={() => setShowActions(true)}>Customize</button></div><div className="quick-actions"><button onClick={() => openAction("transaction")}><ActionIcon type="transaction" /><span><strong>Add transaction</strong><small>Log an expense</small></span><b>→</b></button><button onClick={() => openAction("income")}><ActionIcon type="income" /><span><strong>Add income</strong><small>Record money in</small></span><b>→</b></button><button onClick={() => openAction("allocation")}><ActionIcon type="allocation" /><span><strong>Allocate money</strong><small>Give dollars a job</small></span><b>→</b></button><button onClick={() => openAction("payment")}><ActionIcon type="payment" /><span><strong>Plan card payment</strong><small>Pay budgeted expenses</small></span><b>→</b></button></div></section>

            <section className="main-grid">
              <div className="panel categories-panel"><div className="section-heading"><div><p className="eyebrow">Budget health</p><h2>Category balances</h2></div><button className="link-button" onClick={() => setActiveNav("budget")}>See all <span>→</span></button></div><div className="category-list">{dashboardCategories.map((category) => <div className="category-row" key={category.name}><span className={`category-icon category-${category.tone}`}>{category.icon}</span><div className="category-info"><div className="category-title"><strong>{category.name}</strong><span className={category.available === 0 ? "warning-text" : ""}>{category.status}</span></div><Progress value={category.available} target={category.target} tone={category.tone} /><div className="category-numbers"><span>{money(category.available)} available</span><span>of {money(category.target)}</span></div></div></div>)}</div></div>
              <div className="right-stack"><div className="panel review-panel"><div className="section-heading"><div><p className="eyebrow">Needs your attention</p><h2>Review inbox <span className="count-badge">0</span></h2></div><button className="link-button" onClick={() => setActiveNav("review")}>Open <span>→</span></button></div><div className="review-item"><span className="review-mark">✓</span><div><strong>No items need review</strong><p>Imported activity will appear here when connected.</p></div></div></div><div className="panel upcoming-panel"><div className="section-heading"><div><p className="eyebrow">Coming up</p><h2>Upcoming obligations</h2></div><button className="icon-button small" onClick={() => setActiveNav("budget")} aria-label="View all obligations">→</button></div><div className="upcoming-row"><span className="date-tile"><b>—</b><small>DATE</small></span><div><strong>No obligations yet</strong><p>Add an obligation when you are ready.</p></div><span className="amount">$0.00</span></div></div></div>
            </section>

            <section className="panel activity-panel"><div className="section-heading"><div><p className="eyebrow">Latest activity · trailing 30 days</p><h2>Transactions & income</h2></div><button className="link-button" onClick={() => setActiveNav("activity")}>View activity <span>→</span></button></div><div className="activity-list">{dashboardActivity.map((item) => <div className="activity-row" key={item.merchant}><span className={`activity-icon activity-${item.state}`}>{item.icon}</span><div className="activity-info"><strong>{item.merchant}</strong><p>{item.meta}</p></div><span className={item.state === "income" ? "amount positive" : "amount"}>{item.amount}</span><button className="row-menu" aria-label={`Open ${item.merchant}`}>•••</button></div>)}</div></section>
          </>
        ) : <PlaceholderPage title={pageTitle} activeNav={activeNav} onAction={openAction} dashboard={dashboard} />}
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => <button key={item.key} className={activeNav === item.key ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setActiveNav(item.key)}><span>{item.icon}</span>{item.label}{item.key === "review" && <em>3</em>}</button>)}
        <button className="mobile-add" onClick={() => setShowActions(true)} aria-label="Add"><span>＋</span></button>
      </nav>

      {showActions && <div className="sheet-backdrop" onClick={() => setShowActions(false)}><div className="action-sheet" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-heading"><div><p className="eyebrow">Quick add</p><h2>What would you like to do?</h2></div><button className="close-button" onClick={() => setShowActions(false)}>×</button></div><div className="sheet-actions"><button onClick={() => openAction("transaction")}><ActionIcon type="transaction" /><span><strong>Add transaction</strong><small>Expense or purchase</small></span></button><button onClick={() => openAction("income")}><ActionIcon type="income" /><span><strong>Add income</strong><small>Paycheck or other money in</small></span></button><button onClick={() => openAction("allocation")}><ActionIcon type="allocation" /><span><strong>Allocate money</strong><small>Fund a category</small></span></button><button onClick={() => openAction("transfer")}><ActionIcon type="transfer" /><span><strong>Move between categories</strong><small>Transfer budget</small></span></button><button onClick={() => openAction("payment")}><ActionIcon type="payment" /><span><strong>Plan card payment</strong><small>Apply payment to expenses</small></span></button></div></div></div>}
      {action && <ReleaseActionModal action={action} onClose={() => setAction(null)} onSubmit={submitAction} accounts={dashboard?.accounts.map((account) => account.name)} categoryOptions={dashboard?.categories.map((category) => category.name)} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function PlaceholderPage({ title, activeNav, onAction, dashboard }: { title: string; activeNav: NavKey; onAction: (type: Exclude<ActionType, null>) => void; dashboard: DashboardData | null }) {
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const content: Record<NavKey, { eyebrow: string; heading: string; body: string }> = {
    home: { eyebrow: "Dashboard", heading: "Your budget at a glance", body: "Choose Home to return to your overview." },
    budget: { eyebrow: "Rolling budget", heading: "Give every dollar a job", body: "See funded categories, over-budget areas, obligations, and auto-allocation rules." },
    activity: { eyebrow: "Ledger", heading: "Everything in one timeline", body: "Filter transactions, income, transfers, and imported activity from one place." },
    review: { eyebrow: "Inbox", heading: "Review before it changes your plan", body: "Resolve categories, duplicates, and imported card-payment candidates." },
    more: { eyebrow: "Workspace", heading: "Accounts, rules & audit", body: "Configure accounts manually, connect optional sync, and inspect every change." },
  };
  const copy = content[activeNav];
  if (activeNav === "activity" && dashboard) return <section className="release-page"><div className="section-heading"><div><p className="eyebrow">Trailing 30 days · {dashboard.trailing30.startDate} to {dashboard.trailing30.endDate}</p><h2>Activity analytics</h2></div><button className="primary-button" onClick={() => onAction("transaction")}>＋ Add transaction</button></div><div className="analytics-grid"><div className="panel"><p className="eyebrow">Income</p><h3>{money(dashboard.trailing30.income)}</h3><small>Money in during the trailing 30 days</small></div><div className="panel"><p className="eyebrow">Spending</p><h3>{money(dashboard.trailing30.spending)}</h3><small>Budget-impacting spending</small></div></div><div className="panel release-list"><div className="section-heading"><div><p className="eyebrow">Ledger</p><h2>Recent entries</h2></div><button className="link-button" onClick={() => onAction("income")}>＋ Add income</button></div>{dashboard.activity.map((item) => <div className="activity-row" key={item.id}><span className={`activity-icon activity-${item.pending ? "pending" : item.category ? "cleared" : "review"}`}>{item.kind === "income" ? "↗" : "•"}</span><div className="activity-info"><strong>{item.description}</strong><p>{item.category ?? "Needs review"} · {item.account} · {item.date}</p></div><span className={`amount ${item.kind === "income" ? "positive" : ""}`}>{item.kind === "income" ? "+" : "-"}{money(item.amount)}</span></div>)}</div></section>;
  if (activeNav === "budget" && dashboard) return <section className="release-page"><div className="section-heading"><div><p className="eyebrow">Rolling budget</p><h2>Give every dollar a job</h2></div><div className="section-actions"><button className="secondary-button" onClick={() => setShowCategoryForm((value) => !value)}>＋ Category</button><button className="primary-button" onClick={() => onAction("allocation")}>＋ Allocate money</button></div></div>{showCategoryForm && <form className="panel inline-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), icon: form.get("icon"), target: form.get("target") }) }); if (response.ok) window.location.reload(); }}><label>Name<input name="name" placeholder="e.g. Home repairs" required /></label><label>Icon<input name="icon" defaultValue="$" maxLength={4} /></label><label>Target amount<input name="target" type="number" step="0.01" defaultValue="0" /></label><button className="primary-button" type="submit">Save category</button></form>}<div className="panel release-list"><div className="section-heading"><div><p className="eyebrow">Available to assign</p><h2>{money(dashboard.remainingToBudget)}</h2></div><span className="count-badge">{dashboard.allocationPercent}%</span></div>{dashboard.categories.map((category) => <div className="category-row" key={category.id}><span className="category-icon category-green">{category.icon}</span><div className="category-info"><div className="category-title"><strong>{category.name}</strong><span>{money(category.available)} available</span></div><Progress value={category.available} target={category.target} tone="green" /></div></div>)}</div></section>;
  if (activeNav === "review" && dashboard) return <section className="release-page"><div className="section-heading"><div><p className="eyebrow">Inbox</p><h2>Review before it changes your plan</h2></div></div><div className="panel release-list">{dashboard.reviews.length === 0 ? <p className="empty-state">Nothing needs review right now.</p> : dashboard.reviews.map((review) => <div className="review-item" key={review.id}><span className="review-mark">!</span><div><strong>{review.title}</strong><p>{review.details}</p></div><button className="secondary-button" onClick={async () => { await fetch("/api/reviews", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: review.id, status: "resolved" }) }); window.location.reload(); }}>Resolve</button></div>)}</div></section>;
  if (activeNav === "more" && dashboard) return <section className="release-page"><div className="section-heading"><div><p className="eyebrow">Workspace</p><h2>Accounts & configuration</h2></div><div className="section-actions"><a className="secondary-button" href="/import">↥ Import Notion</a><button className="primary-button" onClick={() => setShowAccountForm((value) => !value)}>＋ Add account</button></div></div>{showAccountForm && <form className="panel inline-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), institution: form.get("institution"), type: form.get("type"), openingBalance: form.get("openingBalance") }) }); if (response.ok) window.location.reload(); }}><label>Name<input name="name" placeholder="e.g. Everyday checking" required /></label><label>Bank or provider<input name="institution" placeholder="e.g. Local bank" required /></label><label>Type<select name="type" defaultValue="checking"><option value="checking">Checking</option><option value="savings">Savings</option><option value="credit_card">Credit card</option></select></label><label>Opening balance<input name="openingBalance" type="number" step="0.01" defaultValue="0" /></label><button className="primary-button" type="submit">Save account</button></form>}<div className="panel release-list">{dashboard.accounts.map((account) => <div className="account-row" key={account.id}><div><strong>{account.name}</strong><p>{account.institution} · {account.type}{account.syncEnabled ? " · sync enabled" : " · manual"}</p></div><span className="amount">{money(account.ledgerBalance)}</span></div>)}<button className="secondary-button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}>Sign out</button></div></section>;
  return <section className="placeholder-page"><span className="placeholder-kicker">{copy.eyebrow}</span><h2>{copy.heading}</h2><p>{copy.body}</p><div className="placeholder-actions"><button className="primary-button" onClick={() => onAction("transaction")}>＋ Add transaction</button><button className="secondary-button" onClick={() => onAction("allocation")}>Allocate money</button></div><div className="prototype-note"><span>✦</span><div><strong>{title} is next in the prototype review</strong><p>This screen is intentionally a lightweight placeholder so we can validate navigation before building its detailed states.</p></div></div></section>;
}

function LoginRequired() {
  return <main className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><span className="brand-mark">$</span><span>Budget</span><small>private workspace</small></div><p className="eyebrow">Private workspace</p><h1>Sign in to continue</h1><p className="auth-copy">Your Railway database is connected. Sign in to view the budget.</p><button className="primary-button" onClick={() => { window.location.href = "/login"; }}>Go to sign in</button></div></main>;
}

function AuthLoading() {
  return <main className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><span className="brand-mark">$</span><span>Budget</span><small>private workspace</small></div><p className="auth-copy">Checking your private session…</p></div></main>;
}

function Combobox({ label, name, options, defaultValue }: { label: string; name?: string; options: string[]; defaultValue: string }) {
  const [query, setQuery] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const filtered = options.filter((option) => option.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return <div className="combo-field" ref={wrapperRef}><span className="field-label">{label}</span><div className={`combobox ${open ? "is-open" : ""}`}><input {...(name ? { name } : {})} role="combobox" aria-label={label} aria-expanded={open} aria-autocomplete="list" value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} /><span className="combo-chevron">⌄</span></div>{open && <div className="combo-options" role="listbox">{filtered.length ? filtered.map((option) => <button type="button" role="option" aria-selected={option === query} key={option} onClick={() => { setQuery(option); setOpen(false); }}>{option}</button>) : <p>No matches</p>}</div>}</div>;
}

function ActionModal({ action, onClose, onSubmit }: { action: Exclude<ActionType, null>; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const details: Record<Exclude<ActionType, null>, { title: string; subtitle: string; submit: string }> = {
    transaction: { title: "Add transaction", subtitle: "Log an expense or purchase", submit: "Save transaction" },
    income: { title: "Add income", subtitle: "Record money coming in", submit: "Save income" },
    allocation: { title: "Allocate money", subtitle: "Give available dollars a job", submit: "Save allocation" },
    transfer: { title: "Move between categories", subtitle: "Transfer budget without changing cash", submit: "Save transfer" },
    payment: { title: "Plan card payment", subtitle: "Apply a payment to budgeted expenses", submit: "Review payment" },
  };
  const info = details[action];
  const accountLabel = action === "income" ? "Deposits to" : action === "payment" ? "Pay from" : "Account";
  const accounts = ["Demo checking", "Demo card", "Demo savings"];
  const categories = ["Housing", "Food", "Transportation", "Travel", "Utilities", "Fees"];
  return <div className="modal-backdrop" onClick={onClose}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-top"><div><p className="eyebrow">Quick Add</p><h2>{info.title}</h2><p>{info.subtitle}</p></div><button className="close-button" onClick={onClose}>×</button></div><form onSubmit={onSubmit}><label>Amount<input type="number" min="0" step="0.01" placeholder="0.00" autoFocus required /></label><div className="form-grid"><label>Date<input type="date" defaultValue="2026-09-03" required /></label><Combobox label={accountLabel} options={accounts} defaultValue="Demo checking" /></div>{action === "transaction" && <><label>Description<input placeholder="What was this for?" required /></label><Combobox label="Category" options={categories} defaultValue="Food" /></>}{action === "income" && <label>Description<input placeholder="Example income…" required /></label>}{action === "allocation" && <Combobox label="Category" options={categories} defaultValue="Housing" />}{action === "transfer" && <div className="form-grid"><Combobox label="From" options={categories} defaultValue="Food" /><Combobox label="To" options={categories} defaultValue="Housing" /></div>}{action === "payment" && <div className="payment-preview"><span>Unpaid expenses ready to apply</span><strong>$0.00</strong><small>Connect an account to review payments</small></div>}<button className="primary-button submit-button" type="submit">{info.submit} <span>→</span></button></form></div></div>;
}

function ReleaseActionModal({ action, onClose, onSubmit, accounts: configuredAccounts, categoryOptions: configuredCategories }: { action: Exclude<ActionType, null>; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; accounts?: string[]; categoryOptions?: string[] }) {
  const details: Record<Exclude<ActionType, null>, { title: string; subtitle: string; submit: string }> = {
    transaction: { title: "Add transaction", subtitle: "Log an expense or purchase", submit: "Save transaction" },
    income: { title: "Add income", subtitle: "Record money coming in", submit: "Save income" },
    allocation: { title: "Allocate money", subtitle: "Give available dollars a job", submit: "Save allocation" },
    transfer: { title: "Move between categories", subtitle: "Transfer budget without changing cash", submit: "Save transfer" },
    payment: { title: "Plan card payment", subtitle: "Apply a payment to budgeted expenses", submit: "Review payment" },
  };
  const info = details[action];
  const accounts = configuredAccounts?.length ? configuredAccounts : ["Demo checking", "Demo card", "Demo savings"];
  const categoryOptions = configuredCategories?.length ? configuredCategories : ["Housing", "Food", "Transportation", "Travel", "Utilities", "Fees"];
  return <div className="modal-backdrop" onClick={onClose}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-top"><div><p className="eyebrow">Quick Add</p><h2>{info.title}</h2><p>{info.subtitle}</p></div><button className="close-button" onClick={onClose}>×</button></div><form onSubmit={onSubmit}><label>Amount<input name="amount" type="number" min="0" step="0.01" placeholder="0.00" autoFocus required /></label><div className="form-grid"><label>Date<input name="date" type="date" defaultValue="2026-09-03" required /></label><Combobox label={action === "income" ? "Deposits to" : action === "payment" ? "Pay from" : "Account"} name="accountId" options={accounts} defaultValue="Demo checking" /></div>{action === "transaction" && <><label>Description<input name="description" placeholder="What was this for?" required /></label><Combobox label="Category" name="categoryId" options={categoryOptions} defaultValue="Food" /></>}{action === "income" && <label>Description<input name="description" placeholder="Example income…" required /></label>}{action === "allocation" && <><label>Description<input name="description" placeholder="Why are you assigning this?" required /></label><Combobox label="Category" name="categoryId" options={categoryOptions} defaultValue="Housing" /></>}{action === "transfer" && <div className="form-grid"><Combobox label="From" name="fromCategoryId" options={categoryOptions} defaultValue="Food" /><Combobox label="To" name="toCategoryId" options={categoryOptions} defaultValue="Housing" /></div>}{action === "payment" && <div className="payment-preview"><span>Unpaid expenses ready to apply</span><strong>$0.00</strong><small>Connect an account to review payments</small></div>}<button className="primary-button submit-button" type="submit">{info.submit} <span>→</span></button></form></div></div>;
}
