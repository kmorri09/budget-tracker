import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let database: Database | null = null;
let client: ReturnType<typeof postgres> | null = null;

export function getDatabase(): Database {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!database) {
    client = postgres(connectionString, { max: 5, prepare: false });
    database = drizzle(client, { schema });
  }
  return database;
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

