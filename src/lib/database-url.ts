/**
 * Resolve the Postgres connection string. Accepts DATABASE_URL, or POSTGRES_URL
 * as injected by the Supabase ↔ Vercel integration (transaction pooler).
 * Strips driver-specific query params Postgres itself does not understand.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.searchParams.delete("supa"); // Supabase integration marker
    url.searchParams.delete("pgbouncer"); // Prisma hint
    return url.toString();
  } catch {
    return raw;
  }
}

/** Supabase hosts require TLS; honour an explicit sslmode if the URL has one. */
export function needsTls(url: string): boolean {
  try {
    const u = new URL(url);
    return !u.searchParams.has("sslmode") && /\.supabase\.(co|com)$/.test(u.hostname);
  } catch {
    return false;
  }
}
