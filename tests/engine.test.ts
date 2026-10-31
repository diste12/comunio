import { describe, expect, it } from "vitest";
import { apportion, buildQuotaPlan, QuotaEngineError, splitInstallments } from "@/lib/quotas/engine";

const fractions = [
  { id: "a", designation: "A", permilagem: 333.33 },
  { id: "b", designation: "B", permilagem: 333.33 },
  { id: "c", designation: "C", permilagem: 333.34 },
];

describe("apportion", () => {
  it("sums exactly to the total", () => {
    const parts = apportion(1_000_000, [BigInt(33333), BigInt(33333), BigInt(33334)]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });
  it("gives leftover cents to the largest remainders", () => {
    expect(apportion(10, [BigInt(1), BigInt(1), BigInt(1)])).toEqual([4, 3, 3]);
  });
});

describe("splitInstallments", () => {
  it("front-loads extra cents", () => {
    expect(splitInstallments(1001, 12)).toEqual([84, 84, 84, 84, 84, 83, 83, 83, 83, 83, 83, 83]);
  });
});

describe("buildQuotaPlan", () => {
  it("PRD example: €10,000 budget → 12 monthly charges per fraction plus 10% reserve", () => {
    const plan = buildQuotaPlan(fractions, { fiscalYear: 2027, ordinaryAmountCents: 1_000_000 });
    expect(plan.charges).toHaveLength(36);
    expect(plan.totals.ordinaryCents).toBe(1_000_000);
    expect(plan.totals.reserveCents).toBeGreaterThanOrEqual(100_000);
    const chargedTotal = plan.charges.reduce((s, c) => s + c.amountTotalCents, 0);
    expect(chargedTotal).toBe(plan.totals.totalCents);
    for (const a of plan.allocations) {
      // Reserve never below the legal 10% of the fraction's share
      expect(a.annualReserveCents * 10).toBeGreaterThanOrEqual(a.annualOrdinaryCents);
      const own = plan.charges.filter((c) => c.fractionId === a.fractionId);
      expect(own.reduce((s, c) => s + c.amountOrdinaryCents, 0)).toBe(a.annualOrdinaryCents);
      expect(own.reduce((s, c) => s + c.amountReserveCents, 0)).toBe(a.annualReserveCents);
    }
  });

  it("allocates proportionally to permilagem", () => {
    const plan = buildQuotaPlan(
      [
        { id: "x", designation: "X", permilagem: 250 },
        { id: "y", designation: "Y", permilagem: 750 },
      ],
      { fiscalYear: 2027, ordinaryAmountCents: 1_200_000, reserveFundPct: 10 },
    );
    expect(plan.allocations.map((a) => a.annualOrdinaryCents)).toEqual([300_000, 900_000]);
    expect(plan.allocations.map((a) => a.annualReserveCents)).toEqual([30_000, 90_000]);
    const jan = plan.charges.find((c) => c.fractionId === "x" && c.installment === 1)!;
    expect(jan.amountTotalCents).toBe(27_500);
    expect(jan.dueDate).toBe("2027-01-08");
    expect(jan.description).toContain("janeiro 2027");
  });

  it("clamps due dates to month length and supports quarterly plans", () => {
    const plan = buildQuotaPlan(fractions, {
      fiscalYear: 2027,
      ordinaryAmountCents: 400_000,
      installments: 4,
      dueDay: 31,
    });
    const dates = plan.charges.filter((c) => c.fractionId === "a").map((c) => c.dueDate);
    expect(dates).toEqual(["2027-01-31", "2027-04-30", "2027-07-31", "2027-10-31"]);
  });

  it("rejects a reserve fund under 10%", () => {
    expect(() =>
      buildQuotaPlan(fractions, { fiscalYear: 2027, ordinaryAmountCents: 1000, reserveFundPct: 5 }),
    ).toThrow(QuotaEngineError);
  });

  it("rejects permilagem that does not sum to 1000", () => {
    expect(() =>
      buildQuotaPlan([{ id: "a", designation: "A", permilagem: 500 }], {
        fiscalYear: 2027,
        ordinaryAmountCents: 1000,
      }),
    ).toThrow(/1000‰/);
  });

  it("normalises small permilagem rounding drift with a warning", () => {
    const plan = buildQuotaPlan(
      [
        { id: "a", designation: "A", permilagem: 333.33 },
        { id: "b", designation: "B", permilagem: 666.66 },
      ],
      { fiscalYear: 2027, ordinaryAmountCents: 1_000_000 },
    );
    expect(plan.warnings).toHaveLength(1);
    expect(plan.totals.ordinaryCents).toBe(1_000_000);
  });
});
