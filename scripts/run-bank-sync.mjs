const appUrl = process.env.BUDGET_APP_URL;
const cronSecret = process.env.CRON_SECRET;

if (!appUrl) {
  console.error("BUDGET_APP_URL is required (for example, https://budget.up.railway.app)");
  process.exit(1);
}
if (!cronSecret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const endpoint = new URL("/api/jobs/sync", appUrl).toString();
const response = await fetch(endpoint, {
  method: "POST",
  headers: { Authorization: `Bearer ${cronSecret}` },
  signal: AbortSignal.timeout(120_000),
});
const body = await response.json().catch(() => null);
console.log(JSON.stringify({ status: response.status, ...body }));

// A 207 response means the endpoint ran but at least one connection failed;
// return non-zero so the scheduled service is visibly failed in Railway logs.
if (!response.ok || body?.ok === false) process.exit(1);
