CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "display_name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "institution" text NOT NULL,
  "type" text NOT NULL,
  "opening_balance_cents" bigint DEFAULT 0 NOT NULL,
  "provider" text,
  "provider_account_id" text,
  "sync_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "accounts_user_idx" ON "accounts" ("user_id");

CREATE TABLE IF NOT EXISTS "categories" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "icon" text DEFAULT '$',
  "target_cents" bigint DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "categories_user_name_idx" ON "categories" ("user_id", "name");

CREATE TABLE IF NOT EXISTS "transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "accounts"("id"),
  "category_id" text REFERENCES "categories"("id"),
  "kind" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "effective_date" date NOT NULL,
  "description" text NOT NULL,
  "status" text DEFAULT 'posted' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "provider_transaction_id" text,
  "pending" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "transactions_user_date_idx" ON "transactions" ("user_id", "effective_date");
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_provider_idx" ON "transactions" ("user_id", "provider_transaction_id");

CREATE TABLE IF NOT EXISTS "allocations" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category_id" text NOT NULL REFERENCES "categories"("id"),
  "amount_cents" bigint NOT NULL,
  "effective_date" date NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "allocations_user_date_idx" ON "allocations" ("user_id", "effective_date");

CREATE TABLE IF NOT EXISTS "obligations" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "accounts"("id"),
  "category_id" text NOT NULL REFERENCES "categories"("id"),
  "name" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  "due_date" date NOT NULL,
  "cadence" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "obligations_user_due_idx" ON "obligations" ("user_id", "due_date");

CREATE TABLE IF NOT EXISTS "review_items" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "transaction_id" text REFERENCES "transactions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "details" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "review_items_user_status_idx" ON "review_items" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "before_json" text,
  "after_json" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "audit_events_user_created_idx" ON "audit_events" ("user_id", "created_at");

