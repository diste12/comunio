import { describe, expect, it } from "vitest";
import { ONBOARDING_TEMPLATE, parseOnboardingCsv } from "@/lib/onboarding/csv";

describe("parseOnboardingCsv", () => {
  it("parses the template", () => {
    const r = parseOnboardingCsv(ONBOARDING_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.permilagemTotal).toBe(1000);
    expect(r.fractions).toHaveLength(3);
    expect(r.fractions[0].residents[0]).toMatchObject({ phone: "351912345678", emailConsent: true, role: "Proprietário" });
    expect(r.fractions[1].residents.map((x) => x.role)).toEqual(["Proprietário", "Inquilino"]);
    expect(r.fractions[1].residents[0].emailConsent).toBe(false);
  });
  it("rejects permilagem that does not sum to 1000 and bad data", () => {
    const r = parseOnboardingCsv("fracao;permilagem;proprietario;telefone;nif\n1A;400;Ana;912345678;123456780\n1A;100;Rui;abc;\n2B;0;X;912345678;");
    expect(r.errors.some((e) => e.includes("NIF"))).toBe(true);
    expect(r.errors.some((e) => e.includes("repetida"))).toBe(true);
    expect(r.errors.some((e) => e.includes("permilagem inválida"))).toBe(true);
    expect(r.errors.some((e) => e.includes("soma"))).toBe(true);
  });
  it("requires the key columns", () => {
    expect(parseOnboardingCsv("nome;telefone\nA;1").errors[0]).toMatch(/obrigatórias/);
  });
});
