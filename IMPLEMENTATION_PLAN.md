# Budget Tracker Implementation Plan

Status: private manual-budgeting release with a navigation/table UX pass; advanced payment, automation, and connection workflows remain in development (see Current release boundary).

This document intentionally contains no personal financial records, provider names, private URLs, account identifiers, or production balances. The private requirements source remains local and is excluded from version control.

## Product goal

Build a private, single-owner, zero-based rolling budget application that preserves the useful manual workflows of the current budgeting system while adding reliable bank and credit-card synchronization.

The app should make every dollar explainable:

- income increases cash and the amount available to budget;
- allocations assign available money to categories without changing cash;
- spending reduces a category immediately;
- checking/debit spending reduces cash immediately;
- credit-card spending creates card liability and is later associated with a cash payment;
- transfers and card payments never count as new spending;
- every mutation is auditable and correctable.

## Confirmed requirements

- Hosted private web app, optimized for phone use and installable as a PWA.
- Railway hosts the web service, PostgreSQL database, and future scheduled jobs.
- Email/password authentication with allow-listed first-user creation; optional passkeys may be added later.
- Accounts are configurable manually with a user-selected name, institution, and type. Sync is optional per account.
- Budget balances roll forward indefinitely; summaries and analytics use trailing 30-day windows where appropriate.
- Show both calculated ledger balance and provider balance; ledger balance is primary and deviations are expected.
- Manual entry is always available, including expenses, income, allocations, transfers, and card payments.
- Partial application of a card payment to budgeted transactions is supported.
- Imported payment-like activity creates an in-app review item asking whether it is new spending or payment of already-budgeted expenses.
- Auto-allocation is an explicit preview-and-confirm button and never runs automatically.
- Email is reserved for pressing alerts, including an obligation that remains underfunded five days before its due date.

## Recommended stack

- Next.js App Router + TypeScript
- Tailwind CSS + shadcn/ui
- Zod validation and TanStack Table
- Railway PostgreSQL with Drizzle ORM and SQL migrations
- Database-backed sessions with bcrypt password hashing
- Provider-neutral sync adapter, with Plaid as the first planned provider
- Railway cron service for recovery syncs and alert checks
- Vitest for accounting rules and Playwright for critical flows

The accounting and reconciliation modules remain framework-independent TypeScript so they can be exhaustively tested. Money is stored as integer cents, never binary floating point. Provider secrets remain encrypted and server-only.

## Domain model

Core tables include profiles, accounts, provider connections/accounts, transactions, raw provider transactions, categories, allocations, scheduled obligations, allocation and categorization rules, card payments and applications, review items, sync runs, and append-only audit events. All mutable business rows are owner-scoped.

Derived values are query results rather than independently editable totals:

- remaining to budget = budgetable income - net allocations;
- category available = opening balance + allocations - budget-impacting spending + refunds;
- ledger cash = opening cash + cash inflows - cash expenses - outbound transfers/card payments + inbound transfers;
- provider balance = latest reported provider balance;
- reconciliation difference = provider balance - comparable ledger balance;
- funding gap = required amount by a target date - projected category availability.

Pending transactions reduce category availability immediately. Ledger and provider balances remain visibly separate.

## User experience

Dashboard priority: quick actions, ledger balance, remaining-to-budget, urgent funding problems, card liabilities, category status, and review count. Prominent actions include Add Transaction, Add Income, Allocate, Transfer, and Record Card Payment.

Use a calm, Notion-inspired visual language: white canvas, strong typography, generous spacing, subtle borders, restrained green accents, simple cards, and dense but orderly data views. No dark mode is planned initially.

Navigation now names the core destinations directly: Home, Transactions, Categories, Allocations, and Review. Accounts & settings is a separate, explicit destination, not a More tab. On phones, all five destinations remain in the bottom bar; Accounts and the Add menu are available in the page header. Forms use today's local date, searchable account/category suggestions, and real configured options. Tables collapse into scannable cards with a Details toggle for secondary fields, without horizontal scrolling.

Transactions and Allocations default to the last 30 days, with All dates and Custom dates controls. Their data is no longer limited to the dashboard's eight recent transactions. Tables support text search, multi-select facets, signed amount ranges, sorting on every column (including mobile), filtered totals, and 25-row pagination. Categories show current rolling balances with overspent/empty/target status filters; selecting a category opens its full transaction history. Filters survive navigation between destinations within the current session. Review retains single-item and Resolve all controls and now handles failures visibly. Account creation, reconciliation, private Notion import, and sign-out are reachable from Accounts & settings.

## Delivery phases

### Phase 0 — UX and accounting contract

Finalize phone-first navigation, reusable components, empty/loading/error states, and worked numerical examples for income, allocation, direct spend, card spend, refunds, transfers, partial payoff, and pending-to-posted replacement. Turn each example into an invariant test before expanding production scope.

### Phase 1 — Foundation

Maintain the Next.js application, Railway Postgres schema/migrations, closed authentication, owner scoping, accounts, categories, transactions, income, allocations, audit events, and derived balance queries.

### Phase 2 — Manual budgeting parity

Complete dashboard, searchable forms, category management, allocation/transfer workflows, filters, obligations, funding gaps, manual auto-allocation preview/confirm, and safe editing with audit history.

### Phase 3 — Credit-card payoff

Add unpaid/readiness filters, per-card liability views, full/partial payment applications, refunds, edits after payment, overpayment handling, and reversal scenarios.

### Phase 4 — Import, rules, and review

Use sanitized provider fixtures first. Implement provider IDs, pending-to-posted reconciliation, transfer/payment detection, ordered category rules, review inbox, retries, cursor safety, and replay tests. Keep every workflow manually usable.

### Phase 5 — Live connections and cutover

Complete provider credentials and institution approval, connect only user-selected accounts, run read-only/shadow reconciliation, establish an opening-state snapshot, test Railway backup/restore, and move daily use to the app.

## Quality and security

- Test every money equation and sign convention with table-driven and property tests.
- Enforce provider identity uniqueness and idempotent sync replay.
- Keep raw provider facts and normalized user decisions separate.
- Redact logs, use least-privilege database/provider roles, encrypt secrets, and preserve audit history.
- Verify mobile keyboard behavior, accessibility, loading/empty/error states, and one-handed task completion with Playwright.
- Produce a reconciliation report for any future import or cutover.

## Current release boundary

The current release provides a responsive private dashboard, searchable transaction/category/allocation views, Railway/Postgres schema and migrations, manual account/category configuration, owner-scoped APIs, closed email/password sessions, allow-listed first-user bootstrap, and trailing-30-day activity analytics. Production UI loading failures never fall back to demo balances. Manual allocations and category transfers do not require an unrelated account selection.

Partial card-payment application, auto-allocation, obligation editing, passkeys, live bank connection setup, and scheduled notifications still need implementation/verification beyond this UI pass. The current card-payment form only records a single-account outflow; it does not yet match expenses or update a receiving card. These are requirements, not completed capabilities.

UI verification uses only fictitious API responses: `tests/workspace-smoke.cjs` checks desktop and phone navigation, filters, pagination, category drill-down, quick entry, and reconciliation access against a local server. `node --test tests/table-query.test.mjs` checks filtering, sorting, and display signs (Node 22.18+ for native TypeScript support). No production financial records are test fixtures.
