"use client";

import { useEffect, useId, useRef, useState } from "react";
import { kindLabel, money } from "../../lib/workspace-types";
import type { LinkedBankDifference, PaymentEvidence, PossibleLedgerDuplicate } from "../../lib/account-reconciliation";

type Investigation = {
  account: { id: string; name: string; type: string; openingBalanceCents: number; providerBalanceCents: number | null; providerBalanceAt: string | null; ledgerBalanceCents: number };
  differenceCents: number | null;
  breakdown: { openingBalanceCents: number; transactionCents: number; cardPaymentCents: number };
  providerAccounts: { id: string; name: string; mask: string | null; balanceAt: string | null }[];
  connections: { provider: string; institutionName: string | null; status: string; lastSyncAt: string | null }[];
  bankActivity: { id: string; date: string; description: string; kind: string; amountCents: number; signedCents: number; pending: boolean; removedByProvider: boolean; linkedToApp: boolean }[];
  ledgerEntries: { id: string; date: string; description: string; kind: string; amountCents: number; signedCents: number; status: string; pending: boolean; source: string; linkedToBank: boolean; excluded: boolean; paymentEvidence: PaymentEvidence | null }[];
  malformedProviderRows: number;
  possibleDuplicates: PossibleLedgerDuplicate[];
  linkedBankDifferences: LinkedBankDifference[];
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
  const adjustments = data?.ledgerEntries.filter(item => item.kind === "adjustment" && !item.excluded) ?? [];
  const bankOnlyImpact = bankOnly.reduce((sum, item) => sum + item.signedCents, 0);
  const appOnlyImpact = appOnly.reduce((sum, item) => sum + item.signedCents, 0);
  const pendingImpact = pendingEntries.reduce((sum, item) => sum + item.signedCents, 0);
  const adjustmentImpact = adjustments.reduce((sum, item) => sum + item.signedCents, 0);
  const duplicatePairs = data?.possibleDuplicates ?? [];
  const independentDuplicatePairs = new Set(duplicatePairs.flatMap(pair => [pair.first.id, pair.second.id])).size === duplicatePairs.length * 2;
  const duplicateExclusionImpact = duplicatePairs.reduce((sum, pair) => sum + pair.balanceEffectIfExcludedCents, 0);

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
      <p className="field-help">The balance difference above is the amount to explain. The lists below show records to check, not proven errors or amounts to remove.</p>

      {!!duplicatePairs.length && <section className="investigation-section">
        <div className="investigation-section-heading"><h3>Possible duplicate bank entries <span>{duplicatePairs.length}</span></h3></div>
        <p className="field-help">These active bank entries have the same description: equal amounts within five days, or a pending and posted charge within fourteen days whose amounts may differ after a tip or exchange-rate change. Confirm against the bank statement before removing one; separate real charges can look alike.</p>
        {independentDuplicatePairs && data.differenceCents !== null && <p>If one entry from each pair were excluded, the app balance would change by {signedMoney(duplicateExclusionImpact)} and the remaining difference would be {signedMoney(data.differenceCents - duplicateExclusionImpact)}. This is a scenario to verify, not a correction already made.</p>}
        {duplicatePairs.map(pair => <details className="investigation-details" key={`${pair.first.id}-${pair.second.id}`}><summary>{pair.first.description} · {money(Math.abs(pair.first.signedCents) / 100)}{pair.first.signedCents !== pair.second.signedCents ? ` / ${money(Math.abs(pair.second.signedCents) / 100)}` : ""} · {pair.first.date} and {pair.second.date}</summary>
          <p>Both entries currently affect the ledger. Excluding the {pair.first.date}{pair.first.pending ? " pending" : ""} entry would change the app balance by {signedMoney(pair.balanceEffectIfExcludedCents)}{data.differenceCents === null ? "." : ` and leave provider − ledger at ${signedMoney(data.differenceCents - pair.balanceEffectIfExcludedCents)}.`}</p>
          <p className="field-help">When multiple pairs share an entry, count that entry only once.</p>
        </details>)}
      </section>}

      {!!data.linkedBankDifferences?.length && <section className="investigation-section">
        <div className="investigation-section-heading"><h3>Linked entries with bank differences <span>{data.linkedBankDifferences.length}</span></h3></div>
        <p className="field-help">These records are linked, but the amount or posting state differs. Check finalized tips, exchange rates, deliberate amount edits, or bank removals before changing the ledger.</p>
        <div className="investigation-list">{data.linkedBankDifferences.map(item => <div className="investigation-row" key={item.entryId}><div><strong>{item.description}</strong><small>App {signedMoney(item.appSignedCents)} · Bank {signedMoney(item.bank.signedCents)} · {item.bank.removedByProvider ? "Removed from bank feed" : item.bank.pending ? "Bank pending" : "Bank posted"}{item.pendingDiffers ? " · Posting state differs" : ""}</small></div><b>{signedMoney(item.amountDifferenceCents)}</b></div>)}</div>
      </section>}

      <section className="investigation-section"><div className="investigation-section-heading"><h3>Bank activity without an app match <span>{bankOnly.length}</span></h3><strong>Net {signedMoney(bankOnlyImpact)}</strong></div><p className="field-help">These synced entries have no linked ledger transaction or card payment. Older entries may have been intentionally skipped during initial sync; confirm each one before changing the ledger.</p>
        {bankOnly.length ? <div className="investigation-list">{bankOnly.map(item => <div className="investigation-row" key={item.id}><div><strong>{item.description}</strong><small>{item.date} · {kindLabel(item.kind)} · {item.pending ? "Pending" : "Posted"}</small></div><b className={item.signedCents < 0 ? "negative" : ""}>{signedMoney(item.signedCents)}</b></div>)}</div> : <p className="empty-state">No unmatched activity found in the saved bank records. Links can include excluded entries; a link alone does not verify the amount or the starting balance.</p>}
      </section>

      <section className="investigation-section"><div className="investigation-section-heading"><h3>App entries without a bank link <span>{appOnly.length}</span></h3><strong>Net {signedMoney(appOnlyImpact)}</strong></div><p className="field-help">These entries affect this account but have no bank link for this account. A purchase marked Paid verifies purchase coverage, not a bank withdrawal. Manual or imported entries can still be valid.</p>
        {appOnly.length ? <div className="investigation-list">{appOnly.map(item => <div key={`${item.source}-${item.id}`}>
          <div className="investigation-row"><div><strong>{item.description}</strong><small>{item.date} · {kindLabel(item.kind)}{item.source !== item.kind ? ` · ${kindLabel(item.source)}` : ""}{item.pending ? " · Pending (counted in ledger)" : ""}</small></div><b className={item.signedCents < 0 ? "negative" : ""}>{signedMoney(item.signedCents)}</b></div>
          {item.paymentEvidence && <details className="investigation-details"><summary>Check payment: {item.paymentEvidence.fromAccountName} → {item.paymentEvidence.toAccountName}</summary>
            <p className="field-help">No linked bank {item.paymentEvidence.bankSide} for {data.account.name}. The other account’s bank activity is {item.paymentEvidence.otherSideLinkedToBank ? "linked" : "also unlinked"}.</p>
            <p>Purchase coverage: {money(item.paymentEvidence.appliedCents / 100)} applied of {money(item.amountCents / 100)}.</p>
            {item.paymentEvidence.purchases.map(purchase => <div className="investigation-row" key={purchase.id}><div><strong>{purchase.description}</strong><small>{purchase.date} · Covered purchase</small></div><b>{money(purchase.amountCents / 100)}</b></div>)}
            {data.differenceCents !== null && <p className="field-help">If this payment were excluded from this account, provider − ledger would be {signedMoney(data.differenceCents + item.signedCents)}. This is a comparison only.</p>}
            <p className="field-help">Saved bank {item.paymentEvidence.bankSide === "withdrawal" ? "withdrawals" : "credits"} within five days follow, including activity already linked elsewhere. Check whether this payment is part of a larger payment already recorded.</p>
            {item.paymentEvidence.nearbyBankActivity.length ? item.paymentEvidence.nearbyBankActivity.map(bank => <div className="investigation-row" key={bank.id}><div><strong>{bank.description}</strong><small>{bank.date} · {bank.pending ? "Pending" : "Posted"} · {bank.exactAmount ? "Same amount" : "Different amount"} · {bank.linkedToApp ? "Already linked to an app entry" : "No app link"}</small></div><b>{signedMoney(bank.signedCents)}</b></div>) : <p>No saved bank activity with the same direction in this date window. Check the bank statement, payment date, source account, and sync coverage.</p>}
          </details>}
        </div>)}</div> : <p className="empty-state">No active app-only entries for this account.</p>}
      </section>

      {!!adjustments.length && <section className="investigation-callout"><strong>Reconciliation adjustments affect this balance</strong><span>{adjustments.length} adjustments · net {signedMoney(adjustmentImpact)}</span><p>Review the last confirmed bank balance and activity recorded since then. An adjustment has no bank transaction of its own and can overlap older payments or imported activity.</p></section>}

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
