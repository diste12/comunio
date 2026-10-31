import "server-only";
import postgres from "postgres";

/**
 * Deployment self-check. Reads process.env directly (not env()) so a missing
 * variable is reported instead of crashing. Only booleans and generic hints
 * are returned — never values, hosts or raw driver errors.
 */

export type Check = { key: string; label: string; ok: boolean; hint?: string };

const has = (name: string) => Boolean(process.env[name]?.trim());

/** Configuration that /admin cannot work without (cheap, no I/O). */
export function adminConfigMissing(): string[] {
  const missing: string[] = [];
  if (!has("DATABASE_URL")) missing.push("DATABASE_URL");
  if (!has("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") || !has("CLERK_SECRET_KEY")) missing.push("CLERK");
  if (process.env.NODE_ENV === "production" && !has("ADMIN_EMAILS")) missing.push("ADMIN_EMAILS");
  return missing;
}

const REQUIRED_TABLES = ["condominiums", "assemblies", "bank_transactions"] as const;

async function databaseChecks(): Promise<Check[]> {
  if (!has("DATABASE_URL")) {
    return [{ key: "db", label: "Ligação à base de dados", ok: false, hint: "Defina DATABASE_URL primeiro." }];
  }
  const url = process.env.DATABASE_URL!;
  const directSupabaseHost = /@db\.[a-z0-9]+\.supabase\.co(:5432)?\//i.test(url);
  const probe = postgres(url, { max: 1, connect_timeout: 6, idle_timeout: 1, onnotice: () => {} });
  try {
    const [row] = await probe<{ c: boolean; a: boolean; b: boolean }[]>`
      select to_regclass('public.condominiums') is not null c,
             to_regclass('public.assemblies') is not null a,
             to_regclass('public.bank_transactions') is not null b`;
    const migrated = row.c && row.a && row.b;
    return [
      { key: "db", label: "Ligação à base de dados", ok: true },
      {
        key: "schema",
        label: `Tabelas criadas (${REQUIRED_TABLES.join(", ")})`,
        ok: migrated,
        hint: migrated ? undefined : row.c
          ? "Faltam migrações recentes: execute `supabase db push`."
          : "Base de dados vazia: execute `supabase link` e `supabase db push`.",
      },
    ];
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    let hint = "Não foi possível ligar. Verifique o URL de ligação.";
    if (["ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ETIMEDOUT", "CONNECT_TIMEOUT"].includes(code)) {
      hint = directSupabaseHost
        ? "Está a usar o host direto db.<ref>.supabase.co, que só funciona por IPv6 e não é acessível a partir da Vercel. Use o URL do Transaction pooler (Supabase → Connect → Transaction pooler, porta 6543)."
        : "Servidor inacessível. Na Vercel use o URL do Transaction pooler do Supabase (porta 6543).";
    } else if (code === "28P01" || code === "28000") {
      hint = "Utilizador ou palavra-passe errados no DATABASE_URL (no pooler o utilizador é postgres.<ref>).";
    } else if (code === "3D000") {
      hint = "A base de dados indicada no URL não existe.";
    } else if (code === "XX000" || /tenant|user not found/i.test((e as Error).message)) {
      hint = "O pooler não reconhece o projeto: confirme o utilizador postgres.<ref> e a região do URL.";
    }
    return [{ key: "db", label: "Ligação à base de dados", ok: false, hint }];
  } finally {
    await probe.end({ timeout: 1 }).catch(() => {});
  }
}

export async function diagnose(): Promise<Check[]> {
  const prod = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET ?? "";
  const appUrl = process.env.APP_URL ?? "";
  const checks: Check[] = [
    { key: "DATABASE_URL", label: "DATABASE_URL definido", ok: has("DATABASE_URL"), hint: "Supabase → Connect → Transaction pooler (porta 6543)." },
    ...(await databaseChecks()),
    {
      key: "clerk", label: "Clerk configurado (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY)",
      ok: has("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && has("CLERK_SECRET_KEY"),
      hint: "Clerk → API keys. Após definir NEXT_PUBLIC_*, faça redeploy (é lida no build).",
    },
    { key: "ADMIN_EMAILS", label: "ADMIN_EMAILS definido", ok: has("ADMIN_EMAILS"), hint: "Emails com acesso ao painel, separados por vírgulas." },
    { key: "SESSION_SECRET", label: "SESSION_SECRET com ≥ 32 caracteres", ok: secret.length >= 32, hint: "Necessário para o portal dos condóminos. Ex.: openssl rand -base64 48" },
    { key: "APP_URL", label: "APP_URL aponta para o domínio público", ok: Boolean(appUrl) && !(prod && appUrl.includes("localhost")), hint: "Usado nos links do portal e dos fornecedores." },
    { key: "CRON_SECRET", label: "CRON_SECRET definido", ok: has("CRON_SECRET"), hint: "Sem ele as tarefas agendadas (recibos, referências) recusam correr." },
  ];
  return checks;
}
