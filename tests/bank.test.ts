import { describe, expect, it } from "vitest";
import { parseStatementCsv } from "@/lib/bank/csv";
import { matchTransfer, namesMatch, type FractionCandidate } from "@/lib/bank/matcher";

const charges = (prefix: string, seq: number, amounts: number[]) =>
  amounts.map((a, i) => ({ id: `${prefix}${i}`, orderSeq: String(seq + i), amountCents: a, dueDate: `2026-0${i + 1}-08` }));

const fractions: FractionCandidate[] = [
  { fractionId: "f1", designation: "1A", ownerNames: ["Maria João Silva Santos"], pending: charges("a", 100, [5000, 5000, 5000]) },
  { fractionId: "f2", designation: "2B", ownerNames: ["José Pereira"], pending: charges("b", 200, [7500, 7500]) },
  { fractionId: "f3", designation: "3C", ownerNames: ["Rui Costa"], pending: charges("c", 300, [5000]) },
];

describe("matchTransfer", () => {
  it("matches explicit order references", () => {
    const m = matchTransfer({ amountCents: 7500, description: "TRF Q201 condominio", counterpartyName: null }, fractions);
    expect(m).toMatchObject({ fractionId: "f2", chargeIds: ["b1"], confidence: "HIGH" });
  });
  it("matches by designation and covers several months at once", () => {
    const m = matchTransfer({ amountCents: 10000, description: "Quotas fracao 1A jan fev", counterpartyName: null }, fractions);
    expect(m).toMatchObject({ fractionId: "f1", chargeIds: ["a0", "a1"], confidence: "HIGH" });
  });
  it("matches by payer name when the amount is ambiguous", () => {
    const m = matchTransfer({ amountCents: 5000, description: "TRF", counterpartyName: "RUI M COSTA" }, fractions);
    expect(m).toMatchObject({ fractionId: "f3", confidence: "HIGH" });
  });
  it("only suggests when the amount alone is unique", () => {
    const m = matchTransfer({ amountCents: 10000, description: "pagamento", counterpartyName: null }, fractions);
    expect(m).toMatchObject({ fractionId: "f1", chargeIds: ["a0", "a1"], confidence: "MEDIUM" });
    // 150 € = 3 × 50 € (1A) and 2 × 75 € (2B): ambiguous
    expect(matchTransfer({ amountCents: 15000, description: "pagamento", counterpartyName: null }, fractions)).toBeNull();
  });
  it("refuses ambiguous or non-covering amounts", () => {
    expect(matchTransfer({ amountCents: 5000, description: "TRF", counterpartyName: null }, fractions)).toBeNull();
    expect(matchTransfer({ amountCents: 6000, description: "1A", counterpartyName: null }, fractions)).toBeNull();
  });
});

describe("namesMatch", () => {
  it("handles bank-style payer names", () => {
    expect(namesMatch("José Pereira", "JOSE M PEREIRA")).toBe(true);
    expect(namesMatch("Maria João Silva Santos", "MARIA SANTOS")).toBe(true);
    expect(namesMatch("Maria Silva", "Ana Silva")).toBe(false);
  });
});

describe("parseStatementCsv", () => {
  it("parses a PT home-banking export, skipping debits", () => {
    const csv = [
      "Data Mov.;Data Valor;Descrição;Débito;Crédito;Saldo",
      "05-03-2026;05-03-2026;TRF DE JOSE PEREIRA Q201;;75,00;1.234,56",
      "06-03-2026;06-03-2026;PAG SERV EDP;120,50;;1.114,06",
      '07-03-2026;07-03-2026;"QUOTA 1A, JAN";;1.050,00;2.164,06',
    ].join("\n");
    const rows = parseStatementCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ bookedOn: "2026-03-05", amountCents: 7500, description: "TRF DE JOSE PEREIRA Q201" });
    expect(rows[1]).toMatchObject({ amountCents: 105000, description: "QUOTA 1A, JAN" });
  });
});
