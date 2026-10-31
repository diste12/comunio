import { Suspense } from "react";
import { sql } from "@/lib/db";
import { formatEur } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/pdf/document";
import { currentResident } from "@/lib/resident-session";
import {
  chargesForFraction,
  isOwner,
  nextAssembly,
  openTicketsForCondominium,
  payableCharges,
  type ResidentContext,
} from "@/lib/services/residents";
import { ticketRef } from "@/lib/triage/ticket-ref";
import { liveAssemblyForFraction } from "@/lib/services/assemblies";
import { CheckInButton, LiveRefresh, MbWayButton, OwnerVote, ReportIssueForm } from "./_components";
import { logout } from "./actions";

const STATUS: Record<string, [string, string]> = {
  OPEN: ["Aberta", "bg-amber-100 text-amber-800"],
  IN_PROGRESS: ["Em resolução", "bg-blue-100 text-blue-800"],
  AWAITING_QUOTES: ["A orçamentar", "bg-blue-100 text-blue-800"],
  RESOLVED: ["Resolvida", "bg-brand-100 text-brand-700"],
  CLOSED: ["Fechada", "bg-stone-200 text-stone-600"],
};

export default function PortalPage() {
  return (
    <Suspense fallback={<div className="p-6 text-stone-500">A carregar…</div>}>
      <Portal />
    </Suspense>
  );
}

async function Portal() {
  const me = await currentResident();
  if (!me) {
    return (
      <main className="flex flex-1 flex-col justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold text-brand-900">Portal do condómino</h1>
        <p className="text-stone-600">
          Para entrar, escreva <strong>&quot;portal&quot;</strong> no WhatsApp do seu condomínio e receberá um link pessoal.
        </p>
      </main>
    );
  }
  return (
    <main className="space-y-4 p-4 pb-10">
      <header className="flex items-start justify-between pt-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">{me.condominiumName}</p>
          <h1 className="text-lg font-semibold">Olá, {me.fullName.split(" ")[0]}</h1>
          <p className="text-sm text-stone-600">
            Fração {me.designation} · {me.role}
          </p>
        </div>
        <form action={logout}>
          <button className="text-xs text-stone-500 underline">Sair</button>
        </form>
      </header>
      {isOwner(me) && <LiveAssembly me={me} />}
      {isOwner(me) && <Billing me={me} />}
      <Tickets me={me} />
      <Assemblies me={me} />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-stone-800">{title}</h2>
      {children}
    </section>
  );
}

async function Billing({ me }: { me: ResidentContext }) {
  const [payable, all] = await Promise.all([payableCharges(me.fractionId), chargesForFraction(me.fractionId)]);
  const paid = all.filter((c) => c.status === "PAID").reverse().slice(0, 12);
  const overdue = payable.filter((c) => c.overdue).reduce((s, c) => s + c.amountCents, 0);
  return (
    <>
      <Section title="Quotas por pagar">
        {overdue > 0 && (
          <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-800">Valor em atraso: {formatEur(overdue)}</p>
        )}
        {payable.length === 0 ? (
          <p className="text-sm text-stone-600">Sem quotas em atraso nem a vencer nos próximos 45 dias. ✅</p>
        ) : (
          <ul className="space-y-3">
            {payable.map((c) => (
              <li key={c.id} className="rounded-lg border border-stone-200 p-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{c.description.split(" — ")[0]}</span>
                  <span className="font-semibold tabular-nums">{formatEur(c.amountCents)}</span>
                </div>
                <p className={`text-xs ${c.overdue ? "text-red-700" : "text-stone-500"}`}>
                  {c.overdue ? "Em atraso desde" : "Vence a"} {fmtDate(c.dueDate)}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-1 rounded bg-stone-50 p-2 text-xs">
                  <dt className="text-stone-500">Entidade</dt>
                  <dt className="text-stone-500">Referência</dt>
                  <dt className="text-stone-500">Valor</dt>
                  <dd className="font-mono">{c.mbEntity}</dd>
                  <dd className="font-mono">{c.mbReference?.replace(/(\d{3})(?=\d)/g, "$1 ")}</dd>
                  <dd className="font-mono">{(c.amountCents / 100).toFixed(2)}</dd>
                </dl>
                <MbWayButton chargeId={c.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Pagamentos e recibos">
        {paid.length === 0 ? (
          <p className="text-sm text-stone-600">Sem pagamentos registados.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {paid.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>
                  {c.description.split(" — ")[0]}
                  <span className="block text-xs text-stone-500">pago a {c.paidAt ? fmtDate(c.paidAt) : "—"}</span>
                </span>
                {c.hasReceipt ? (
                  <a href={`/portal/recibos/${c.id}`} className="text-xs font-medium text-brand-700 underline">
                    Recibo
                  </a>
                ) : (
                  <span className="text-xs text-stone-400">a emitir</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

async function Tickets({ me }: { me: ResidentContext }) {
  const tickets = await openTicketsForCondominium(me.condominiumId, 8);
  return (
    <Section title="Ocorrências do prédio">
      {tickets.length > 0 && (
        <ul className="mb-4 space-y-2">
          {tickets.map((t) => {
            const [label, cls] = STATUS[t.status] ?? [t.status, "bg-stone-100"];
            return (
              <li key={t.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {t.category} <span className="font-mono text-xs text-stone-400">{ticketRef(t.id)}</span>
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{label}</span>
                </div>
                <p className="line-clamp-2 text-xs text-stone-600">{t.description}</p>
              </li>
            );
          })}
        </ul>
      )}
      <ReportIssueForm />
    </Section>
  );
}

async function Assemblies({ me }: { me: ResidentContext }) {
  const next = await nextAssembly(me.condominiumId);
  const minutes = isOwner(me)
    ? await sql<{ assembly_id: string; scheduled_at: Date }[]>`
        select m.assembly_id, a.scheduled_at from minutes m join assemblies a on a.id = m.assembly_id
        where a.condominium_id = ${me.condominiumId} and m.status = 'APPROVED'
        order by a.scheduled_at desc limit 10`
    : [];
  return (
    <Section title="Assembleias">
      {next ? (
        <p className="text-sm">
          Próxima assembleia: <strong>{fmtDateTime(next.scheduled_at)}</strong>
          <br />
          <span className="text-stone-600">{next.location}</span>
          {next.online_url && (
            <a href={next.online_url} className="block text-brand-700 underline">
              Participar online
            </a>
          )}
        </p>
      ) : (
        <p className="text-sm text-stone-600">Nenhuma assembleia convocada.</p>
      )}
      {minutes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {minutes.map((m) => (
            <li key={m.assembly_id}>
              <a href={`/portal/atas/${m.assembly_id}`} className="text-brand-700 underline">
                Ata de {fmtDate(m.scheduled_at)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const VOTE_PT: Record<string, string> = { FAVOR: "a favor", CONTRA: "contra", ABSTENCAO: "abstenção" };

/** Hybrid assembly: online check-in and voting while the session is live. */
async function LiveAssembly({ me }: { me: ResidentContext }) {
  const live = await liveAssemblyForFraction(me.condominiumId, me.fractionId);
  if (!live) return null;
  return (
    <section className="rounded-xl border-2 border-brand-600 bg-white p-4">
      <LiveRefresh />
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-900">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" /> Assembleia a decorrer
      </h2>
      {live.onlineUrl && (
        <a href={live.onlineUrl} target="_blank" className="mb-3 block text-sm text-brand-700 underline">
          Entrar na videoconferência
        </a>
      )}
      {!live.checkedIn ? (
        live.remoteAllowed ? (
          <CheckInButton />
        ) : (
          <p className="text-sm text-stone-600">Esta assembleia é apenas presencial.</p>
        )
      ) : live.openItem ? (
        <div className="space-y-2">
          <p className="text-sm">
            Em votação — ponto {live.openItem.position}: <strong>{live.openItem.title}</strong>
          </p>
          <OwnerVote itemId={live.openItem.id} current={live.openItem.vote} />
          {live.openItem.vote && <p className="text-xs text-brand-700">O seu voto ({VOTE_PT[live.openItem.vote]}) foi registado. Pode alterá-lo enquanto a votação estiver aberta.</p>}
        </div>
      ) : (
        <p className="text-sm text-stone-600">
          Presença registada ({live.mode === "ONLINE" ? "online" : "presencial"}). Aguarde a abertura da próxima votação.
        </p>
      )}
    </section>
  );
}
