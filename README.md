# Budget Tracker

Private, zero-based budget tracking app with manual entries and optional bank synchronization.

## Transaction types

Transaction types are not interchangeable. The app calculates three related but separate values:

- **Account ledger balance** — the recorded cash/card-account balance.
- **Category available** — allocated money minus categorized spending, plus refunds.
- **Available to assign** — income plus budget adjustments, minus allocations.

| Type | Account ledger | Category / spending | Available to assign | Use it for |
| --- | --- | --- | --- | --- |
| **Expense** | Decreases | Decreases the selected category; counts as spending | No change | A purchase or bill |
| **Income** | Increases | No direct category effect | Increases | Paychecks, deposits, or other new budgetable money |
| **Refund** | Increases | Restores the selected original category | No change | A merchant refund for a prior purchase |
| **Transfer in** | Increases | No effect | No change | The receiving side of a transfer between accounts |
| **Transfer out** | Decreases | No effect | No change | The sending side of a transfer between accounts |
| **Card payment (legacy)** | Decreases only the selected account | No spending effect | No change | Historical one-sided card-payment records only |
| **Reconciliation adjustment** | Adjusts the account to match its real balance | No effect | No change | Correcting a ledger difference during reconciliation |

### Card payments

Use the dedicated **Record card payment** workflow for new payments. It records both sides of the movement (cash account to credit-card account) and applies the payment to unpaid card purchases. The **Card payment (legacy)** transaction type is retained for older one-sided entries and should generally not be used for new records.

### Common classification mistakes

- A transfer marked as **Income** incorrectly increases Available to assign.
- A transfer or card payment marked as an **Expense** can double-count spending.
- A refund should normally use the original spending category so that category available is restored correctly.

Removed transactions are excluded from these calculations.


### Refund coverage and payment previews

Posted credit-card refunds restore their category balance and reduce the card amount still owed. Existing and future refunds use the same calculation. A unique match on card, merchant, category and date is applied automatically, with exact amounts matched before partial refunds. Ambiguous matches remain in **Card payments → Refunds to review**, and can also be reviewed by editing the refund transaction. Matches can be removed or entered with a partial amount. Manual decisions have an audit trail. Unmatched refunds reduce the card debt but are excluded from category cash funding until their original purchases are reviewed, preventing a refund from appearing as new funding for unrelated charges. Credits from unmatched refunds or refunds of already-paid purchases stay on the same card and cover other posted purchases; they do not create cash or a card payment.

Purchase details show refunded amounts, linked payments/refunds, other card credit used, and the remaining amount to pay. Editing or removing a transaction recalculates its coverage.

**Suggest card payment** uses only existing net allocations effective by today (or the payment date, if earlier), less funding already consumed. Each category’s actual allocations are an explicit ceiling. A bank balance, refund, future allocation, or Available to assign cannot stand in for an allocation. Opening the preview, reviewing a suggestion, and saving a card payment never create or change allocations. It shows purchases backed by those existing allocations separately from the amount affordable now. The affordable limit protects all positive category balances plus the unassigned budget pool, and uses the lower of the source account ledger and its recent bank-reported available balance. Pending withdrawals already in these balances are counted once. All card suggestions share the same cash limit, with oldest purchases first. Charges outside the cash limit appear separately as deferred amounts, never as $0 payments. Funded obligations are already included in category balances, and Available to assign is never added to bank cash or quietly consumed by a payment that is supposed to be category-funded.

Payment reviews refresh when opened, when the app regains focus, and periodically while open. Saving validates the current budget snapshot and refund-adjusted purchase limits inside a serializable database transaction. If the budget has changed, review the updated amounts before saving. The explicit “payment already happened” option permits accurate historical records despite current funding limits; it does not bypass purchase coverage checks.

Run `npm test` and `npm run build` to verify the backend and calculations. The fixture-only browser regression is `tests/card-payment-flow-smoke.cjs`; set `UI_TEST_URL` to a localhost production test server and `PLAYWRIGHT_MODULE` to an installed Playwright package (optionally `PLAYWRIGHT_CHANNEL=msedge`).
