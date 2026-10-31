import "server-only";
import postgres from "postgres";
import { env } from "./env";

declare global {
  var __comunioSql: postgres.Sql | undefined;
}

/**
 * The connection is created on first use, not at import: `next build` loads
 * every route module to collect its config, and must not need DATABASE_URL.
 *
 * On Vercel use the Supabase *transaction pooler* connection string (port
 * 6543); postgres.js does not use named prepared statements by default, which
 * is what the pooler requires.
 */
function client(): postgres.Sql {
  globalThis.__comunioSql ??= postgres(env().DATABASE_URL, {
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    idle_timeout: 20,
  });
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
