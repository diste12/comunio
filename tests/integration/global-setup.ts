import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

/** Fresh schema for every run: drop everything and apply all migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (a disposable database — it is wiped) to run integration tests.");
  const sql = postgres(url, { onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  const dir = path.join(process.cwd(), "supabase/migrations");
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort()) {
    await sql.unsafe(await readFile(path.join(dir, f), "utf8"));
  }
  await sql.end();
}
