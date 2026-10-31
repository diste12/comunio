import "server-only";
import { formatPermilagem } from "@/lib/assembly/rules";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { llm } from "@/lib/llm";
import { formatEur, toCents } from "@/lib/money";
import { fmtDate, fmtDateTime, fmtTime, renderPdf, type Block } from "@/lib/pdf/document";
import { getAssembly, MAJORITY_PT, type AssemblyView } from "./assemblies";

const KIND_PT = { ORDINARIA: "ordinária", EXTRAORDINARIA: "extraordinária" } as const;
const MODE_PT = { PRESENT: "presente", ONLINE: "por videoconferência", REPRESENTED: "representado" } as const;
const OUTCOME_PT = {
  APPROVED: "APROVADO",
  REJECTED: "REJEITADO",
  NO_QUORUM: "SEM QUÓRUM DELIBERATIVO",
  CONDITIONAL: "APROVADO SOB CONDIÇÃO (comunicação aos ausentes)",
} as const;

type Debt = { designation: string; ownerName: string | null; count: number; first: string; last: string; amountCents: number };

async function debtsAt(condominiumId: string, at: Date): Promise<Debt[]> {
  const rows = await sql<{ designation: string; owner_name: string | null; n: string; first_due: string; last_due: string; total: string }[]>`
    select f.designation,
      (select full_name from residents r where r.fraction_id = f.id and r.role = 'Proprietário' order by created_at limit 1) owner_name,
      count(*) n, to_char(min(q.due_date), 'YYYY-MM-DD') first_due, to_char(max(q.due_date), 'YYYY-MM-DD') last_due,
      sum(q.amount_total) total
    from quota_charges q join fractions f on f.id = q.fraction_id
    where q.condominium_id = ${condominiumId} and q.payment_status = 'PENDING' and q.due_date < ${at}::date
    group by f.id order by f.designation`;
  return rows.map((r) => ({
    designation: r.designation, ownerName: r.owner_name, count: Number(r.n),
    first: r.first_due, last: r.last_due, amountCents: toCents(r.total),
  }));
}

async function contributionsTable(condominiumId: string, at: Date) {
  const [budget] = await sql<{ id: string; fiscal_year: number; installments: number; due_day: number }[]>`
    select id, fiscal_year, installments, due_day from budgets
    where condominium_id = ${condominiumId} and fiscal_year >= extract(year from ${at}::date)
    order by fiscal_year limit 1`;
  if (!budget) return null;
  const rows = await sql<{ designation: string; annual: string; first_installment: string }[]>`
    select f.designation, sum(q.amount_total) annual,
      (array_agg(q.amount_total order by q.installment))[1] first_installment
    from quota_charges q join fractions f on f.id = q.fraction_id
    where q.budget_id = ${budget.id} group by f.designation order by f.designation`;
  return { budget, rows };
}

/** Ask the LLM for one formal discussion summary per agenda item. */
async function summarise(view: AssemblyView): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const i of view.items) if (i.notes) out.set(i.position, i.notes);
  const transcript = view.assembly.transcript?.trim();
  const client = llm();
  if (!client || !transcript) return out;

  const res = await client.chat.completions.create({
    model: env().OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "És secretário de assembleias de condóminos em Portugal. Redige, em português europeu formal e na terceira pessoa, " +
          "um resumo objetivo da discussão de cada ponto da ordem de trabalhos, com base apenas na transcrição. " +
          "Não inventes factos, nomes ou valores. Não indiques o resultado das votações (é acrescentado automaticamente). " +
          "Se um ponto não foi discutido na transcrição, escreve 'Não houve discussão relevante sobre este ponto.'",
      },
      {
        role: "user",
        content: `Ordem de trabalhos:\n${view.items.map((i) => `${i.position}. ${i.title}`).join("\n")}\n\nTranscrição:\n${transcript.slice(0, 120_000)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "resumos",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            pontos: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { ponto: { type: "integer" }, resumo: { type: "string" } },
                required: ["ponto", "resumo"],
              },
            },
          },
          required: ["pontos"],
        },
      },
    },
  });
  const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as { pontos?: { ponto: number; resumo: string }[] };
  for (const p of parsed.pontos ?? []) if (!out.has(p.ponto)) out.set(p.ponto, p.resumo.trim());
  return out;
}

/**
 * Build the ata text. Attendance, vote tallies and the per-fraction debt
 * declaration (título executivo, art. 6.º DL 268/94 as amended by Lei 8/2022)
 * are generated from data, never by the LLM.
 */
export async function generateMinutesText(assemblyId: string): Promise<{ body: string; usedLlm: boolean }> {
  const view = await getAssembly(assemblyId);
  if (!view) throw new Error("Assembleia não encontrada.");
  const { assembly: a, fractions, quorum, items, call } = view;
  const at = a.started_at ?? a.scheduled_at;
  const [summaries, debts, contributions, [{ n }]] = await Promise.all([
    summarise(view).catch((e) => {
      console.error("[minutes] LLM failed:", (e as Error).message);
      return new Map<number, string>();
    }),
    debtsAt(a.condominium_id, at),
    contributionsTable(a.condominium_id, at),
    sql<{ n: string }[]>`
      select count(*) n from minutes m join assemblies x on x.id = m.assembly_id
      where x.condominium_id = ${a.condominium_id} and m.status = 'APPROVED'`,
  ]);
  const usedLlm = Boolean(llm() && a.transcript);
  const address = [a.address, a.postal_code, a.city].filter(Boolean).join(", ");
  const present = fractions.filter((f) => f.attendance);
  const L: string[] = [];

  L.push(`# ATA N.º ${Number(n) + 1}`);
  L.push(`Assembleia ${KIND_PT[a.kind]} de condóminos — ${a.condo_name} (NIF ${a.nif_condominio})`);
  L.push("");
  L.push(
    `Aos ${fmtDateTime(at)}, reuniu em ${call}.ª convocatória a assembleia ${KIND_PT[a.kind]} de condóminos do prédio sito em ${address}, em ${a.location}${a.online_url ? ", com participação admitida por videoconferência (Lei n.º 8/2022)" : ""}, regularmente convocada nos termos dos artigos 1431.º e 1432.º do Código Civil, com a seguinte ordem de trabalhos:`,
  );
  for (const i of items) L.push(`${i.position}. ${i.title}`);
  L.push("");
  L.push("## Presenças");
  L.push(
    `Estiveram presentes ou representados ${present.length} de ${fractions.length} frações, correspondentes a ${formatPermilagem(quorum.presentHundredths)} do valor total do prédio (${(quorum.presentPct * 100).toFixed(2).replace(".", ",")}%), conforme lista seguinte:`,
  );
  for (const f of present) {
    const rep = f.attendance?.mode === "REPRESENTED" && f.attendance.representative ? `, por ${f.attendance.representative}` : "";
    L.push(`- Fração ${f.designation} — ${f.ownerName ?? "proprietário"} — ${f.permilagem.toFixed(2).replace(".", ",")}‰ — ${MODE_PT[f.attendance!.mode]}${rep}`);
  }
  L.push("");

  for (const i of items) {
    L.push(`## Ponto ${i.position} — ${i.title}`);
    L.push(summaries.get(i.position) ?? "[Resumo da discussão a completar.]");
    if (i.votingStatus === "PENDING" && i.votes.size === 0) {
      L.push("Ponto meramente informativo, não submetido a votação.");
    } else {
      const t = i.tally;
      const who = (v: string) =>
        fractions.filter((f) => i.votes.get(f.fractionId) === v).map((f) => f.designation).join(", ") || "nenhuma";
      L.push(
        `Submetido a votação (${MAJORITY_PT[i.majority]}): a favor ${formatPermilagem(t.favor)} (frações ${who("FAVOR")}); contra ${formatPermilagem(t.contra)} (frações ${who("CONTRA")}); abstenções ${formatPermilagem(t.abstencao)} (frações ${who("ABSTENCAO")}).`,
      );
      L.push(`Deliberação: ${OUTCOME_PT[t.outcome]}. ${t.basis}`);
    }
    L.push("");
  }

  if (contributions) {
    L.push(`## Contribuições devidas — orçamento de ${contributions.budget.fiscal_year}`);
    L.push(
      `Montante anual a pagar por cada condómino, em ${contributions.budget.installments} prestações com vencimento ao dia ${contributions.budget.due_day} de cada período, incluindo a contribuição para o fundo comum de reserva:`,
    );
    for (const r of contributions.rows) {
      L.push(`- Fração ${r.designation} — ${formatEur(toCents(r.annual))} por ano (prestação de ${formatEur(toCents(r.first_installment))})`);
    }
    L.push("");
  }

  L.push("## Dívidas dos condóminos");
  if (debts.length === 0) {
    L.push(`À data da reunião não existiam contribuições vencidas e não pagas.`);
  } else {
    L.push(`À data da reunião encontravam-se vencidas e não pagas as seguintes contribuições:`);
    for (const d of debts) {
      L.push(
        `- Fração ${d.designation} — ${d.ownerName ?? "proprietário"} — ${
          d.count === 1 ? `1 prestação vencida em ${fmtDate(d.first)}` : `${d.count} prestações vencidas entre ${fmtDate(d.first)} e ${fmtDate(d.last)}`
        } — total em dívida ${formatEur(d.amountCents)}`,
      );
    }
    L.push(
      `Total em dívida: ${formatEur(debts.reduce((s, d) => s + d.amountCents, 0))}. Nos termos do artigo 6.º do Decreto-Lei n.º 268/94, na redação da Lei n.º 8/2022, a presente ata constitui título executivo contra os proprietários que deixarem de pagar, no prazo estabelecido, a sua quota-parte nas despesas e no fundo comum de reserva, abrangendo os montantes acima discriminados, as contribuições que se vençam após a sua aprovação e os respetivos juros de mora.`,
    );
  }
  L.push("");
  L.push(
    `Nada mais havendo a tratar, foi encerrada a sessão${a.closed_at ? ` pelas ${fmtTime(a.closed_at)}` : ""}, da qual se lavrou a presente ata que, depois de lida e aprovada, vai ser assinada pelo presidente da mesa e pelo secretário, e será comunicada a todos os condóminos (art. 1432.º do Código Civil).`,
  );
  return { body: L.join("\n"), usedLlm };
}

export async function upsertDraftMinutes(assemblyId: string) {
  const { body, usedLlm } = await generateMinutesText(assemblyId);
  const [row] = await sql<{ status: string }[]>`select status from minutes where assembly_id = ${assemblyId}`;
  if (row?.status === "APPROVED") throw new Error("A ata já foi aprovada e assinada.");
  await sql`
    insert into minutes ${sql({ assembly_id: assemblyId, body, generated_by: usedLlm ? "LLM" : "TEMPLATE" })}
    on conflict (assembly_id) do update set body = excluded.body, generated_by = excluded.generated_by, updated_at = now()`;
}

export async function getMinutes(assemblyId: string) {
  const [m] = await sql<{ body: string; status: "DRAFT" | "APPROVED"; generated_by: string; approved_at: Date | null; approved_by: string | null; updated_at: Date }[]>`
    select body, status, generated_by, approved_at, approved_by, updated_at from minutes where assembly_id = ${assemblyId}`;
  return m ?? null;
}

export async function saveMinutes(assemblyId: string, body: string) {
  const [m] = await sql`
    update minutes set body = ${body}, updated_at = now()
    where assembly_id = ${assemblyId} and status = 'DRAFT' returning id`;
  if (!m) throw new Error("Só é possível editar atas em rascunho.");
}

/** Human in the loop: the administrator signs off the final minutes. */
export async function approveMinutes(assemblyId: string, approvedBy: string) {
  const [m] = await sql`
    update minutes set status = 'APPROVED', approved_at = now(), approved_by = ${approvedBy}
    where assembly_id = ${assemblyId} and status = 'DRAFT' returning id`;
  if (!m) throw new Error("Ata inexistente ou já aprovada.");
}

/** Render the minutes text (markdown-lite) to PDF. */
export async function minutesPdf(assemblyId: string): Promise<{ pdf: Uint8Array; condoName: string } | null> {
  const m = await getMinutes(assemblyId);
  const [a] = await sql<{ name: string }[]>`select c.name from assemblies a join condominiums c on c.id = a.condominium_id where a.id = ${assemblyId}`;
  if (!m || !a) return null;
  const blocks: Block[] = m.body.split("\n").map((line): Block => {
    if (line.startsWith("# ")) return { type: "title", text: line.slice(2) };
    if (line.startsWith("## ")) return { type: "heading", text: line.slice(3) };
    if (line.trim() === "") return { type: "spacer", size: 4 };
    if (line.startsWith("- ")) return { type: "paragraph", text: `• ${line.slice(2)}` };
    return { type: "paragraph", text: line };
  });
  blocks.push({ type: "signature", lines: ["O Presidente da Mesa", "O Secretário"] });
  if (m.status === "DRAFT") blocks.unshift({ type: "small", text: "RASCUNHO — documento não aprovado" });
  else blocks.push({ type: "small", text: `Aprovada por ${m.approved_by} em ${fmtDateTime(m.approved_at!)}.` });
  return { pdf: await renderPdf(blocks, { title: "Ata", footer: a.name }), condoName: a.name };
}
