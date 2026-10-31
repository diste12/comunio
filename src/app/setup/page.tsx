import { connection } from "next/server";
import { Suspense } from "react";
import { diagnose } from "@/lib/setup";

export const metadata = { title: "Configuração", robots: { index: false } };

/** Deployment self-check: what is missing for the app to run (no secret values shown). */
export default function SetupPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-8">
      <h1 className="text-xl font-semibold text-brand-900">Configuração do Comunio</h1>
      <p className="text-sm text-stone-600">
        Defina as variáveis em Vercel → Project → Settings → Environment Variables e faça redeploy.
      </p>
      <Suspense fallback={<p className="text-sm text-stone-500">A verificar…</p>}>
        <Checks />
      </Suspense>
    </main>
  );
}

async function Checks() {
  await connection();
  const checks = await diagnose();
  const ok = checks.every((c) => c.ok);
  return (
    <>
      <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
        {checks.map((c) => (
          <li key={c.key} className="flex gap-3 px-4 py-3">
            <span className={c.ok ? "text-brand-700" : "text-red-700"}>{c.ok ? "✔" : "✖"}</span>
            <span className="text-sm">
              <span className="font-medium">{c.label}</span>
              {!c.ok && c.hint && <span className="mt-0.5 block text-xs text-stone-600">{c.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {ok ? (
        <a href="/admin" className="inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          Tudo pronto — entrar no painel
        </a>
      ) : (
        <p className="text-sm text-stone-600">Corrija os itens assinalados e recarregue esta página.</p>
      )}
    </>
  );
}
