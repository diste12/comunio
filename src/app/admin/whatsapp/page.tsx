import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtDateTime } from "@/lib/pdf/document";
import { Badge, Card, Skeleton } from "@/components/ui";
import { WhatsAppSimulator } from "../_components/simulator";

export const metadata = { title: "WhatsApp" };

export default function WhatsAppPage({ searchParams }: PageProps<"/admin/whatsapp">) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">WhatsApp — triagem automática</h1>
      <Suspense fallback={<Skeleton rows={10} />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/admin/whatsapp">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const phone = typeof sp.phone === "string" ? sp.phone : null;

  const threads = await sql<{ phone_number: string; full_name: string | null; designation: string | null; condo: string | null; last_body: string; last_at: Date; last_intent: string | null }[]>`
    select distinct on (m.phone_number) m.phone_number, r.full_name, f.designation, c.name condo,
           m.body last_body, m.created_at last_at, m.intent last_intent
    from whatsapp_messages m
    left join residents r on r.id = m.resident_id
    left join fractions f on f.id = r.fraction_id
    left join condominiums c on c.id = f.condominium_id
    order by m.phone_number, m.created_at desc`;
  threads.sort((a, b) => b.last_at.getTime() - a.last_at.getTime());

  const messages = phone
    ? await sql<{ id: string; direction: "IN" | "OUT"; body: string; intent: string | null; created_at: Date }[]>`
        select id, direction, body, intent, created_at from whatsapp_messages
        where phone_number = ${phone} order by created_at limit 200`
    : [];
  const [sample] = await sql<{ phone_number: string; full_name: string }[]>`
    select r.phone_number, r.full_name from residents r where r.role = 'Proprietário' order by r.created_at limit 1`;

  return (
    <>
      {env().WHATSAPP_PROVIDER === "mock" && (
        <Card title="Simulador (modo mock)">
          <WhatsAppSimulator defaultPhone={phone ?? sample?.phone_number} />
          <p className="mt-2 text-xs text-stone-500">
            Experimente: &quot;quanto devo?&quot;, &quot;MB WAY&quot;, &quot;o elevador está avariado&quot;, &quot;portal&quot;, &quot;próxima assembleia&quot;.
            {env().OPENAI_API_KEY ? " Respostas geradas pelo LLM." : " Sem OPENAI_API_KEY: respostas por regras."}
          </p>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title={`${threads.length} conversas`}>
          <ul className="-m-4 divide-y divide-stone-100">
            {threads.map((t) => (
              <li key={t.phone_number}>
                <Link
                  href={`?phone=${t.phone_number}`}
                  className={`block px-4 py-2.5 hover:bg-stone-50 ${t.phone_number === phone ? "bg-brand-50" : ""}`}
                >
                  <div className="flex justify-between text-sm font-medium">
                    <span>{t.full_name ?? `+${t.phone_number}`}</span>
                    {t.last_intent && <Badge tone="gray">{t.last_intent}</Badge>}
                  </div>
                  <div className="text-xs text-stone-500">
                    {t.condo ? `${t.condo} · ${t.designation}` : "Número desconhecido"}
                  </div>
                  <div className="truncate text-xs text-stone-600">{t.last_body}</div>
                </Link>
              </li>
            ))}
            {threads.length === 0 && <li className="px-4 py-3 text-sm text-stone-500">Sem mensagens.</li>}
          </ul>
        </Card>
        <Card title={phone ? `+${phone}` : "Selecione uma conversa"}>
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "OUT" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.direction === "OUT" ? "bg-brand-50 text-stone-900" : "bg-stone-100"
                  }`}
                >
                  {m.body}
                  <div className="mt-1 text-[10px] text-stone-500">
                    {fmtDateTime(m.created_at)}
                    {m.intent && m.direction === "IN" ? ` · ${m.intent}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
