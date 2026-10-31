import "server-only";
import postgres from "postgres";
import { env } from "./env";

declare global {
  var __comunioSql: postgres.Sql | undefined;
}

/**
 * Server-side Postgres client. On Vercel use the Supabase *transaction pooler*
 * connection string (port 6543); postgres.js does not use named prepared
 * statements by default, which is what the pooler requires.
 */
export const sql: postgres.Sql =
  globalThis.__comunioSql ??
  postgres(env().DATABASE_URL, {
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") globalThis.__comunioSql = sql;
