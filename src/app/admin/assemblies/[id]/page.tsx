import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { formatPermilagem, hasMinimumNotice, MIN_NOTICE_DAYS, noticeDeadline, type TallyOutcome } from "@/lib/assembly/rules";
import { requireAdmin } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/pdf/document";
import { getAssembly, listConvocations, MAJORITY_PT, type AssemblyView } from "@/lib/services/assemblies";
import { getMinutes } from "@/lib/services/minutes";
import { Badge, Card, Skeleton, td, th } from "@/components/ui";
import { ActionButton } from "../../_components/action-button";
import {
  approveMinutesAction,
  castAllAction,
  closeAssemblyAction,
  generateMinutesAction,
  sendConvocationsAction,
  setVotingStatusAction,
  startSessionAction,
} from "../actions";
import { AttendanceControl, AudioUpload, AutoRefresh, MinutesEditor, TranscriptEditor, VoteButtons } from "./_live";

const STATUS: Record<string, [string, "gray" | "amber" | "green" | "red"]> = {
  DRAFT: ["Rascunho", "gray"],
  CONVOKED: ["Convocada", "amber"],
  IN_PROGRESS: ["A decorrer", "green"],
  CLOSED: ["Encerrada", "gray"],
};
const OUTCOME: Record<TallyOutcome, [string, "green" | "red" | "amber" | "gray"]> = {
  APPROVED: ["Aprovado", "green"],
  REJECTED: ["Rejeitado", "red"],
  NO_QUORUM: ["Sem quórum", "amber"],
  CONDITIONAL: ["Aprovado sob condição", "amber"],
};

export default function AssemblyPage(props: PageProps<"/admin/assemblies/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={14} />}>
      <Assembly params={props.params} />
    </Suspense>
  );
}

async function Assembly({ params }: { params: PageProps<"/admin/assemblies/[id]">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const view = await getAssembly(id);
  if (!view) notFound();
  const { assembly: a } = view;
  const [status, tone] = STATUS[a.status];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/admin/condominiums/${a.condominium_id}`} className="text-xs text-stone-500 hover:underline">
            ← {a.condo_name}
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold">
            Assembleia {a.kind === "ORDINARIA" ? "ordinária" : "extraordinária"} <Badge tone={tone}>{status}</Badge>
          </h1>
          <p className="text-sm text-stone-600">
            {fmtDateTime(a.scheduled_at)} · {a.location}
            {a.online_url && <> · <a href={a.online_url} className="underline">videoconferência</a></>}
            {a.session_call && ` · ${a.session_call}.ª convocatória`}
          </p>
        </div>
        {a.status === "IN_PROGRESS" && <AutoRefresh />}
      </div>

      {(a.status === "DRAFT" || a.status === "CONVOKED") && <Convocations view={view} />}
      <Live view={view} />
      {a.status === "CLOSED" && <Minutes view={view} />}
    </div>
  );
}

async function Convocations({ view }: { view: AssemblyView }) {
  const a = view.assembly;
  const rows = await listConvocations(a.id);
  const onTime = hasMinimumNotice(a.scheduled_at);
  return (
    <Card
      title="Convocatórias (Lei n.º 8/2022)"
      actions={
        <span className="flex items-center gap-3">
          <a href={`/admin/assemblies/${a.id}/convocatoria.pdf`} target="_blank" className="text-sm text-brand-700 underline">
            Pré-visualizar PDF
          </a>
          {onTime && <ActionButton action={sendConvocationsAction.bind(null, a.id)} label="Enviar convocatórias" pendingLabel="A enviar…" />}
        </span>
      }
    >
      <p className="mb-3 text-sm text-stone-600">
        Email para quem deu consentimento registado; carta registada (CTT) para os restantes. Prazo mínimo de {MIN_NOTICE_DAYS} dias:
        enviar até <strong>{fmtDate(noticeDeadline(a.scheduled_at))}</strong>.
        {!onTime && <span className="ml-1 font-medium text-red-700">O prazo legal já passou — reagende a assembleia.</span>}
      </p>
      {rows.length > 0 && (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full">
            <thead className="border-y border-stone-100 bg-stone-50">
              <tr><th className={th}>Fração</th><th className={th}>Proprietário</th><th className={th}>Canal</th><th className={th}>Estado</th><th className={th}>Referência</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.designation}>
                  <td className={`${td} font-medium`}>{r.designation}</td>
                  <td className={td}>{r.full_name ?? "—"}</td>
                  <td className={td}>{r.channel === "EMAIL" ? "Email" : "Carta registada"}</td>
                  <td className={td}>
                    <Badge tone={r.status === "SENT" ? "green" : r.status === "FAILED" ? "red" : "gray"}>{r.status}</Badge>
                    {r.error && <span className="ml-1 text-xs text-red-700">{r.error}</span>}
                  </td>
                  <td className={`${td} font-mono text-xs`}>{r.provider_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Live({ view }: { view: AssemblyView }) {
  const { assembly: a, fractions, quorum, items, call } = view;
  const live = a.status === "IN_PROGRESS";
  const pct = quorum.presentPct * 100;
  const openItem = items.find((i) => i.votingStatus === "OPEN");

  return (
    <>
      <Card
        title="Quórum"
        actions={
          a.status === "CLOSED" ? null : live ? (
            <ActionButton action={closeAssemblyAction.bind(null, a.id)} label="Encerrar assembleia" variant="secondary" />
          ) : (
            <span className="flex gap-2">
              <ActionButton action={startSessionAction.bind(null, a.id, 1)} label="Iniciar (1.ª convocatória)" />
              <ActionButton action={startSessionAction.bind(null, a.id, 2)} label="Iniciar (2.ª convocatória)" variant="secondary" />
            </span>
          )
        }
      >
        <div className="flex items-end justify-between text-sm">
          <span>
            <span className="text-2xl font-semibold tabular-nums">{formatPermilagem(quorum.presentHundredths)}</span>
            <span className="text-stone-500"> de 1000‰ · {quorum.presentFractions}/{quorum.totalFractions} frações</span>
          </span>
          <span className="space-x-2">
            <Badge tone={quorum.canDeliberate.firstCall ? "green" : "gray"}>1.ª conv. &gt; 50%</Badge>
            <Badge tone={quorum.canDeliberate.secondCall ? "green" : "gray"}>2.ª conv. ≥ 25%</Badge>
          </span>
        </div>
        <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-stone-100">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
          <div className="absolute inset-y-0 left-1/4 w-px bg-stone-400" title="25%" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-stone-500" title="50%" />
        </div>
      </Card>

      <Card title="Ordem de trabalhos e votações">
        <ol className="space-y-3">
          {items.map((i) => {
            const [label, tone] = OUTCOME[i.tally.outcome];
            const showTally = i.votingStatus !== "PENDING" || i.votes.size > 0;
            return (
              <li key={i.id} className={`rounded-md border p-3 ${i.votingStatus === "OPEN" ? "border-brand-600 bg-brand-50/40" : "border-stone-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{i.position}. {i.title}</span>
                    <span className="ml-2 text-xs text-stone-500">{MAJORITY_PT[i.majority]}</span>
                  </div>
                  {live && (
                    <span className="flex items-center gap-2">
                      {i.votingStatus !== "OPEN" ? (
                        <ActionButton action={setVotingStatusAction.bind(null, a.id, i.id, "OPEN")} label={i.votingStatus === "CLOSED" ? "Reabrir votação" : "Abrir votação"} variant="secondary" />
                      ) : (
                        <>
                          <ActionButton action={castAllAction.bind(null, a.id, i.id, "FAVOR")} label="Restantes a favor" variant="link" />
                          <ActionButton action={setVotingStatusAction.bind(null, a.id, i.id, "CLOSED")} label="Fechar votação" variant="secondary" />
                        </>
                      )}
                    </span>
                  )}
                </div>
                {showTally && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="text-brand-700">Favor {formatPermilagem(i.tally.favor)}</span>
                    <span className="text-red-700">Contra {formatPermilagem(i.tally.contra)}</span>
                    <span className="text-stone-600">Abstenção {formatPermilagem(i.tally.abstencao)}</span>
                    <span className="text-stone-400">Por votar {formatPermilagem(i.tally.notVoted)}</span>
                    <Badge tone={tone}>{i.votingStatus === "OPEN" ? `Parcial: ${label}` : label}</Badge>
                    <span className="text-stone-500">{i.tally.basis}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      <Card title={openItem ? `Presenças e votos — ponto ${openItem.position} em votação` : "Presenças"}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-100 bg-stone-50">
              <tr>
                <th className={th}>Fração</th>
                <th className={`${th} text-right`}>‰</th>
                <th className={th}>Proprietário</th>
                <th className={th}>Presença</th>
                {openItem && <th className={th}>Voto ({call}.ª conv.)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {fractions.map((f) => (
                <tr key={f.fractionId} className={f.attendance ? "" : "text-stone-400"}>
                  <td className={`${td} font-medium`}>{f.designation}</td>
                  <td className={`${td} text-right tabular-nums`}>{f.permilagem.toFixed(2)}</td>
                  <td className={td}>{f.ownerName ?? "—"}</td>
                  <td className={td}>
                    <AttendanceControl
                      assemblyId={a.id}
                      fractionId={f.fractionId}
                      mode={f.attendance?.mode ?? "ABSENT"}
                      representative={f.attendance?.representative ?? null}
                      disabled={!live}
                    />
                  </td>
                  {openItem && (
                    <td className={td}>
                      {f.attendance && (
                        <VoteButtons assemblyId={a.id} itemId={openItem.id} fractionId={f.fractionId} current={openItem.votes.get(f.fractionId) ?? null} disabled={!live} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

async function Minutes({ view }: { view: AssemblyView }) {
  const a = view.assembly;
  const minutes = await getMinutes(a.id);
  return (
    <>
      <Card title="Gravação e transcrição">
        <div className="space-y-4">
          <AudioUpload assemblyId={a.id} />
          <TranscriptEditor assemblyId={a.id} transcript={a.transcript ?? ""} />
        </div>
      </Card>
      <Card
        title={minutes ? `Ata — ${minutes.status === "APPROVED" ? "aprovada" : "rascunho"}` : "Ata"}
        actions={
          <span className="flex items-center gap-3">
            {minutes && (
              <a href={`/admin/assemblies/${a.id}/ata.pdf`} target="_blank" className="text-sm text-brand-700 underline">
                PDF
              </a>
            )}
            {minutes?.status !== "APPROVED" && (
              <ActionButton
                action={generateMinutesAction.bind(null, a.id)}
                label={minutes ? "Regenerar ata" : "Gerar ata"}
                pendingLabel="A redigir…"
                variant={minutes ? "secondary" : "primary"}
              />
            )}
            {minutes?.status === "DRAFT" && <ActionButton action={approveMinutesAction.bind(null, a.id)} label="Aprovar e assinar" />}
          </span>
        }
      >
        {minutes ? (
          <>
            <p className="mb-2 text-xs text-stone-500">
              {minutes.status === "APPROVED"
                ? `Aprovada por ${minutes.approved_by} em ${fmtDateTime(minutes.approved_at!)}.`
                : `Gerada por ${minutes.generated_by === "LLM" ? "IA a partir da transcrição" : "modelo"}. Presenças, votações e dívidas são calculadas a partir dos dados — reveja antes de assinar.`}
            </p>
            <MinutesEditor assemblyId={a.id} body={minutes.body} readOnly={minutes.status === "APPROVED"} />
          </>
        ) : (
          <p className="text-sm text-stone-600">
            Gere a ata depois de carregar a gravação. Inclui a lista de presenças, os resultados das votações por permilagem e a
            declaração de dívidas por fração (título executivo).
          </p>
        )}
      </Card>
    </>
  );
}
