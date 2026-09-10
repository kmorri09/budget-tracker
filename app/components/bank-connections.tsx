"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "../../lib/workspace-types";
import { kindLabel, money } from "../../lib/workspace-types";
import Typeahead from "./typeahead";
import { useConfirmDialog } from "./confirm-dialog";

type ProviderAccount = { id: string; providerAccountId: string; name: string; officialName: string | null; mask: string | null; type: string; subtype: string | null; localAccountId: string | null; currentBalance: number | null; availableBalance: number | null; balanceAt: string | null };
type Connection = { id: string; provider: string; institutionName: string | null; status: string; lastSyncAt: string | null; lastError: string | null; accounts: ProviderAccount[] };
type ConnectionResponse = { configured: boolean; connections: Connection[] };

declare global {
  interface Window { Plaid?: { create(options: { token: string; onSuccess(publicToken: string, metadata: { institution?: { name?: string } }): void; onExit(error: { error_message?: string } | null): void }): { open(): void; destroy?(): void } } }
}

let plaidScript: Promise<void> | null = null;
function loadPlaidScript() {
  if (window.Plaid) return Promise.resolve();
  if (plaidScript) return plaidScript;
  plaidScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => window.Plaid ? resolve() : reject(new Error("Plaid Link could not initialize"));
    script.onerror = () => reject(new Error("Could not load Plaid Link. Check your network connection."));
    document.head.appendChild(script);
  });
  return plaidScript;
}

export default function BankConnections({ dashboard, onChanged }: { dashboard: DashboardData; onChanged: (message?: string) => void }) {
  const [data, setData] = useState<ConnectionResponse | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { confirm, dialog: confirmationDialog } = useConfirmDialog();
  const refresh = useCallback(async () => {
    const response = await fetch("/api/connections", { cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "Could not load bank connections.");
    setData(result);
  }, []);
  useEffect(() => { void refresh().catch(failure => setError(failure instanceof Error ? failure.message : "Could not load bank connections.")); }, [refresh]);
  async function connect() {
    setBusy(true); setError("");
    let waitingForLink = false;
    try {
      const response = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "link-token" }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not start bank connection.");
      if (result.mode === "demo") {
        const demo = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mock" }) });
        const demoResult = await demo.json().catch(() => null);
        if (!demo.ok) throw new Error(demoResult?.error ?? "Could not create the demo connection.");
        await refresh(); onChanged("Demo bank connection added — map its accounts, then sync"); return;
      }
      await loadPlaidScript();
      if (!window.Plaid) throw new Error("Plaid Link is unavailable");
      const handler = window.Plaid.create({ token: result.link_token, onSuccess: async (publicToken, metadata) => {
        try {
          const exchange = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "exchange", publicToken, institutionName: metadata.institution?.name }) });
          const exchangeResult = await exchange.json().catch(() => null);
          if (!exchange.ok) throw new Error(exchangeResult?.error ?? "Could not finish bank connection.");
          await refresh(); onChanged("Bank connection added — map its accounts, then sync");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not finish bank connection."); }
        finally { setBusy(false); }
      }, onExit: failure => { if (failure?.error_message) setError(failure.error_message); setBusy(false); } });
      waitingForLink = true;
      handler.open();
      return;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not connect bank."); }
    finally { if (!waitingForLink) setBusy(false); }
  }
  async function reconnect(connection: Connection) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reauth-link-token", connectionId: connection.id }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not start reconnection.");
      await loadPlaidScript();
      if (!window.Plaid) throw new Error("Plaid Link is unavailable");
      window.Plaid.create({ token: result.link_token, onSuccess: async () => {
        try {
          const complete = await fetch(`/api/connections/${connection.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reauth-complete" }) });
          const completeResult = await complete.json().catch(() => null);
          if (!complete.ok) throw new Error(completeResult?.error ?? "Could not complete reconnection.");
          await refresh(); onChanged("Bank connection reauthenticated — sync it to refresh transactions");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not complete reconnection."); }
        finally { setBusy(false); }
      }, onExit: failure => { if (failure?.error_message) setError(failure.error_message); setBusy(false); } }).open();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reconnect this bank."); setBusy(false); }
  }
  async function sync(connection: Connection) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/connections/${connection.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not sync this connection.");
      const repair = result.matched || result.suppressed ? `, ${result.matched ?? 0} matched, ${result.suppressed ?? 0} pre-cutover suppressed` : "";
      const categorized = result.categorized ? `, ${result.categorized} auto-categorized` : "";
      await refresh(); onChanged(`${connection.institutionName ?? "Bank"} synced — ${result.added} new, ${result.modified} updated${categorized}${repair}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not sync this connection."); }
    finally { setBusy(false); }
  }
  async function disconnect(connection: Connection) {
    if (!await confirm({ title: `Disconnect ${connection.institutionName ?? "this bank"}?`, message: "Imported transactions remain in your budget, but future syncs stop.", confirmLabel: "Disconnect bank", destructive: true })) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/connections/${connection.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not disconnect this bank.");
      await refresh(); onChanged("Bank connection disconnected");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not disconnect this bank."); }
    finally { setBusy(false); }
  }
  async function mapAccount(providerAccount: ProviderAccount, localAccountId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/provider-accounts/${providerAccount.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localAccountId: localAccountId || null }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not map this account.");
      await refresh(); onChanged(localAccountId ? "Provider account mapped" : "Provider account unmapped");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not map this account."); }
    finally { setBusy(false); }
  }
  return <section className="bank-connections" aria-labelledby="bank-connections-heading">
    <div className="settings-row bank-connections-heading"><div><h2 id="bank-connections-heading">Bank connections</h2><p className="field-help">Connect a bank through Plaid, choose which accounts to sync, and keep manual entries available.</p></div><button className="primary-button" disabled={busy} onClick={() => void connect()}>{data?.configured ? "＋ Connect bank" : "＋ Try demo connection"}</button></div>
    {!data?.configured && <p className="connection-note"><strong>Plaid is not configured yet.</strong> The demo uses fake accounts and transactions so you can verify the workflow. Add Plaid credentials in Railway before connecting a real institution.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!data && !error && <p role="status" className="empty-state">Loading connections…</p>}
    {data?.connections.map(connection => <article className="connection-card" key={connection.id}>
      <div className="connection-card-heading"><div><h3>{connection.institutionName ?? (connection.provider === "mock" ? "Demo Bank" : "Connected institution")}</h3><p className="field-help">{connection.provider === "mock" ? "Demo provider" : "Plaid"} · <span className={connection.status === "error" || connection.status === "reauth_required" ? "negative" : ""}>{connection.status === "connected" ? "Connected" : connection.status === "reauth_required" ? "Reauthentication required" : kindLabel(connection.status)}</span>{connection.lastSyncAt ? ` · Last synced ${new Date(connection.lastSyncAt).toLocaleString()}` : " · Not synced yet"}</p></div><div className="section-actions">{connection.status === "reauth_required" && connection.provider === "plaid" && <button className="secondary-button" disabled={busy} onClick={() => void reconnect(connection)}>Reconnect</button>}<button className="secondary-button" disabled={busy || connection.status === "disconnected"} onClick={() => void sync(connection)}>Sync now</button><button className="text-link" disabled={busy} onClick={() => void disconnect(connection)}>Disconnect</button></div></div>
      {connection.lastError && <p className="form-error">Last sync failed: {connection.lastError}</p>}
      <div className="provider-account-list">{connection.accounts.map(providerAccount => <div className="provider-account-row" key={providerAccount.id}><div><strong>{providerAccount.name}</strong>{providerAccount.mask && <small>•••• {providerAccount.mask}</small>}<p className="field-help">{kindLabel(providerAccount.type)}{providerAccount.currentBalance !== null ? ` · Provider balance ${money(providerAccount.type === "credit_card" ? -Math.abs(providerAccount.currentBalance) : providerAccount.currentBalance)}` : ""}</p></div><div className="provider-map-label"><Typeahead label="Budget account" options={[{ value: "", label: "Not synced" }, ...dashboard.accounts.filter(account => account.active !== false && (providerAccount.type === "credit_card" ? account.type === "credit_card" : account.type !== "credit_card")).map(account => ({ value: account.id, label: account.name }))]} value={providerAccount.localAccountId ?? ""} onChange={value => void mapAccount(providerAccount, value)} required={false} /></div></div>)}</div>
      {!connection.accounts.some(account => account.localAccountId) && <p className="field-help">Map at least one provider account before syncing transactions. Unmapped provider accounts remain read-only.</p>}
    </article>)}
    {data?.connections.length === 0 && <p className="empty-state">No bank connections yet. Manual account entries continue to work without Plaid.</p>}
    {confirmationDialog}</section>;
}
