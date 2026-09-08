import { bigint, boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ emailIndex: uniqueIndex("users_email_idx").on(table.email) }));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userIndex: index("sessions_user_idx").on(table.userId) }));

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  institution: text("institution").notNull(),
  type: text("type").notNull(),
  openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }).default(0).notNull(),
  providerBalanceCents: bigint("provider_balance_cents", { mode: "number" }),
  providerBalanceAt: timestamp("provider_balance_at", { withTimezone: true }),
  provider: text("provider"),
  providerAccountId: text("provider_account_id"),
  syncEnabled: boolean("sync_enabled").default(false).notNull(),
  isDefaultCash: boolean("is_default_cash").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userIndex: index("accounts_user_idx").on(table.userId) }));

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon").default(""),
  targetCents: bigint("target_cents", { mode: "number" }).default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userNameIndex: uniqueIndex("categories_user_name_idx").on(table.userId, table.name) }));

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id),
  categoryId: text("category_id").references(() => categories.id),
  kind: text("kind").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  description: text("description").notNull(),
  status: text("status").default("posted").notNull(),
  source: text("source").default("manual").notNull(),
  providerTransactionId: text("provider_transaction_id"),
  pending: boolean("pending").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userDateIndex: index("transactions_user_date_idx").on(table.userId, table.effectiveDate), providerIndex: uniqueIndex("transactions_provider_idx").on(table.userId, table.providerTransactionId) }));

// A card payment is a two-sided cash movement: money leaves a cash account and
// reduces the balance owed on a credit-card account. It is kept separate from
// budget transactions so it cannot accidentally count as new spending.
export const cardPayments = pgTable("card_payments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromAccountId: text("from_account_id").notNull().references(() => accounts.id),
  toAccountId: text("to_account_id").notNull().references(() => accounts.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userDateIndex: index("card_payments_user_date_idx").on(table.userId, table.effectiveDate) }));

export const cardPaymentApplications = pgTable("card_payment_applications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  paymentId: text("payment_id").notNull().references(() => cardPayments.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  paymentIndex: index("card_payment_applications_payment_idx").on(table.paymentId),
  transactionIndex: index("card_payment_applications_transaction_idx").on(table.transactionId),
  uniqueApplication: uniqueIndex("card_payment_applications_unique_idx").on(table.paymentId, table.transactionId),
}));

// Manual coverage corrections are intentionally separate from card payments.
// They let the user force a purchase's paid state without inventing cash movement.
export const cardCoverageAdjustments = pgTable("card_coverage_adjustments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ transactionIndex: index("card_coverage_adjustments_transaction_idx").on(table.transactionId) }));

export const allocations = pgTable("allocations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  categoryId: text("category_id").notNull().references(() => categories.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userDateIndex: index("allocations_user_date_idx").on(table.userId, table.effectiveDate) }));

export const obligations = pgTable("obligations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id),
  categoryId: text("category_id").notNull().references(() => categories.id),
  name: text("name").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  dueDate: date("due_date").notNull(),
  cadence: text("cadence"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userDueDateIndex: index("obligations_user_due_idx").on(table.userId, table.dueDate) }));

export const reviewItems = pgTable("review_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  details: text("details"),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => ({ userStatusIndex: index("review_items_user_status_idx").on(table.userId, table.status) }));

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userCreatedIndex: index("audit_events_user_created_idx").on(table.userId, table.createdAt) }));

