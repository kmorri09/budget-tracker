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
  "provider_balance_cents" bigint,
  "provider_balance_at" timestamptz,
  "provider" text,
  "provider_account_id" text,
  "sync_enabled" boolean DEFAULT false NOT NULL,
  "is_default_cash" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "accounts_user_idx" ON "accounts" ("user_id");

CREATE TABLE IF NOT EXISTS "categories" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
    "icon" text DEFAULT '',
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
  "removed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "transactions_user_date_idx" ON "transactions" ("user_id", "effective_date");
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_provider_idx" ON "transactions" ("user_id", "provider_transaction_id");

CREATE TABLE IF NOT EXISTS "card_payments" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "from_account_id" text NOT NULL REFERENCES "accounts"("id"),
  "to_account_id" text NOT NULL REFERENCES "accounts"("id"),
  "amount_cents" bigint NOT NULL,
  "effective_date" date NOT NULL,
  "description" text NOT NULL,
  "provider_transaction_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "card_payments" ADD COLUMN IF NOT EXISTS "provider_transaction_id" text;
CREATE INDEX IF NOT EXISTS "card_payments_user_date_idx" ON "card_payments" ("user_id", "effective_date");
CREATE UNIQUE INDEX IF NOT EXISTS "card_payments_provider_idx" ON "card_payments" ("user_id", "provider_transaction_id");

CREATE TABLE IF NOT EXISTS "card_payment_applications" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "payment_id" text NOT NULL REFERENCES "card_payments"("id") ON DELETE CASCADE,
  "transaction_id" text NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
  "amount_cents" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "card_payment_applications_payment_idx" ON "card_payment_applications" ("payment_id");
CREATE INDEX IF NOT EXISTS "card_payment_applications_transaction_idx" ON "card_payment_applications" ("transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "card_payment_applications_unique_idx" ON "card_payment_applications" ("payment_id", "transaction_id");

CREATE TABLE IF NOT EXISTS "card_coverage_adjustments" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "transaction_id" text NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
  "amount_cents" bigint NOT NULL,
  "effective_date" date NOT NULL,
  "note" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "card_coverage_adjustments_transaction_idx" ON "card_coverage_adjustments" ("transaction_id");

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

CREATE TABLE IF NOT EXISTS "budget_adjustments" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "amount_cents" bigint NOT NULL,
  "effective_date" date NOT NULL,
  "note" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "budget_adjustments_user_date_idx" ON "budget_adjustments" ("user_id", "effective_date");

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

-- Reconciliation fields are additive so existing Railway databases can migrate safely.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "provider_balance_cents" bigint;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "provider_balance_at" timestamptz;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_default_cash" boolean DEFAULT false NOT NULL;

-- Give existing workspaces a predictable income destination when no default has been chosen.
UPDATE "accounts" AS target
SET "is_default_cash" = true
WHERE target."active" = true
  AND target."type" <> 'credit_card'
  AND NOT EXISTS (
    SELECT 1 FROM "accounts" AS chosen
    WHERE chosen."user_id" = target."user_id" AND chosen."active" = true AND chosen."is_default_cash" = true
  )
  AND target."id" = (
    SELECT candidate."id" FROM "accounts" AS candidate
    WHERE candidate."user_id" = target."user_id" AND candidate."active" = true AND candidate."type" <> 'credit_card'
    ORDER BY candidate."created_at", candidate."id" LIMIT 1
  );
ALTER TABLE "categories" ALTER COLUMN "icon" SET DEFAULT '';

-- Provider-neutral bank connection storage. Secrets are encrypted by the app
-- before insertion; raw provider payloads stay separate from user decisions.
CREATE TABLE IF NOT EXISTS "provider_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "item_id" text NOT NULL,
  "institution_name" text,
  "access_token_encrypted" text NOT NULL,
  "status" text DEFAULT 'connected' NOT NULL,
  "cursor" text,
  "last_sync_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "provider_connections_user_idx" ON "provider_connections" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_connections_item_idx" ON "provider_connections" ("user_id", "provider", "item_id");

CREATE TABLE IF NOT EXISTS "provider_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connection_id" text NOT NULL REFERENCES "provider_connections"("id") ON DELETE CASCADE,
  "provider_account_id" text NOT NULL,
  "name" text NOT NULL,
  "official_name" text,
  "mask" text,
  "type" text NOT NULL,
  "subtype" text,
  "local_account_id" text REFERENCES "accounts"("id") ON DELETE SET NULL,
  "current_balance_cents" bigint,
  "available_balance_cents" bigint,
  "balance_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "provider_accounts_user_idx" ON "provider_accounts" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_accounts_provider_idx" ON "provider_accounts" ("connection_id", "provider_account_id");
CREATE INDEX IF NOT EXISTS "provider_accounts_local_idx" ON "provider_accounts" ("local_account_id");

CREATE TABLE IF NOT EXISTS "raw_provider_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connection_id" text NOT NULL REFERENCES "provider_connections"("id") ON DELETE CASCADE,
  "provider_account_id" text NOT NULL,
  "provider_transaction_id" text NOT NULL,
  "pending_transaction_id" text,
  "pending" boolean DEFAULT false NOT NULL,
  "raw_json" text NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "raw_provider_transactions_user_idx" ON "raw_provider_transactions" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "raw_provider_transactions_provider_idx" ON "raw_provider_transactions" ("user_id", "provider_transaction_id");
CREATE INDEX IF NOT EXISTS "raw_provider_transactions_pending_idx" ON "raw_provider_transactions" ("user_id", "pending_transaction_id");

CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connection_id" text NOT NULL REFERENCES "provider_connections"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz,
  "added_count" integer DEFAULT 0 NOT NULL,
  "modified_count" integer DEFAULT 0 NOT NULL,
  "removed_count" integer DEFAULT 0 NOT NULL,
  "error" text
);
CREATE INDEX IF NOT EXISTS "sync_runs_user_idx" ON "sync_runs" ("user_id");
CREATE INDEX IF NOT EXISTS "sync_runs_connection_idx" ON "sync_runs" ("connection_id", "started_at");

CREATE TABLE IF NOT EXISTS "sync_locks" (
  "connection_id" text PRIMARY KEY NOT NULL REFERENCES "provider_connections"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "acquired_at" timestamptz DEFAULT now() NOT NULL
);

-- Additive columns for provider removals on existing databases.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "removed_at" timestamptz;

-- Versioned application data repairs run once even though this schema file is idempotent.
CREATE TABLE IF NOT EXISTS "app_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "applied_at" timestamptz DEFAULT now() NOT NULL
);

-- The first Notion importer treated the string "0" in Partial Payment as truthy,
-- classifying every categorized imported expense as a card payment. The source
-- snapshot contains no actual payment relations in the affected cutover data.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "app_migrations" WHERE "id" = 'repair_notion_payment_kinds_v1') THEN
    UPDATE "review_items"
      SET "status" = 'resolved', "resolved_at" = COALESCE("resolved_at", now())
      WHERE "transaction_id" IN (
        SELECT "id" FROM "transactions"
        WHERE "source" = 'notion_import' AND "kind" = 'card_payment' AND "category_id" IS NOT NULL
      );

    WITH repaired AS (
      UPDATE "transactions"
        SET "kind" = 'expense', "updated_at" = now()
        WHERE "source" = 'notion_import' AND "kind" = 'card_payment' AND "category_id" IS NOT NULL
        RETURNING "user_id"
    )
    INSERT INTO "audit_events" ("id", "user_id", "action", "entity_type", "entity_id", "after_json")
      SELECT 'repair-notion-payment-kinds-v1:' || "user_id", "user_id", 'repair', 'import_batch', 'repair_notion_payment_kinds_v1', '{"from":"card_payment","to":"expense","scope":"categorized notion_import transactions"}'
      FROM repaired
      GROUP BY "user_id"
      ON CONFLICT ("id") DO NOTHING;

    INSERT INTO "app_migrations" ("id") VALUES ('repair_notion_payment_kinds_v1');
  END IF;
END $$;

