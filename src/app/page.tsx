import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-brand-900">Comunio</h1>
      <p className="max-w-md text-stone-600">
        Administração de condomínios automatizada: quotas por permilagem, referências Multibanco e MB WAY,
        recibos certificados e assembleias conforme a Lei n.º 8/2022.
      </p>
      <Link
        href="/admin"
        className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
      >
        Entrar no painel
      </Link>
    </main>
  );
}
