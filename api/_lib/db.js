// db.js: one small PostgreSQL connection pool per function instance.
// DATABASE_URL = Supabase "Transaction pooler" URI (port 6543), set in Vercel environment variables.
import pg from "pg";
import { HttpError } from "./http.js";

let pool = null;

export function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new HttpError(500, "DATABASE_URL is not set in the Vercel environment variables.");
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,                   // serverless: one connection per instance; the Supabase pooler shares them
      idleTimeoutMillis: 10_000,
      // Supabase requires TLS. Certificate pinning is not configured (rejectUnauthorized false); see README.
      // DATABASE_SSL=disable is only for a local Postgres without TLS.
      ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export const q = (text, params) => db().query(text, params);
