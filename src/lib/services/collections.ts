import "server-only";
import { sql } from "@/lib/db";
import { centsToDecimal, formatEur, toCents } from "@/lib/money";
import { sendRegisteredLetter } from "@/lib/messaging/ctt";
import { fmtDate, renderPdf } from "@/lib/pdf/document";

export const MIN_OVERDUE_INSTALLMENTS = 3;
const LETTER_COOLDOWN_DAYS = 30;

export type Debtor = {
  fractionId: string;
  designation: string;
  condominiumId: string;
  condominium: string;
  ownerName: string | null;
  overdueCount: number;
  overdueCents: number;
  oldestDue: string;
  lastLetterAt: Date | null;
  lastTracking: string | null;
};

export async function listDebtors(minCount = MIN_OVERDUE_INSTALLMENTS): Promise<Debtor[]> {
  const rows = await sql<
    { fraction_id: string; designation: string; condominium_id: string; condo: string; owner_name: string | null;
      n: string; total: string; oldest: string; last_letter: Date | null; tracking: string | null }[]
  >`
    select f.id fraction_id, f.designation, c.id condominium_id, c.name condo,
      (select full_name from residents r where r.fraction_id = f.id and r.role = 'Proprietário' order by created_at limit 1) owner_name,
      count(*) n, sum(q.amount_total) total, to_char(min(q.due_date), 'YYYY-MM-DD') oldest,
      l.sent_at last_letter, l.ctt_tracking tracking
    from quota_charges q
    join fractions f on f.id = q.fraction_id join condominiums c on c.id = f.condominium_id
    left join lateral (select sent_at, ctt_tracking from legal_letters where fraction_id = f.id order by sent_at desc limit 1) l on true
    where q.payment_status = 'PENDING' and q.due_date < current_date
    group by f.id, c.id, l.sent_at, l.ctt_tracking
    having count(*) >= ${minCount}
    order by sum(q.amount_total) desc`;
  return rows.map((r) => ({
    fractionId: r.fraction_id, designation: r.designation, condominiumId: r.condominium_id, condominium: r.condo,
    ownerName: r.owner_name, overdueCount: Number(r.n), overdueCents: toCents(r.total), oldestDue: r.oldest,
    lastLetterAt: r.last_letter, lastTracking: r.tracking,
  }));
}

async function letterData(fractionId: string) {
  const [f] = await sql<{ designation: string; condo: string; nif: string; address: string | null; postal_code: string | null; city: string | null; owner_name: string | null; owner_nif: string | null }[]>`
    select f.designation, c.name condo, c.nif_condominio nif, c.address, c.postal_code, c.city,
      r.full_name owner_name, r.nif owner_nif
    from fractions f join condominiums c on c.id = f.condominium_id
    left join lateral (select full_name, nif from residents where fraction_id = f.id and role = 'Proprietário' order by created_at limit 1) r on true
    where f.id = ${fractionId}`;
  if (!f) return null;
  const charges = await sql<{ description: string; due_date: string; amount_total: string }[]>`
    select description, to_char(due_date, 'YYYY-MM-DD') due_date, amount_total from quota_charges
    where fraction_id = ${fractionId} and payment_status = 'PENDING' and due_date < current_date order by due_date`;
  return { f, charges, totalCents: charges.reduce((s, c) => s + toCents(c.amount_total), 0) };
}

export async function preLitigationLetterPdf(fractionId: string): Promise<Uint8Array | null> {
  const d = await letterData(fractionId);
  if (!d) return null;
  const { f, charges, totalCents } = d;
  const address = [f.address, [f.postal_code, f.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return renderPdf(
    [
      { type: "paragraph", text: `${f.condo}\nNIF ${f.nif}\n${address}` },
      { type: "spacer" },
      { type: "paragraph", text: `Exmo(a). Sr(a).\n${f.owner_name ?? "Proprietário(a)"}${f.owner_nif ? ` (NIF ${f.owner_nif})` : ""}\nFração ${f.designation} — ${address}` },
      { type: "spacer" },
      { type: "paragraph", text: `${f.city ?? ""}${f.city ? ", " : ""}${fmtDate(new Date())}`, bold: false },
      { type: "paragraph", text: "Assunto: Interpelação para pagamento de contribuições em dívida — carta registada com aviso de receção", bold: true },
      {
        type: "paragraph",
        text: `Na qualidade de administração do condomínio, e não obstante os avisos anteriores, verificamos que se encontram vencidas e não pagas as seguintes contribuições relativas à fração ${f.designation}:`,
      },
      {
        type: "table",
        columns: [{ label: "Descrição", width: 0.6 }, { label: "Vencimento", width: 0.2 }, { label: "Valor", width: 0.2, align: "right" }],
        rows: [
          ...charges.map((c) => [c.description, fmtDate(c.due_date), formatEur(toCents(c.amount_total))]),
          ["Total em dívida", "", formatEur(totalCents)],
        ],
      },
      {
        type: "paragraph",
        text: "Fica V. Exa. interpelado(a) para, no prazo de 15 dias a contar da receção desta carta, proceder ao pagamento do valor em dívida, acrescido dos juros de mora legais, através das referências Multibanco disponíveis no portal do condómino ou por transferência para o IBAN do condomínio.",
      },
      {
        type: "paragraph",
        text: "Findo esse prazo sem que o pagamento seja efetuado, a administração dará início à cobrança judicial, servindo de título executivo a ata da assembleia de condóminos que deliberou o montante das contribuições (art. 6.º do Decreto-Lei n.º 268/94, na redação da Lei n.º 8/2022), com os inerentes custos e encargos a suportar por V. Exa.",
      },
      { type: "paragraph", text: "Caso já tenha efetuado o pagamento, queira por favor desconsiderar esta comunicação." },
      { type: "signature", lines: ["A Administração do Condomínio"] },
    ],
    { title: "Interpelação para pagamento", footer: f.condo },
  );
}

/** Human in the loop: dispatch the registered letter after the admin's click. */
export async function sendPreLitigationLetter(fractionId: string, approvedBy: string) {
  const [recent] = await sql`
    select 1 from legal_letters where fraction_id = ${fractionId} and sent_at > now() - make_interval(days => ${LETTER_COOLDOWN_DAYS})`;
  if (recent) throw new Error(`Já foi enviada uma carta nos últimos ${LETTER_COOLDOWN_DAYS} dias.`);
  const d = await letterData(fractionId);
  if (!d || d.charges.length === 0) throw new Error("Sem dívida vencida.");
  const pdf = (await preLitigationLetterPdf(fractionId))!;
  const [c] = await sql<{ condominium_id: string }[]>`select condominium_id from fractions where id = ${fractionId}`;
  const res = await sendRegisteredLetter({
    recipientName: d.f.owner_name ?? `Proprietário da fração ${d.f.designation}`,
    address: [d.f.address, d.f.postal_code, d.f.city].filter(Boolean).join(", "),
    pdf,
    withReceipt: true,
  });
  await sql`
    insert into legal_letters ${sql({
      condominium_id: c.condominium_id, fraction_id: fractionId, amount_due: centsToDecimal(d.totalCents),
      ctt_tracking: res.tracking, approved_by: approvedBy,
    })}`;
  return res.tracking;
}
