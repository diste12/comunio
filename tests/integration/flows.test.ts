/**
 * End-to-end service flows against a real Postgres (mock providers):
 * onboarding → quotas → references → payment webhook → receipt → bank
 * reconciliation → WhatsApp triage → assembly with online vote → minutes →
 * 3-quote RFP → invoice approval → pre-litigation letter.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { isoDateFromNow } from "@/lib/dates";
import { parseOnboardingCsv } from "@/lib/onboarding/csv";
import { orderIdFor } from "@/lib/payments";
import { createCondominium, DuplicateCondominiumNifError } from "@/lib/services/onboarding";
import { generateQuotas } from "@/lib/services/quotas";
import { issueMultibancoReferences } from "@/lib/services/references";
import { applyPayment, issueReceiptForCharge } from "@/lib/services/reconcile";
import { importTransactions, reconcileCondominium } from "@/lib/services/bank";
import { handleInboundWhatsApp } from "@/lib/triage/agent";
import {
  castOwnerVote, checkInOnline, closeAssembly, createAssembly, getAssembly, sendConvocations, setAttendance, setVotingStatus, startSession,
} from "@/lib/services/assemblies";
import { approveMinutes, generateMinutesText, upsertDraftMinutes } from "@/lib/services/minutes";
import { awardQuote, createVendor, decideInvoice, requestQuotes, rfpsForTicket, simulateVendorQuotes, submitInvoice } from "@/lib/services/rfps";
import { createTicket } from "@/lib/services/residents";
import { sendPreLitigationLetter } from "@/lib/services/collections";

const CSV = [
  "fracao;permilagem;proprietario;telefone;email;nif;consentimento_email;inquilino;telefone_inquilino",
  "1A;400;Maria Silva;912000001;maria@example.pt;123456789;sim;;",
  "1B;350;Joao Santos;912000002;;;nao;Ana Costa;912000004",
  "2A;250;Rui Ferreira;912000003;rui@example.pt;;sim;;",
].join("\n");

const year = new Date().getFullYear();
let condoId = "";
const fraction: Record<string, string> = {};

afterAll(async () => {
  await sql.end();
});

describe("ledger", () => {
  it("stores test NIF 55555 without relaxing other shape or uniqueness checks", async () => {
    const parsed = parseOnboardingCsv("fracao;permilagem;proprietario;telefone;nif\nA;1000;Teste;919999999;55555");
    expect(parsed.errors).toEqual([]);
    const input = { name: "Test NIF fixture", nif: "55555", address: null, postalCode: null, city: null, iban: null };
    const { id } = await createCondominium(input, parsed.fractions);
    const [stored] = await sql`
      select c.nif_condominio, r.nif from condominiums c
      join fractions f on f.condominium_id = c.id
      join residents r on r.fraction_id = f.id where c.id = ${id}`;
    expect(stored).toEqual({ nif_condominio: "55555", nif: "55555" });
    await expect(createCondominium(input, parsed.fractions)).rejects.toBeInstanceOf(DuplicateCondominiumNifError);
    await expect(sql`insert into condominiums (name, nif_condominio) values ('Bad NIF', '55554')`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`update residents set nif = '55554' where nif = '55555'`).rejects.toMatchObject({ code: "23514" });
  });

  it("onboards a condominium from CSV", async () => {
    const parsed = parseOnboardingCsv(CSV);
    expect(parsed.errors).toEqual([]);
    const r = await createCondominium({ name: "Condomínio Teste", nif: "901000005", address: "Rua Teste, 1", postalCode: "1000-001", city: "Lisboa", iban: null }, parsed.fractions);
    condoId = r.id;
    expect(r).toMatchObject({ fractions: 3, residents: 4 });
    for (const f of await sql<{ id: string; designation: string }[]>`select id, designation from fractions where condominium_id = ${condoId}`) fraction[f.designation] = f.id;
  });

  it("generates the year's quotas once, reconciling to the cent", async () => {
    await generateQuotas(condoId, { fiscalYear: year, ordinaryAmountCents: 1_200_000 });
    const [t] = await sql<{ n: string; total: string }[]>`select count(*) n, sum(amount_total) total from quota_charges where condominium_id = ${condoId}`;
    expect(Number(t.n)).toBe(36);
    expect(t.total).toBe("13200.00"); // 12 000 € + 10% reserve
    await expect(generateQuotas(condoId, { fiscalYear: year, ordinaryAmountCents: 1_000 })).rejects.toThrow(/already generated/);
  });

  it("issues references and applies a payment idempotently, then the receipt", async () => {
    const r = await issueMultibancoReferences(condoId, 400);
    expect(r.errors).toEqual([]);
    const [c] = await sql<{ id: string; order_seq: string; amount_total: string; mb_entity: string; mb_reference: string }[]>`
      select id, order_seq, amount_total, mb_entity, mb_reference from quota_charges where fraction_id = ${fraction["1A"]} order by due_date limit 1`;
    const n = {
      provider: "ifthenpay" as const, orderId: null, entity: c.mb_entity, reference: c.mb_reference, requestId: "req-1",
      amountCents: Math.round(Number(c.amount_total) * 100), method: "MULTIBANCO" as const, paidAt: new Date(), raw: {},
    };
    expect((await applyPayment(n)).outcome).toBe("APPLIED");
    expect((await applyPayment(n)).outcome).toBe("DUPLICATE");
    expect((await applyPayment({ ...n, requestId: "req-2" })).outcome).toBe("ALREADY_PAID");
    await issueReceiptForCharge(c.id);
    const [after] = await sql<{ payment_status: string; moloni_document_id: string }[]>`select payment_status, moloni_document_id from quota_charges where id = ${c.id}`;
    expect(after).toEqual({ payment_status: "PAID", moloni_document_id: `mock-${orderIdFor(c.order_seq)}` });
  });

  it("reconciles bank transfers: designation auto-matched, amount-only suggested", async () => {
    const pending = await sql<{ amount_total: string }[]>`
      select amount_total from quota_charges where fraction_id = ${fraction["1B"]} and payment_status = 'PENDING' order by due_date limit 2`;
    const two = Math.round((Number(pending[0].amount_total) + Number(pending[1].amount_total)) * 100);
    const [rui] = await sql<{ amount_total: string }[]>`
      select amount_total from quota_charges where fraction_id = ${fraction["2A"]} and payment_status = 'PENDING' order by due_date limit 1`;
    await importTransactions(condoId, "CSV", [
      { externalId: "t1", bookedOn: isoDateFromNow(0), description: "QUOTAS FRACAO 1B", amountCents: two, counterpartyName: null },
      { externalId: "t2", bookedOn: isoDateFromNow(0), description: "TRF", amountCents: Math.round(Number(rui.amount_total) * 100), counterpartyName: null },
      { externalId: "t3", bookedOn: isoDateFromNow(0), description: "SEGURO", amountCents: 999, counterpartyName: null },
    ]);
    const r = await reconcileCondominium(condoId);
    expect(r).toEqual({ auto: 1, suggested: 1, unmatched: 1 });
    const [{ paid }] = await sql<{ paid: string }[]>`select count(*) paid from quota_charges where fraction_id = ${fraction["1B"]} and paid_method = 'TRANSFER'`;
    expect(Number(paid)).toBe(2);
  });
});

describe("whatsapp triage (rules)", () => {
  it("answers billing with references, opens tickets, ignores replays, protects tenants", async () => {
    const billing = await handleInboundWhatsApp({ from: "351912000001", id: "w1", text: "Quanto devo?" });
    expect(billing?.text).toMatch(/Entidade 99999/);
    expect(await handleInboundWhatsApp({ from: "351912000001", id: "w1", text: "Quanto devo?" })).toBeNull();
    const ticket = await handleInboundWhatsApp({ from: "351912000001", id: "w2", text: "O elevador está parado" });
    expect(ticket?.intent).toBe("MAINTENANCE");
    const tenant = await handleInboundWhatsApp({ from: "351912000004", id: "w3", text: "Quanto devo de quotas?" });
    expect(tenant?.text).toMatch(/Sem acesso/);
    const unknown = await handleInboundWhatsApp({ from: "351999999999", id: "w4", text: "Olá" });
    expect(unknown?.text).toMatch(/Não encontrámos/);
  });
});

describe("assembly", () => {
  let assemblyId = "";
  it("enforces 10 days' notice, convokes by email or CTT", async () => {
    const soon = await createAssembly({
      condominiumId: condoId, kind: "EXTRAORDINARIA", scheduledAt: new Date(Date.now() + 5 * 86_400_000), secondCallAt: null,
      location: "Hall", onlineUrl: null, agenda: [{ title: "Pintura", majority: "SIMPLE" }],
    });
    await expect(sendConvocations(soon)).rejects.toThrow(/Antecedência/);

    assemblyId = await createAssembly({
      condominiumId: condoId, kind: "ORDINARIA", scheduledAt: new Date(Date.now() + 15 * 86_400_000), secondCallAt: null,
      location: "Hall", onlineUrl: "https://meet.example/x",
      agenda: [{ title: "Contas", majority: "SIMPLE" }, { title: "Elevador novo", majority: "TWO_THIRDS" }],
    });
    expect(await sendConvocations(assemblyId)).toEqual({ email: 2, registeredMail: 1, failed: 0, skipped: 0 });
    expect((await sendConvocations(assemblyId)).skipped).toBe(3);
  });

  it("runs a hybrid session with weighted votes and generates the ata", async () => {
    await startSession(assemblyId, 1);
    await setAttendance(assemblyId, fraction["1A"], "PRESENT", null);
    await checkInOnline(condoId, fraction["2A"]); // owner joins from the portal
    const view0 = (await getAssembly(assemblyId))!;
    expect(view0.quorum.presentHundredths).toBe(65_000);
    const [contas, elevador] = view0.items;

    await setVotingStatus(contas.id, "OPEN");
    await expect(castOwnerVote(condoId, fraction["1B"], contas.id, "FAVOR")).rejects.toThrow(/presença/);
    await castOwnerVote(condoId, fraction["2A"], contas.id, "FAVOR");
    await sql`insert into assembly_votes (agenda_item_id, fraction_id, vote) values (${contas.id}, ${fraction["1A"]}, 'FAVOR')`;
    await setVotingStatus(contas.id, "CLOSED");
    await setVotingStatus(elevador.id, "OPEN");
    await castOwnerVote(condoId, fraction["2A"], elevador.id, "FAVOR");
    await sql`insert into assembly_votes (agenda_item_id, fraction_id, vote) values (${elevador.id}, ${fraction["1A"]}, 'FAVOR')`;

    const view = (await getAssembly(assemblyId))!;
    expect(view.items[0].tally.outcome).toBe("APPROVED"); // 650‰ > 500‰
    expect(view.items[1].tally.outcome).toBe("REJECTED"); // 650‰ < 2/3
    await closeAssembly(assemblyId);

    const { body } = await generateMinutesText(assemblyId);
    expect(body).toContain("Fração 2A — Rui Ferreira — 250,00‰ — por videoconferência");
    expect(body).toContain("Deliberação: APROVADO");
    expect(body).toContain("Dívidas dos condóminos");
    await upsertDraftMinutes(assemblyId);
    await approveMinutes(assemblyId, "admin@test");
    await expect(upsertDraftMinutes(assemblyId)).rejects.toThrow(/aprovada/);
  });
});

describe("contractor quotes", () => {
  it("requests 3 quotes, awards, and approves the vendor invoice", async () => {
    for (const name of ["Elevadores A", "Elevadores B", "Elevadores C"]) {
      await createVendor({ name, nif: null, email: `${name.at(-1)}@v.pt`, phone: null, categories: ["Elevador"] });
    }
    const t = await createTicket({ residentId: null, condominiumId: condoId, fractionId: null, category: "Elevador", description: "Elevador parado", priority: "HIGH", source: "ADMIN" });
    const { rfpId, links } = await requestQuotes(t.id, { scope: "Reparar elevador", deadline: isoDateFromNow(7) });
    expect(links).toHaveLength(3);
    await expect(requestQuotes(t.id, { scope: "x".repeat(20), deadline: isoDateFromNow(7) })).rejects.toThrow(/em curso/);
    expect(await simulateVendorQuotes(rfpId)).toBe(3);

    const [rfp] = await rfpsForTicket(t.id);
    const cheapest = rfp.quotes.map((q) => q.quote!).sort((a, b) => a.amountCents - b.amountCents)[0];
    await awardQuote(rfpId, cheapest.id);
    const winnerToken = rfp.quotes.find((q) => q.quote!.id === cheapest.id)!.link.split("/").pop()!;
    const loserToken = rfp.quotes.find((q) => q.quote!.id !== cheapest.id)!.link.split("/").pop()!;
    await expect(submitInvoice(loserToken, { number: "X1", amountCents: 100 })).rejects.toThrow(/adjudicado/);
    await submitInvoice(winnerToken, { number: "FT 1", amountCents: cheapest.amountCents, file: { name: "ft.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4") } });
    const [after] = await rfpsForTicket(t.id);
    expect(after.invoices[0]).toMatchObject({ invoice_number: "FT 1", has_file: true, status: "PENDING_APPROVAL" });
    await decideInvoice(after.invoices[0].id, true, "admin@test");
    await expect(decideInvoice(after.invoices[0].id, true, "admin@test")).rejects.toThrow(/decidida/);
  });
});

describe("collections", () => {
  it("sends one CTT letter per 30 days", async () => {
    await sql`update quota_charges set due_date = current_date - 10 where fraction_id = ${fraction["2A"]} and payment_status = 'PENDING'`;
    const tracking = await sendPreLitigationLetter(fraction["2A"], "admin@test");
    expect(tracking).toMatch(/^RR\d{9}PT$/);
    await expect(sendPreLitigationLetter(fraction["2A"], "admin@test")).rejects.toThrow(/30 dias/);
  });
});
