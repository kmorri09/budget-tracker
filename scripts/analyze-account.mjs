import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const envFile = [".env.local", ".env.local.txt"].find(path => existsSync(path));
if (envFile) process.loadEnvFile(envFile);
const connectionString = process.env.ANALYSIS_DATABASE_URL;
if (!connectionString) {
  console.error("ANALYSIS_DATABASE_URL is missing from the local environment file.");
  process.exit(1);
}
let address;
try { address = new URL(connectionString); } catch {
  console.error("ANALYSIS_DATABASE_URL is not a valid connection URL.");
  process.exit(1);
}
if (!['postgres:', 'postgresql:'].includes(address.protocol)) {
  console.error("The analysis connection must use a PostgreSQL URL.");
  process.exit(1);
}
console.log(JSON.stringify({ envFile, host: address.hostname, port: address.port || "5432", privateRailwayHost: address.hostname.endsWith(".railway.internal") }));
const sql = postgres(connectionString, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {}, connection: { application_name: "budget-readonly-analysis" } });
try {
  await sql.begin("isolation level repeatable read read only", async tx => {
    await tx`set local statement_timeout = '30s'`;
    const [permissions] = await tx`
      select current_setting('transaction_read_only') as transaction_read_only,
        has_table_privilege(current_user, 'public.transactions', 'SELECT') as can_read_transactions,
        has_table_privilege(current_user, 'public.transactions', 'INSERT,UPDATE,DELETE') as role_can_write_transactions
    `;
    console.log(JSON.stringify({ permissions }));
    if (process.argv.includes("--check")) return;
    const accountRows = await tx`select id, user_id, name, institution, type, opening_balance_cents, provider_balance_cents, provider_balance_at, created_at from accounts order by name`;
    const savings = accountRows.filter(row => row.name.toLowerCase() === "sofi savings");
    if (savings.length !== 1) {
      console.log(JSON.stringify({ error: "Could not identify one Sofi Savings account", accounts: accountRows.map(({ name, type }) => ({ name, type })) }));
      return;
    }
    const userId = savings[0].user_id;
    const snapshot = {
      capturedAt: new Date().toISOString(),
      targetAccountId: savings[0].id,
      accounts: accountRows.filter(row => row.user_id === userId),
      transactions: await tx`select * from transactions where user_id = ${userId} order by effective_date, created_at`,
      payments: await tx`select * from card_payments where user_id = ${userId} order by effective_date, created_at`,
      applications: await tx`select * from card_payment_applications where user_id = ${userId}`,
      coverage: await tx`select * from card_coverage_adjustments where user_id = ${userId}`,
      providerAccounts: await tx`select * from provider_accounts where user_id = ${userId}`,
      raw: await tx`select * from raw_provider_transactions where user_id = ${userId}`,
      syncRuns: await tx`select * from sync_runs where user_id = ${userId} order by started_at`,
      audits: await tx`select * from audit_events where user_id = ${userId} and entity_type in ('account', 'transaction', 'provider_transaction', 'card_payment', 'card_coverage_adjustment') order by created_at`,
    };
    const outputDir = resolve("imports", "account-analysis");
    mkdirSync(outputDir, { recursive: true });
    const outputPath = resolve(outputDir, "snapshot.json");
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify({ snapshot: outputPath, counts: Object.fromEntries(Object.entries(snapshot).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) }));
  });
} catch (error) {
  // Never print the connection URL or a driver object containing credentials.
  let message = String(error.message).replaceAll(connectionString, "[connection redacted]");
  for (const secret of new Set([address.password, decodeURIComponent(address.password)])) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  console.error(JSON.stringify({ error: error.code || error.name || "ConnectionError", message }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
