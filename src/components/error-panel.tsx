"use client";

/** Shared error boundary UI: shows the digest to search in Vercel → Logs. */
export function ErrorPanel({ error, retry, setupLink = true }: { error: unknown; retry: () => void; setupLink?: boolean }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-semibold">Algo correu mal</h1>
      <p className="text-sm text-stone-600">Ocorreu um erro no servidor ao carregar esta página.</p>
      {digest && <p className="font-mono text-xs text-stone-500">Código: {digest} (procure-o em Vercel → Logs)</p>}
      <div className="flex justify-center gap-3">
        <button onClick={() => retry()} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          Tentar novamente
        </button>
        {setupLink && (
          <a href="/setup" className="rounded-md border border-stone-300 px-4 py-2 text-sm">
            Verificar configuração
          </a>
        )}
      </div>
    </div>
  );
}
