"use client";

import { useEffect, useId, useRef, useState } from "react";
import { kindLabel, money } from "../../lib/workspace-types";

type Investigation = {
  account: { id: string; name: string; type: string; openingBalanceCents: number; providerBalanceCents: number | null; providerBalanceAt: string | null; ledgerBalanceCents: number };
  differenceCents: number | null;
  breakdown: { openingBalanceCents: number; transactionCents: number; cardPaymentCents: number };
  providerAccounts: { id: string; name: string; mask: string | null; balanceAt: string | null }[];
  connections: { provider: string; institutionName: string | null; status: string; lastSyncAt: string | null }[];
  bankActivity: { id: string; date: string; description: string; kind: string; amountCents: number; signedCents: number; pending: boolean; removedByProvider: boolean; linkedToApp: boolean }[];
  ledgerEntries: { id: string; date: string; description: string; kind: string; amountCents: number; signedCents: number; status: string; pending: boolean; source: string; linkedToBank: boolean; excluded: boolean }[];
  malformedProviderRows: number;
};

const signedMoney = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${money(Math.abs(cents) / 100)}`;
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";

export default function AccountReconciliationDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<Investigation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const node = dialog.current, previousOverflow = document.body.style.overflow;
    node?.showModal(); document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/account-reconciliation?accountId=${encodeURIComponent(accountId)}`)
      .then(async response => {
        const result = await response.json().catch(() => null) as Investigation | { error?: string } | null;
        if (!response.ok) throw new Error(result && "error" in result ? result.error ?? "Could not load this account investigation." : "Could not load this account investigation.");
        if (!cancelled) setData(result as Investigation);
      })
      .catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not load this account investigation."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId]);

  const bankOnly = data?.bankActivity.filter(item => !item.linkedToApp && !item.removedByProvider) ?? [];
  const removedBankActivity = data?.bankActivity.filter(item => item.removedByProvider) ?? [];
  const appOnly = data?.ledgerEntries.filter(item => !item.linkedToBank && !item.excluded) ?? [];
  const removedEntries = data?.ledgerEntries.filter(item => item.excluded) ?? [];
  const pendingEntries = data?.ledgerEntries.filter(item => item.pending && !item.excluded) ?? [];
  const bankOnlyImpact = bankOnly.reduce((sum, item) => sum + item.signedCents, 0);
  const appOnlyImpact = appOnly.reduce((sum, item) => sum + item.signedCents, 0);
  const pendingImpact = pendingEntries.reduce((sum, item) => sum + item.signedCents, 0);

  return <dialog ref={dialog} className="entry-dialog reconcile-dialog account-investigation-dialog" aria-labelledby={titleId} onCancel={onClose}>
    <div className="modal-top"><div><p className="eyebrow">Read-only account check</p><h2 id={titleId}>Investigate balance difference</h2>{data && <p>{data.account.name} · {kindLabel(data.account.type)}</p>}</div><button type="button" className="close-button" aria-label="Close account investigation" onClick={onClose}>×</button></div>
    {loading && <p className="empty-state" role="status">Comparing bank activity with the app ledger…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && <>
      {data.account.type === "credit_card" && <p className="field-help">Card balances use the app’s ledger sign: amounts owed appear as negative values.</p>}
      {data.differenceCents === null
        ? <p className="field-help">There is no saved provider balance for this account. Map and sync its bank account to compare balances, or use the bank activity and app activity lists below.</p>
        : <div className="investigation-balance-grid">
          <div><span>Provider balance</span><strong>{money(data.account.providerBalanceCents! / 100)}</strong><small>Recorded {dateLabel(data.account.providerBalanceAt)}</small></div>
          <div><span>App ledger</span><strong>{money(data.account.ledgerBalanceCents / 100)}</strong><small>Opening balance plus recorded activity</small></div>
          <div className={data.differenceCents === 0 ? "matched" : "unmatched"}><span>Provider − ledger</span><strong>{signedMoney(data.differenceCents)}</strong><small>{data.differenceCents === 0 ? "Balances match" : "Unexplained balance difference"}</small></div>
        </div>}

      <dl className="investigation-breakdown"><div><dt>Opening balance</dt><dd>{money(data.breakdown.openingBalanceCents / 100)}</dd></div><div><dt>Ledger transactions</dt><dd>{signedMoney(data.breakdown.transactionCents)}</dd></div><div><dt>Card payments</dt><dd>{signedMoney(data.breakdown.cardPaymentCents)}</dd></div></dl>

      <section className="investigation-section"><div className="investigation-section-heading"><h3>Bank activity without an app match <span>{bankOnly.length}</span></h3><strong>Net {signedMoney(bankOnlyImpact)}</strong></div><p className="field-help">These synced entries have no linked ledger transaction or card payment. Older entries may have been intentionally skipped during initial sync; confirm each one before changing the ledger.</p>
        {bankOnly.length ? <div className="investigation-list">{bankOnly.map(item => <div className="investigation-row" key={item.id}><div><strong>{item.description}</strong><small>{item.date} · {kindLabel(item.kind)} · {item.pending ? "Pending" : "Posted"}</small></div><b className={item.signedCents < 0 ? "negative" : ""}>{signedMoney(item.signedCents)}</b></div>)}</div> : <p className="empty-state">All saved bank activity is linked to an app entry.</p>}
      </section>

      <section className="investigation-section"><div className="investigation-section-heading"><h3>App entries without a bank match <span>{appOnly.length}</span></h3><strong>Net {signedMoney(appOnlyImpact)}</strong></div><p className="field-help">These active transactions and card payments affect the app ledger but have no linked bank record. Manual or imported entries can be valid; check for duplicates or omitted bank activity.</p>
        {appOnly.length ? <div className="investigation-list">{appOnly.map(item => <div className="investigation-row" key={`${item.source}-${item.id}`}><div><strong>{item.description}</strong><small>{item.date} · {kindLabel(item.kind)} · {kindLabel(item.source)}{item.pending ? " · Pending (counted in ledger)" : ""}</small></div><b className={item.signedCents < 0 ? "negative" : ""}>{signedMoney(item.signedCents)}</b></div>)}</div> : <p className="empty-state">No active app-only entries for this account.</p>}
      </section>

      {!!pendingEntries.length && <section className="investigation-callout"><strong>Pending entries are included in the app ledger</strong><span>{pendingEntries.length} pending · net {signedMoney(pendingImpact)}</span><p>Compare posted activity with the bank’s current balance before treating this amount as an error.</p></section>}

      <details className="investigation-details"><summary>Bank sync coverage</summary>
        {data.connections.length ? data.connections.map((connection, index) => <p key={`${connection.provider}-${index}`}>{connection.institutionName ?? kindLabel(connection.provider)} · {kindLabel(connection.status)} · Last synced {dateLabel(connection.lastSyncAt)}</p>) : <p>No synced bank account is mapped to this account.</p>}
        {data.providerAccounts.map(providerAccount => <p key={providerAccount.id}>Mapped account: {providerAccount.name}{providerAccount.mask ? ` · •••• ${providerAccount.mask}` : ""} · balance updated {dateLabel(providerAccount.balanceAt)}</p>)}
        {data.malformedProviderRows > 0 && <p>{data.malformedProviderRows} saved provider records could not be read.</p>}
      </details>
      {!!removedBankActivity.length && <details className="investigation-details"><summary>Bank activity later removed by provider ({removedBankActivity.length})</summary><p className="field-help">These saved sync records were later removed by the bank, so they are not listed as current unmatched bank activity.</p>{removedBankActivity.map(item => <div className="investigation-row" key={item.id}><div><strong>{item.description}</strong><small>{item.date} · {kindLabel(item.kind)} · Removed from bank feed</small></div><b>{signedMoney(item.signedCents)}</b></div>)}</details>}
      {!!removedEntries.length && <details className="investigation-details"><summary>Removed ledger entries excluded from balance ({removedEntries.length})</summary>{removedEntries.map(item => <div className="investigation-row" key={item.id}><div><strong>{item.description}</strong><small>{item.date} · {kindLabel(item.kind)} · Removed</small></div><b>{signedMoney(item.signedCents)}</b></div>)}</details>}
      <p className="investigation-readonly-note">This report only reads saved records. It does not change balances or create adjustments.</p>
    </>}
  </dialog>;
}
