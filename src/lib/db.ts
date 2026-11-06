import "server-only";
import postgres from "postgres";
import { needsTls, resolveDatabaseUrl } from "./database-url";

declare global {
  var __comunioSql: postgres.Sql | undefined;
}

/**
 * The connection is created on first use, not at import: `next build` loads
 * every route module to collect its config, and must not need DATABASE_URL.
 *
 * On Vercel use the Supabase *transaction pooler* connection string (port
 * 6543). Disable named prepared statements and pipelining: concurrent protocol
 * exchanges on a transaction-pooled connection can stall waiting for responses.
 */
function client(): postgres.Sql {
  if (!globalThis.__comunioSql) {
    const url = resolveDatabaseUrl();
    if (!url) throw new Error("Database not configured: set DATABASE_URL or connect the Supabase integration (POSTGRES_URL)");
    globalThis.__comunioSql = postgres(url, {
      max: process.env.NODE_ENV === "production" ? 5 : 10,
      max_pipeline: 1,
      idle_timeout: 20,
      prepare: false,
      connect_timeout: 30,
      queue_timeout: 60,
      ...(needsTls(url) ? { ssl: "require" as const } : {}),
    });
  }
  return globalThis.__comunioSql;
}

/** Drop-in `postgres.Sql`: tagged templates, helpers (`sql(rows)`), `sql.begin`, `sql.json`, … */
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_target, _this, args) => Reflect.apply(client() as unknown as (...a: unknown[]) => unknown, undefined, args),
  get: (_target, prop) => {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
