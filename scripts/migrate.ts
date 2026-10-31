/**
 * Minimal migration runner for plain Postgres (local dev / CI).
 * For Supabase projects use the Supabase CLI instead: `supabase db push`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const dir = path.join(process.cwd(), "supabase/migrations");
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

async function main() {
  await sql`create table if not exists _local_migrations (name text primary key, applied_at timestamptz default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from _local_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const body = await readFile(path.join(dir, f), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _local_migrations (name) values (${f})`;
    });
    console.log(`applied ${f}`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
