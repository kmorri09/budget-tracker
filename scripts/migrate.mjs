import postgres from "postgres";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
try {
  await sql.file(fileURLToPath(new URL("../drizzle/0000_initial.sql", import.meta.url)));
  console.log("Database schema is up to date.");
} finally {
  await sql.end();
}
