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
  provider: text("provider"),
  providerAccountId: text("provider_account_id"),
  syncEnabled: boolean("sync_enabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ userIndex: index("accounts_user_idx").on(table.userId) }));

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon").default("$"),
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

