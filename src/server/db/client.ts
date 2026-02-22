/**
 * Drizzle ORM Client — Supabase Postgres connection
 *
 * Replaces Mongoose connection. Drizzle connects lazily on first query.
 * Requires DATABASE_URL environment variable.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL not set — database features will be unavailable");
}

/** Postgres.js connection pool */
const client = DATABASE_URL
  ? postgres(DATABASE_URL, { max: 10 })
  : (null as unknown as ReturnType<typeof postgres>);

/** Drizzle ORM instance with schema bindings */
export const db = DATABASE_URL
  ? drizzle(client, { schema })
  : (null as unknown as ReturnType<typeof drizzle>);

/** Check if database is available */
export function isDbAvailable(): boolean {
  return !!DATABASE_URL && !!db;
}
