import { redirect } from "next/navigation";
import { Suspense } from "react";
import { startResidentSession } from "@/lib/resident-session";
import { consumeMagicLink, peekMagicLink } from "@/lib/services/residents";

export const metadata = { title: "Entrar", robots: { index: false } };

/**
 * Magic-link landing. Entering requires a click (POST) so WhatsApp's link
 * preview crawler cannot consume the single-use token.
 */
export default function MagicLinkPage({ params }: PageProps<"/r/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <Suspense fallback={<p className="text-stone-500">A verificar…</p>}>
        <Landing params={params} />
      </Suspense>
    </main>
  );
}

async function Landing({ params }: { params: PageProps<"/r/[token]">["params"] }) {
  const { token } = await params;
  const who = await peekMagicLink(token);
  if (!who) {
    return (
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-semibold">Link expirado</h1>
        <p className="text-stone-600">Peça um novo link escrevendo &quot;portal&quot; no WhatsApp do condomínio.</p>
      </div>
    );
  }
  async function enter() {
    "use server";
    const residentId = await consumeMagicLink(token);
    if (!residentId) redirect(`/r/${token}`);
    await startResidentSession(residentId);
    redirect("/portal");
  }
  return (
    <form action={enter} className="space-y-4 text-center">
      <h1 className="text-2xl font-semibold text-brand-900">Olá, {who.firstName}</h1>
      <p className="text-stone-600">Entre no portal do seu condomínio para ver quotas, recibos e ocorrências.</p>
      <button className="w-full rounded-lg bg-brand-600 py-3 font-medium text-white hover:bg-brand-700">Entrar no portal</button>
    </form>
  );
}
