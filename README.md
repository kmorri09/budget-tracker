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

