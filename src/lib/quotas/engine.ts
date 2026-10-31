/**
 * Permilagem Engine.
 *
 * Splits an annual condominium budget across fractions by permilagem and into
 * monthly installments, adding the mandatory reserve fund (DL 268/94, art. 4.º:
 * each owner contributes at least 10% of their share of ordinary expenses).
 *
 * All math is done in integer cents. Totals always reconcile exactly:
 *   Σ fractions ordinary = budget, and Σ installments = fraction annual amount.
 */

export type FractionInput = {
  id: string;
  designation: string;
  /** Permilagem with up to 2 decimals, e.g. 45.25 (‰). */
  permilagem: number;
};

export type BudgetInput = {
  fiscalYear: number;
  /** Annual ordinary expenses budget, in cents. */
  ordinaryAmountCents: number;
  /** Reserve fund percentage; legal minimum is 10. */
  reserveFundPct?: number;
  installments?: number;
  /** Day of month each installment is due (clamped to month length). */
  dueDay?: number;
};

export type FractionAllocation = {
  fractionId: string;
  designation: string;
  permilagem: number;
  annualOrdinaryCents: number;
  annualReserveCents: number;
};

export type ChargeDraft = {
  fractionId: string;
  installment: number;
  description: string;
  dueDate: string; // YYYY-MM-DD
  amountOrdinaryCents: number;
  amountReserveCents: number;
  amountTotalCents: number;
};

export type QuotaPlan = {
  allocations: FractionAllocation[];
  charges: ChargeDraft[];
  totals: { ordinaryCents: number; reserveCents: number; totalCents: number };
  warnings: string[];
};

export const MIN_RESERVE_FUND_PCT = 10;
/** Permilagem totals outside 1000 ± this are rejected as a data error. */
const PERMILAGEM_TOLERANCE = 0.5;

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export class QuotaEngineError extends Error {}

/** Permilagem as integer hundredths (45.25 → 4525) to avoid float drift. */
function toHundredths(permilagem: number): bigint {
  return BigInt(Math.round(permilagem * 100));
}

/**
 * Largest-remainder apportionment: split `total` proportionally to `weights`
 * so that the parts are integers summing exactly to `total`.
 */
export function apportion(total: number, weights: bigint[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, BigInt(0));
  if (weightSum <= BigInt(0)) throw new QuotaEngineError("Sum of weights must be positive");
  const totalBig = BigInt(total);
  const parts = weights.map((w) => {
    const numerator = totalBig * w;
    return { floor: numerator / weightSum, remainder: numerator % weightSum };
  });
  let leftover = Number(totalBig - parts.reduce((a, p) => a + p.floor, BigInt(0)));
  // Hand leftover cents to the largest remainders; ties go to the earlier item
  // so the result is deterministic.
  const order = parts
    .map((p, i) => ({ i, remainder: p.remainder }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  const result = parts.map((p) => Number(p.floor));
  for (const { i } of order) {
    if (leftover <= 0) break;
    result[i] += 1;
    leftover -= 1;
  }
  return result;
}

/** Split an amount into n integer installments; extra cents go to the first ones. */
export function splitInstallments(amountCents: number, n: number): number[] {
  const base = Math.floor(amountCents / n);
  const extra = amountCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

function dueDateFor(year: number, monthIndex: number, dueDay: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Months covered by installment i when the year is split into n installments. */
function installmentMonth(i: number, n: number): number {
  return Math.floor((i * 12) / n);
}

export function buildQuotaPlan(fractions: FractionInput[], budget: BudgetInput): QuotaPlan {
  const reservePct = budget.reserveFundPct ?? MIN_RESERVE_FUND_PCT;
  const installments = budget.installments ?? 12;
  const dueDay = budget.dueDay ?? 8;
  const warnings: string[] = [];

  if (fractions.length === 0) throw new QuotaEngineError("Condominium has no fractions");
  if (!Number.isInteger(budget.ordinaryAmountCents) || budget.ordinaryAmountCents <= 0) {
    throw new QuotaEngineError("Budget must be a positive amount in cents");
  }
  if (reservePct < MIN_RESERVE_FUND_PCT) {
    throw new QuotaEngineError(
      `Reserve fund must be at least ${MIN_RESERVE_FUND_PCT}% (DL 268/94, art. 4.º)`,
    );
  }
  if (!Number.isInteger(installments) || installments < 1 || installments > 12) {
    throw new QuotaEngineError("Installments must be between 1 and 12");
  }
  if (fractions.some((f) => !(f.permilagem > 0))) {
    throw new QuotaEngineError("Every fraction needs a positive permilagem");
  }

  const weights = fractions.map((f) => toHundredths(f.permilagem));
  const permilagemTotal = Number(weights.reduce((a, b) => a + b, BigInt(0))) / 100;
  if (Math.abs(permilagemTotal - 1000) > PERMILAGEM_TOLERANCE) {
    throw new QuotaEngineError(
      `Permilagem totals ${permilagemTotal.toFixed(2)}‰; the título constitutivo must sum to 1000‰`,
    );
  }
  if (permilagemTotal !== 1000) {
    warnings.push(
      `Permilagem totals ${permilagemTotal.toFixed(2)}‰ (not 1000‰); shares were normalised.`,
    );
  }

  const ordinaryShares = apportion(budget.ordinaryAmountCents, weights);

  const allocations: FractionAllocation[] = fractions.map((f, i) => {
    // Round the reserve up per fraction so nobody ends below the legal minimum.
    const annualReserveCents = Math.ceil((ordinaryShares[i] * reservePct) / 100);
    return {
      fractionId: f.id,
      designation: f.designation,
      permilagem: f.permilagem,
      annualOrdinaryCents: ordinaryShares[i],
      annualReserveCents,
    };
  });

  const charges: ChargeDraft[] = [];
  for (const a of allocations) {
    const ordinaryParts = splitInstallments(a.annualOrdinaryCents, installments);
    const reserveParts = splitInstallments(a.annualReserveCents, installments);
    for (let i = 0; i < installments; i++) {
      const month = installmentMonth(i, installments);
      const total = ordinaryParts[i] + reserveParts[i];
      if (total <= 0) continue;
      const period =
        installments === 12
          ? `${MONTHS_PT[month]} ${budget.fiscalYear}`
          : `prestação ${i + 1}/${installments} ${budget.fiscalYear}`;
      charges.push({
        fractionId: a.fractionId,
        installment: i + 1,
        description: `Quota ${period} — fração ${a.designation}`,
        dueDate: dueDateFor(budget.fiscalYear, month, dueDay),
        amountOrdinaryCents: ordinaryParts[i],
        amountReserveCents: reserveParts[i],
        amountTotalCents: total,
      });
    }
  }

  const ordinaryCents = allocations.reduce((s, a) => s + a.annualOrdinaryCents, 0);
  const reserveCents = allocations.reduce((s, a) => s + a.annualReserveCents, 0);
  return {
    allocations,
    charges,
    totals: { ordinaryCents, reserveCents, totalCents: ordinaryCents + reserveCents },
    warnings,
  };
}
