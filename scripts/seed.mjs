import postgres from "postgres";
import bcrypt from "bcryptjs";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error("Usage: npm run db:seed -- owner@example.com \"a-password-at-least-12-characters\"");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const userId = "demo-owner";
const accountChecking = "account-demo-checking";
const accountCard = "account-demo-card";
const accountSavings = "account-demo-savings";
const categoryIds = {
  housing: "category-housing",
  food: "category-food",
  travel: "category-travel",
  utilities: "category-utilities",
  fees: "category-fees",
};

try {
  await sql.begin(async (tx) => {
    const passwordHash = await bcrypt.hash(password, 12);
    await tx`INSERT INTO users (id, email, password_hash, display_name) VALUES (${userId}, ${email.toLowerCase()}, ${passwordHash}, 'Owner') ON CONFLICT (email) DO NOTHING`;
    if (process.env.SEED_DEMO === "1") {
    await tx`INSERT INTO accounts (id, user_id, name, institution, type, opening_balance_cents) VALUES (${accountChecking}, ${userId}, 'Demo checking', 'Example bank', 'checking', 1000000), (${accountCard}, ${userId}, 'Demo card', 'Example card issuer', 'credit_card', 0), (${accountSavings}, ${userId}, 'Demo savings', 'Example bank', 'savings', 250000) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO categories (id, user_id, name, icon, target_cents) VALUES
      (${categoryIds.housing}, ${userId}, 'Housing', '🏠', 150000),
      (${categoryIds.food}, ${userId}, 'Food', '🍽️', 50000),
      (${categoryIds.travel}, ${userId}, 'Travel', '✈️', 85000),
      (${categoryIds.utilities}, ${userId}, 'Utilities', '💡', 12000),
      (${categoryIds.fees}, ${userId}, 'Fees', '💳', 10000)
      ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO allocations (id, user_id, category_id, amount_cents, effective_date, note) VALUES
      ('allocation-housing', ${userId}, ${categoryIds.housing}, 150000, '2026-01-01', 'Example allocation'),
      ('allocation-food', ${userId}, ${categoryIds.food}, 50000, '2026-01-01', 'Example allocation'),
      ('allocation-travel', ${userId}, ${categoryIds.travel}, 25000, '2026-01-01', 'Example allocation'),
      ('allocation-utilities', ${userId}, ${categoryIds.utilities}, 12000, '2026-01-01', 'Example allocation'),
      ('allocation-fees', ${userId}, ${categoryIds.fees}, 10000, '2026-01-01', 'Example allocation')
      ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO transactions (id, user_id, account_id, category_id, kind, amount_cents, effective_date, description, status, pending) VALUES
      ('transaction-income', ${userId}, ${accountChecking}, NULL, 'income', 100000, '2026-01-02', 'Example income', 'posted', false),
      ('transaction-purchase', ${userId}, ${accountCard}, ${categoryIds.food}, 'expense', 1200, '2026-01-02', 'Example purchase', 'pending', true),
      ('transaction-bill', ${userId}, ${accountChecking}, ${categoryIds.utilities}, 'expense', 1500, '2026-01-02', 'Example bill', 'posted', false),
      ('transaction-import', ${userId}, ${accountSavings}, NULL, 'expense', 2000, '2026-01-02', 'Example import', 'posted', false)
      ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO obligations (id, user_id, account_id, category_id, name, amount_cents, due_date, cadence, active) VALUES
      ('obligation-housing', ${userId}, ${accountChecking}, ${categoryIds.housing}, 'Example obligation', 150000, '2026-01-14', 'monthly', true),
      ('obligation-utilities', ${userId}, ${accountChecking}, ${categoryIds.utilities}, 'Example bill', 12000, '2026-01-07', 'monthly', true)
      ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO review_items (id, user_id, transaction_id, kind, title, details) VALUES
      ('review-import', ${userId}, 'transaction-import', 'category', 'Example import needs a category', 'Choose a category for this imported transaction.'),
      ('review-payment', ${userId}, NULL, 'card_payment', 'Possible card payment', 'Decide whether this imported payment is new spending or pays already-budgeted expenses.')
      ON CONFLICT (id) DO NOTHING`;
    }
  });
  console.log(`Seeded ${email.toLowerCase()}.`);
} finally {
  await sql.end();
}
