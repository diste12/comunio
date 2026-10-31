import "server-only";
import { sql } from "@/lib/db";
import {
  computeQuorum,
  hasMinimumNotice,
  MIN_NOTICE_DAYS,
  noticeDeadline,
  tallyVotes,
  type Call,
  type Majority,
  type Tally,
  type VoteChoice,
} from "@/lib/assembly/rules";
import { sendRegisteredLetter } from "@/lib/messaging/ctt";
import { escapeHtml, sendEmail } from "@/lib/messaging/email";
import { fmtDate, fmtDateTime, renderPdf } from "@/lib/pdf/document";

export class AssemblyError extends Error {}

export type AgendaInput = { title: string; majority: Majority };

export async function createAssembly(input: {
  condominiumId: string;
  kind: "ORDINARIA" | "EXTRAORDINARIA";
  scheduledAt: Date;
  secondCallAt: Date | null;
  location: string;
  onlineUrl: string | null;
  agenda: AgendaInput[];
}) {
  if (input.agenda.length === 0) throw new AssemblyError("A ordem de trabalhos não pode estar vazia.");
  if (input.secondCallAt && input.secondCallAt <= input.scheduledAt) {
    throw new AssemblyError("A segunda convocatória tem de ser posterior à primeira.");
  }
  return sql.begin(async (tx) => {
    const [a] = await tx<{ id: string }[]>`
      insert into assemblies ${tx({
        condominium_id: input.condominiumId, kind: input.kind, scheduled_at: input.scheduledAt,
        second_call_at: input.secondCallAt, location: input.location, online_url: input.onlineUrl,
      })} returning id`;
    await tx`insert into assembly_agenda_items ${tx(
      input.agenda.map((item, i) => ({ assembly_id: a.id, position: i + 1, title: item.title, required_majority: item.majority })),
    )}`;
    return a.id;
  });
}

export type AssemblyFraction = {
  fractionId: string;
  designation: string;
  permilagem: number;
  ownerName: string | null;
  attendance: { mode: "PRESENT" | "ONLINE" | "REPRESENTED"; representative: string | null } | null;
};

export type AgendaItem = {
  id: string;
  position: number;
  title: string;
  majority: Majority;
  votingStatus: "PENDING" | "OPEN" | "CLOSED";
  notes: string | null;
  votes: Map<string, VoteChoice>;
  /** Fractions whose vote was cast by the owner online (portal). */
  ownerVotes: Set<string>;
  tally: Tally;
};

export async function getAssembly(id: string) {
  const [a] = await sql<
    {
      id: string; condominium_id: string; kind: "ORDINARIA" | "EXTRAORDINARIA"; scheduled_at: Date; second_call_at: Date | null;
      location: string; online_url: string | null; status: "DRAFT" | "CONVOKED" | "IN_PROGRESS" | "CLOSED";
      session_call: Call | null; started_at: Date | null; closed_at: Date | null; transcript: string | null;
      condo_name: string; nif_condominio: string; address: string | null; postal_code: string | null; city: string | null;
    }[]
  >`
    select a.*, c.name condo_name, c.nif_condominio, c.address, c.postal_code, c.city
    from assemblies a join condominiums c on c.id = a.condominium_id where a.id = ${id}`;
  if (!a) return null;

  const [fractionRows, attendanceRows, itemRows, voteRows] = await Promise.all([
    sql<{ id: string; designation: string; permilagem: string; owner_name: string | null }[]>`
      select f.id, f.designation, f.permilagem,
        (select full_name from residents r where r.fraction_id = f.id and r.role = 'Proprietário' order by created_at limit 1) owner_name
      from fractions f where f.condominium_id = ${a.condominium_id} order by f.designation`,
    sql<{ fraction_id: string; mode: "PRESENT" | "ONLINE" | "REPRESENTED"; representative_name: string | null }[]>`
      select fraction_id, mode, representative_name from assembly_attendance where assembly_id = ${id}`,
    sql<{ id: string; position: number; title: string; required_majority: Majority; voting_status: AgendaItem["votingStatus"]; discussion_notes: string | null }[]>`
      select * from assembly_agenda_items where assembly_id = ${id} order by position`,
    sql<{ agenda_item_id: string; fraction_id: string; vote: VoteChoice; cast_by: "ADMIN" | "OWNER" }[]>`
      select v.agenda_item_id, v.fraction_id, v.vote, v.cast_by from assembly_votes v
      join assembly_agenda_items i on i.id = v.agenda_item_id where i.assembly_id = ${id}`,
  ]);

  const attendance = new Map(attendanceRows.map((r) => [r.fraction_id, { mode: r.mode, representative: r.representative_name }]));
  const fractions: AssemblyFraction[] = fractionRows.map((f) => ({
    fractionId: f.id, designation: f.designation, permilagem: Number(f.permilagem), ownerName: f.owner_name,
    attendance: attendance.get(f.id) ?? null,
  }));
  const presentIds = fractions.filter((f) => f.attendance).map((f) => f.fractionId);
  const quorum = computeQuorum(fractions, presentIds);
  const call: Call = a.session_call ?? 1;

  const items: AgendaItem[] = itemRows.map((i) => {
    const votes = new Map(voteRows.filter((v) => v.agenda_item_id === i.id).map((v) => [v.fraction_id, v.vote]));
    return {
      id: i.id, position: i.position, title: i.title, majority: i.required_majority, votingStatus: i.voting_status,
      notes: i.discussion_notes, votes,
      ownerVotes: new Set(voteRows.filter((v) => v.agenda_item_id === i.id && v.cast_by === "OWNER").map((v) => v.fraction_id)),
      tally: tallyVotes({
        fractions, presentIds, majority: i.required_majority, call,
        votes: [...votes].map(([fractionId, vote]) => ({ fractionId, vote })),
      }),
    };
  });

  return { assembly: a, fractions, quorum, items, call };
}

export type AssemblyView = NonNullable<Awaited<ReturnType<typeof getAssembly>>>;

const KIND_PT = { ORDINARIA: "ordinária", EXTRAORDINARIA: "extraordinária" } as const;
const MAJORITY_PT: Record<Majority, string> = {
  SIMPLE: "maioria simples",
  TWO_THIRDS: "maioria de 2/3 do capital",
  UNANIMITY: "unanimidade",
};
export { MAJORITY_PT };

export async function convocationPdf(view: AssemblyView): Promise<Uint8Array> {
  const { assembly: a, items } = view;
  const address = [a.address, [a.postal_code, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const second = a.second_call_at
    ? `no dia ${fmtDateTime(a.second_call_at)}, no mesmo local`
    : "uma semana depois, à mesma hora e no mesmo local (art. 1432.º, n.º 4)";
  return renderPdf(
    [
      { type: "title", text: `Convocatória — Assembleia de condóminos ${KIND_PT[a.kind]}` },
      { type: "paragraph", text: `${a.condo_name} — NIF ${a.nif_condominio}${address ? ` — ${address}` : ""}` },
      {
        type: "paragraph",
        text: `Nos termos dos artigos 1431.º e 1432.º do Código Civil, convocam-se todos os condóminos para a assembleia ${KIND_PT[a.kind]}, a realizar no dia ${fmtDateTime(a.scheduled_at)}, em ${a.location}${a.online_url ? `, sendo admitida a participação por videoconferência através de ${a.online_url} (Lei n.º 8/2022)` : ""}, com a seguinte ordem de trabalhos:`,
      },
      ...items.map((i) => ({
        type: "paragraph" as const,
        text: `${i.position}. ${i.title}${i.majority !== "SIMPLE" ? ` (deliberação por ${MAJORITY_PT[i.majority]})` : ""}`,
      })),
      { type: "heading", text: "Segunda convocatória" },
      {
        type: "paragraph",
        text: `Não estando presentes ou representados condóminos que representem mais de metade do valor total do prédio, a assembleia reunirá em segunda convocatória ${second}, podendo deliberar por maioria de votos dos condóminos presentes, desde que estes representem pelo menos um quarto do valor total do prédio.`,
      },
      { type: "heading", text: "Representação" },
      {
        type: "paragraph",
        text: "Os condóminos podem fazer-se representar por procurador, mediante documento escrito assinado (art. 1431.º, n.º 3, do Código Civil), a entregar no início da reunião.",
      },
      { type: "spacer" },
      { type: "paragraph", text: `${a.city ?? ""}${a.city ? ", " : ""}${fmtDate(new Date())}` },
      { type: "signature", lines: ["A Administração do Condomínio"] },
    ],
    { title: "Convocatória", footer: a.condo_name },
  );
}

/**
 * Lei 8/2022 convocation engine: email (with recorded consent) or registered
 * mail via CTT. Refuses to send with less than 10 days' notice. Idempotent per
 * fraction: deliveries already SENT are skipped, FAILED ones are retried.
 */
export async function sendConvocations(assemblyId: string, now = new Date()) {
  const view = await getAssembly(assemblyId);
  if (!view) throw new AssemblyError("Assembleia não encontrada.");
  const a = view.assembly;
  if (a.status === "IN_PROGRESS" || a.status === "CLOSED") throw new AssemblyError("A assembleia já decorreu.");
  if (!hasMinimumNotice(a.scheduled_at, now)) {
    throw new AssemblyError(
      `Antecedência insuficiente: a convocatória tem de ser enviada com pelo menos ${MIN_NOTICE_DAYS} dias (até ${fmtDate(noticeDeadline(a.scheduled_at))}).`,
    );
  }

  const pdf = await convocationPdf(view);
  const owners = await sql<{ fraction_id: string; designation: string; resident_id: string | null; full_name: string | null; email: string | null; consent: boolean | null; already: string | null }[]>`
    select f.id fraction_id, f.designation, r.id resident_id, r.full_name, r.email, r.has_recorded_email_consent consent,
           (select status from convocations cv where cv.assembly_id = ${assemblyId} and cv.fraction_id = f.id) already
    from fractions f
    left join lateral (
      select id, full_name, email, has_recorded_email_consent from residents
      where fraction_id = f.id and role = 'Proprietário' order by created_at limit 1
    ) r on true
    where f.condominium_id = ${a.condominium_id}
    order by f.designation`;

  const address = [a.address, a.postal_code, a.city].filter(Boolean).join(", ");
  const result = { email: 0, registeredMail: 0, failed: 0, skipped: 0 };
  for (const o of owners) {
    if (o.already === "SENT") { result.skipped++; continue; }
    const byEmail = Boolean(o.email && o.consent);
    let status: "SENT" | "FAILED" = "SENT";
    let providerId: string | null = null;
    let error: string | null = null;
    try {
      if (byEmail) {
        const res = await sendEmail({
          to: o.email!,
          subject: `Convocatória: assembleia de condóminos — ${a.condo_name}`,
          html: `<p>Exmo(a). Sr(a). ${escapeHtml(o.full_name ?? "Condómino")},</p>
<p>Junto enviamos a convocatória para a assembleia ${KIND_PT[a.kind]} do ${escapeHtml(a.condo_name)}, a realizar a <strong>${escapeHtml(fmtDateTime(a.scheduled_at))}</strong> em ${escapeHtml(a.location)}.</p>
<p>Esta comunicação é feita por correio eletrónico ao abrigo do consentimento que nos prestou (art. 1432.º do Código Civil, na redação da Lei n.º 8/2022).</p>
<p>Com os melhores cumprimentos,<br/>A Administração</p>`,
          attachments: [{ filename: "convocatoria.pdf", content: Buffer.from(pdf) }],
        });
        providerId = res.id;
        result.email++;
      } else {
        const res = await sendRegisteredLetter({
          recipientName: o.full_name ?? `Proprietário da fração ${o.designation}`,
          address: `Fração ${o.designation}, ${address}`,
          pdf,
          withReceipt: true,
        });
        providerId = res.tracking;
        result.registeredMail++;
      }
    } catch (e) {
      status = "FAILED";
      error = (e as Error).message;
      result.failed++;
    }
    await sql`
      insert into convocations ${sql({
        assembly_id: assemblyId, fraction_id: o.fraction_id, resident_id: o.resident_id,
        channel: byEmail ? "EMAIL" : "REGISTERED_MAIL", status, provider_id: providerId, error,
        sent_at: status === "SENT" ? new Date() : null,
      })}
      on conflict (assembly_id, fraction_id) do update set
        channel = excluded.channel, status = excluded.status, provider_id = excluded.provider_id,
        error = excluded.error, sent_at = excluded.sent_at`;
  }
  await sql`update assemblies set status = 'CONVOKED' where id = ${assemblyId} and status = 'DRAFT'`;
  return result;
}

export async function listConvocations(assemblyId: string) {
  return sql<{ designation: string; full_name: string | null; channel: string; status: string; provider_id: string | null; error: string | null; sent_at: Date | null }[]>`
    select f.designation, r.full_name, cv.channel, cv.status, cv.provider_id, cv.error, cv.sent_at
    from convocations cv join fractions f on f.id = cv.fraction_id left join residents r on r.id = cv.resident_id
    where cv.assembly_id = ${assemblyId} order by f.designation`;
}

// ---------------------------------------------------------------------------
// Live session
// ---------------------------------------------------------------------------

async function assertLive(assemblyId: string) {
  const [a] = await sql<{ status: string }[]>`select status from assemblies where id = ${assemblyId}`;
  if (!a) throw new AssemblyError("Assembleia não encontrada.");
  if (a.status !== "IN_PROGRESS") throw new AssemblyError("A sessão não está a decorrer.");
}

export async function startSession(assemblyId: string, call: Call) {
  const [a] = await sql`
    update assemblies set status = 'IN_PROGRESS', session_call = ${call}, started_at = coalesce(started_at, now())
    where id = ${assemblyId} and status in ('DRAFT', 'CONVOKED', 'IN_PROGRESS') returning id`;
  if (!a) throw new AssemblyError("Não é possível iniciar esta assembleia.");
}

export async function setAttendance(
  assemblyId: string,
  fractionId: string,
  mode: "PRESENT" | "ONLINE" | "REPRESENTED" | null,
  representative: string | null,
) {
  await assertLive(assemblyId);
  if (!mode) {
    await sql`delete from assembly_attendance where assembly_id = ${assemblyId} and fraction_id = ${fractionId}`;
    return;
  }
  await sql`
    insert into assembly_attendance ${sql({ assembly_id: assemblyId, fraction_id: fractionId, mode, representative_name: representative })}
    on conflict (assembly_id, fraction_id) do update set mode = excluded.mode, representative_name = excluded.representative_name`;
}

async function itemAssembly(itemId: string) {
  const [i] = await sql<{ assembly_id: string; voting_status: string }[]>`
    select assembly_id, voting_status from assembly_agenda_items where id = ${itemId}`;
  if (!i) throw new AssemblyError("Ponto não encontrado.");
  await assertLive(i.assembly_id);
  return i;
}

export async function setVotingStatus(itemId: string, status: "OPEN" | "CLOSED" | "PENDING") {
  const i = await itemAssembly(itemId);
  if (status === "OPEN") {
    // one open item at a time keeps the room (and the projector) unambiguous
    await sql`update assembly_agenda_items set voting_status = 'PENDING' where assembly_id = ${i.assembly_id} and voting_status = 'OPEN'`;
  }
  await sql`update assembly_agenda_items set voting_status = ${status} where id = ${itemId}`;
  return i.assembly_id;
}

export async function castVote(itemId: string, fractionId: string, vote: VoteChoice | null) {
  const i = await itemAssembly(itemId);
  if (i.voting_status !== "OPEN") throw new AssemblyError("A votação deste ponto não está aberta.");
  const [present] = await sql`select 1 from assembly_attendance where assembly_id = ${i.assembly_id} and fraction_id = ${fractionId}`;
  if (!present) throw new AssemblyError("Só frações presentes ou representadas podem votar.");
  if (!vote) {
    await sql`delete from assembly_votes where agenda_item_id = ${itemId} and fraction_id = ${fractionId}`;
  } else {
    await sql`
      insert into assembly_votes ${sql({ agenda_item_id: itemId, fraction_id: fractionId, vote, cast_by: "ADMIN" })}
      on conflict (agenda_item_id, fraction_id) do update set vote = excluded.vote, cast_by = 'ADMIN', cast_at = now()`;
  }
  return i.assembly_id;
}

/** Record every present fraction's vote at once (e.g. "all in favour"). */
export async function castVoteForAllPresent(itemId: string, vote: VoteChoice) {
  const i = await itemAssembly(itemId);
  if (i.voting_status !== "OPEN") throw new AssemblyError("A votação deste ponto não está aberta.");
  await sql`
    insert into assembly_votes (agenda_item_id, fraction_id, vote)
    select ${itemId}, fraction_id, ${vote} from assembly_attendance where assembly_id = ${i.assembly_id}
    on conflict (agenda_item_id, fraction_id) do nothing`;
  return i.assembly_id;
}

export async function closeAssembly(assemblyId: string) {
  await assertLive(assemblyId);
  await sql`update assembly_agenda_items set voting_status = 'CLOSED' where assembly_id = ${assemblyId} and voting_status = 'OPEN'`;
  await sql`update assemblies set status = 'CLOSED', closed_at = now() where id = ${assemblyId}`;
}

export async function saveTranscript(assemblyId: string, transcript: string) {
  await sql`update assemblies set transcript = ${transcript} where id = ${assemblyId}`;
}

export async function appendTranscript(assemblyId: string, chunk: string) {
  await sql`
    update assemblies set transcript = case when coalesce(transcript, '') = '' then ${chunk} else transcript || E'\n\n' || ${chunk} end
    where id = ${assemblyId}`;
}

// ---------------------------------------------------------------------------
// Hybrid participation (Lei 8/2022): owners join online from the portal
// ---------------------------------------------------------------------------

export async function liveAssemblyForFraction(condominiumId: string, fractionId: string) {
  const [a] = await sql<{ id: string; online_url: string | null; session_call: number | null }[]>`
    select id, online_url, session_call from assemblies
    where condominium_id = ${condominiumId} and status = 'IN_PROGRESS' order by started_at desc limit 1`;
  if (!a) return null;
  const [[attendance], [item]] = await Promise.all([
    sql<{ mode: string }[]>`select mode from assembly_attendance where assembly_id = ${a.id} and fraction_id = ${fractionId}`,
    sql<{ id: string; position: number; title: string; vote: string | null }[]>`
      select i.id, i.position, i.title,
        (select vote from assembly_votes v where v.agenda_item_id = i.id and v.fraction_id = ${fractionId}) vote
      from assembly_agenda_items i where i.assembly_id = ${a.id} and i.voting_status = 'OPEN' limit 1`,
  ]);
  return {
    assemblyId: a.id,
    onlineUrl: a.online_url,
    remoteAllowed: Boolean(a.online_url),
    checkedIn: Boolean(attendance),
    mode: attendance?.mode ?? null,
    openItem: item ?? null,
  };
}

export async function checkInOnline(condominiumId: string, fractionId: string) {
  const live = await liveAssemblyForFraction(condominiumId, fractionId);
  if (!live) throw new AssemblyError("Não há nenhuma assembleia a decorrer.");
  if (!live.remoteAllowed) throw new AssemblyError("Esta assembleia não admite participação por videoconferência.");
  await sql`
    insert into assembly_attendance ${sql({ assembly_id: live.assemblyId, fraction_id: fractionId, mode: "ONLINE" })}
    on conflict (assembly_id, fraction_id) do nothing`;
}

export async function castOwnerVote(condominiumId: string, fractionId: string, itemId: string, vote: VoteChoice) {
  const live = await liveAssemblyForFraction(condominiumId, fractionId);
  if (!live?.checkedIn) throw new AssemblyError("Registe primeiro a sua presença.");
  if (live.openItem?.id !== itemId) throw new AssemblyError("A votação deste ponto não está aberta.");
  await sql`
    insert into assembly_votes ${sql({ agenda_item_id: itemId, fraction_id: fractionId, vote, cast_by: "OWNER" })}
    on conflict (agenda_item_id, fraction_id) do update set vote = excluded.vote, cast_by = 'OWNER', cast_at = now()`;
}
