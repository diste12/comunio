/**
 * Demo data: 200 condominiums / ~4,000 fractions with owners, tenants, a 2026
 * budget with generated quotas, realistic payment history and a few tickets.
 * Usage: pnpm db:seed  (wipes existing data first — dev only)
 */
import postgres from "postgres";
import { apportion, buildQuotaPlan } from "../src/lib/quotas/engine";
import { centsToDecimal } from "../src/lib/money";
import { nifCheckDigit } from "../src/lib/pt/nif";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });

// Deterministic PRNG so every developer gets the same dataset.
let state = 20261031;
const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const STREETS = ["Rua Augusta", "Avenida da Liberdade", "Rua de Santa Catarina", "Avenida da Boavista", "Rua do Ouro",
  "Rua Ferreira Borges", "Avenida de Roma", "Rua Gonçalo Cristóvão", "Avenida dos Aliados", "Rua da Prata",
  "Rua Cândido dos Reis", "Avenida Fontes Pereira de Melo", "Rua de Cedofeita", "Rua Morais Soares", "Rua do Almada"];
const CITIES = [["Lisboa", "1000"], ["Porto", "4000"], ["Braga", "4700"], ["Coimbra", "3000"], ["Setúbal", "2900"],
  ["Almada", "2800"], ["Matosinhos", "4450"], ["Amadora", "2700"], ["Cascais", "2750"], ["Aveiro", "3800"]];
const FIRST = ["Maria", "João", "Ana", "José", "Francisco", "Inês", "Rita", "Pedro", "Tiago", "Sofia", "Miguel",
  "Beatriz", "Rui", "Carla", "Luís", "Marta", "Nuno", "Catarina", "Paulo", "Joana"];
const LAST = ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Jesus",
  "Sousa", "Fernandes", "Gonçalves", "Gomes", "Lopes", "Marques", "Alves", "Almeida", "Ribeiro", "Pinto", "Carvalho"];
const TICKETS: [string, string][] = [
  ["Elevador", "Elevador parado no 3.º andar"],
  ["Canalização", "Infiltração no teto da garagem"],
  ["Iluminação", "Lâmpadas fundidas na escada"],
  ["Limpeza", "Contentor do lixo partido"],
  ["Portão/Portas", "Portão da garagem não abre com o comando"],
];

const usedNifs = new Set<string>();
function nif(prefix: string): string {
  const first8 = prefix + String(int(0, 10 ** (8 - prefix.length) - 1)).padStart(8 - prefix.length, "0");
  const value = first8 + nifCheckDigit(first8);
  if (usedNifs.has(value)) return nif(prefix);
  usedNifs.add(value);
  return value;
}
const name = () => `${pick(FIRST)} ${pick(LAST)} ${pick(LAST)}`;
const phone = () => `3519${pick(["1", "2", "3", "6"])}${String(int(0, 9_999_999)).padStart(7, "0")}`;

const FISCAL_YEAR = 2026;
const today = new Date().toISOString().slice(0, 10);

async function main() {
  await sql`truncate condominiums, payment_events, vendors, whatsapp_messages cascade`;

  const VENDORS: [string, string[]][] = [
    ["Elevadores Atlântico, Lda.", ["Elevador"]],
    ["Lift Norte Manutenção", ["Elevador"]],
    ["Ascensores Tejo", ["Elevador"]],
    ["Canalizações Ribeiro & Filhos", ["Canalização"]],
    ["HidroFix Reparações", ["Canalização", "Estrutura/Fachada"]],
    ["AquaServiços Porto", ["Canalização"]],
    ["Eletro Lumen, Lda.", ["Eletricidade", "Iluminação"]],
    ["Voltagem Certa", ["Eletricidade", "Iluminação"]],
    ["Portões & Automatismos Silva", ["Portão/Portas", "Segurança"]],
    ["Limpezas Brilho Total", ["Limpeza"]],
    ["Fachadas Renova", ["Estrutura/Fachada"]],
    ["Multiserviços Condomínio+", []],
  ];
  await sql`insert into vendors ${sql(
    VENDORS.map(([vname, categories], k) => ({
      name: vname, nif: nif("5"), email: `orcamentos${k + 1}@fornecedor.example.pt`, phone_number: phone(), categories,
    })),
  )}`;

  for (let i = 0; i < 200; i++) {
    const [city, cp] = pick(CITIES);
    const street = pick(STREETS);
    const number = int(1, 400);
    const [condo] = await sql<{ id: string }[]>`
      insert into condominiums ${sql({
        nif_condominio: nif("901"),
        name: `Condomínio ${street}, ${number}`,
        address: `${street}, ${number}`,
        postal_code: `${cp}-${String(int(1, 999)).padStart(3, "0")}`,
        city,
        bank_iban_current: `PT50${String(int(0, 10 ** 9)).padStart(10, "0")}${String(int(0, 10 ** 9)).padStart(11, "0")}`,
      })} returning id`;

    // Fractions: floors × units per floor, plus a couple of shops; permilagem sums to exactly 1000.00
    const floors = int(3, 9);
    const perFloor = int(2, 4);
    const designations: string[] = ["LJ1"];
    if (rand() < 0.5) designations.push("LJ2");
    for (let f = 1; f <= floors; f++) for (let u = 0; u < perFloor; u++) designations.push(`${f}${"ABCD"[u]}`);
    const weights = designations.map((d) => BigInt(d.startsWith("LJ") ? int(80, 140) : int(35, 60)));
    const hundredths = apportion(100_000, weights);
    const fractions = await sql<{ id: string; designation: string; permilagem: string }[]>`
      insert into fractions ${sql(
        designations.map((d, k) => ({ condominium_id: condo.id, designation: d, permilagem: centsToDecimal(hundredths[k]) })),
      )} returning id, designation, permilagem`;

    const residents = fractions.flatMap((f) => {
      const owner = name();
      const rows = [{
        fraction_id: f.id, full_name: owner, phone_number: phone(),
        email: `${owner.split(" ")[0].toLowerCase()}.${f.designation.toLowerCase()}@example.pt`,
        nif: nif(pick(["1", "2"])), role: "Proprietário", has_recorded_email_consent: rand() < 0.6,
      }];
      if (rand() < 0.3) rows.push({
        fraction_id: f.id, full_name: name(), phone_number: phone(), email: null as unknown as string,
        nif: null as unknown as string, role: "Inquilino", has_recorded_email_consent: false,
      });
      return rows;
    });
    await sql`insert into residents ${sql(residents)}`;

    // Budget ≈ €450–€900 per fraction per year
    const budgetCents = Math.round((fractions.length * int(450, 900)) / 10) * 1000;
    const plan = buildQuotaPlan(
      fractions.map((f) => ({ id: f.id, designation: f.designation, permilagem: Number(f.permilagem) })),
      { fiscalYear: FISCAL_YEAR, ordinaryAmountCents: budgetCents },
    );
    const [budget] = await sql<{ id: string }[]>`
      insert into budgets ${sql({
        condominium_id: condo.id, fiscal_year: FISCAL_YEAR,
        ordinary_amount: centsToDecimal(plan.totals.ordinaryCents), reserve_fund_pct: "10",
        installments: 12, due_day: 8, reserve_amount: centsToDecimal(plan.totals.reserveCents),
      })} returning id`;

    // Some fractions are chronic late payers
    const lateRisk = new Map(fractions.map((f) => [f.id, rand() < 0.12 ? 0.55 : 0.03]));
    const rows = plan.charges.map((c) => {
      const due = c.dueDate <= today;
      const paid = due && rand() > lateRisk.get(c.fractionId)!;
      const paidAt = paid ? new Date(`${c.dueDate}T10:00:00Z`).getTime() + int(-6, 12) * 86_400_000 : null;
      return {
        fraction_id: c.fractionId, condominium_id: condo.id, budget_id: budget.id, installment: c.installment,
        description: c.description, due_date: c.dueDate,
        amount_ordinary: centsToDecimal(c.amountOrdinaryCents), amount_reserve: centsToDecimal(c.amountReserveCents),
        amount_total: centsToDecimal(c.amountTotalCents),
        payment_status: paid ? "PAID" : "PENDING",
        paid_at: paidAt ? new Date(Math.min(paidAt, Date.now())) : null,
        paid_method: paid ? (rand() < 0.6 ? "MBWAY" : "MULTIBANCO") : null,
        moloni_document_id: paid ? `seed-${condo.id.slice(0, 8)}-${c.fractionId.slice(0, 8)}-${c.installment}` : null,
      };
    });
    for (let k = 0; k < rows.length; k += 1000) await sql`insert into quota_charges ${sql(rows.slice(k, k + 1000))}`;

    if (rand() < 0.35) {
      const [category, description] = pick(TICKETS);
      await sql`insert into maintenance_tickets ${sql({
        condominium_id: condo.id, category, description, source: pick(["WHATSAPP", "PORTAL", "ADMIN"]),
        priority: category === "Elevador" ? "HIGH" : "NORMAL",
      })}`;
    }
    if ((i + 1) % 50 === 0) console.log(`seeded ${i + 1} condominiums`);
  }
  const [{ count }] = await sql<{ count: string }[]>`select count(*) from fractions`;
  console.log(`done: 200 condominiums, ${count} fractions`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
