import { spawn, spawnSync } from "node:child_process";

// Railway's pre-deploy setting is the preferred migration path. Running the
// same idempotent migration immediately before startup is a safe fallback for
// services whose deployment configuration is managed outside this repository.
if (process.env.DATABASE_URL) {
  const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], { stdio: "inherit" });
  if (migration.status !== 0) process.exit(migration.status ?? 1);
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start"], { stdio: "inherit" });
const forwardSignal = (signal) => server.kill(signal);
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
