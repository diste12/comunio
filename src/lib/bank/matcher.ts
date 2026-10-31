/**
 * Bank transfer → quota matching.
 *
 * Owners pay by transfer with free-text descriptions ("quota 2B março",
 * "Q1234", or nothing at all), often several months at once. A transfer is
 * matched to the k oldest pending quotas of one fraction whose total equals
 * the amount exactly.
 *
 * HIGH confidence (applied automatically): an order reference in the text,
 * the fraction designation in the text, or the payer's name matching the owner.
 * MEDIUM (suggested, 1-click confirm): amount alone identifies one fraction.
 */

export type PendingCharge = { id: string; orderSeq: string; amountCents: number; dueDate: string };

export type FractionCandidate = {
  fractionId: string;
  designation: string;
  ownerNames: string[];
  /** Pending charges, oldest first. */
  pending: PendingCharge[];
};

export type Transfer = { amountCents: number; description: string; counterpartyName: string | null };

export type Match = {
  fractionId: string;
  chargeIds: string[];
  confidence: "HIGH" | "MEDIUM";
  reason: string;
};

export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const STOP = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Owner and payer share first and last name, or at least two significant names. */
export function namesMatch(a: string, b: string): boolean {
  const ta = normalize(a).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
  const tb = normalize(b).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
  if (ta.length === 0 || tb.length === 0) return false;
  const common = ta.filter((t) => tb.includes(t));
  if (common.length >= 2) return true;
  return ta[0] === tb[0] && ta.at(-1) === tb.at(-1) && ta.length > 1 && tb.length > 1;
}

/** k oldest pending charges whose sum equals the amount (k ≥ 1), if any. */
export function oldestCovering(pending: PendingCharge[], amountCents: number): PendingCharge[] | null {
  let sum = 0;
  for (let k = 0; k < pending.length; k++) {
    sum += pending[k].amountCents;
    if (sum === amountCents) return pending.slice(0, k + 1);
    if (sum > amountCents) return null;
  }
  return null;
}

function mentionsDesignation(text: string, designation: string): boolean {
  const d = normalize(designation);
  // "fracao 2B", "fr 2b", "2b" as a standalone token
  return new RegExp(`(^| )(fracao |fr |frac )?${d}( |$)`).test(text);
}

export function matchTransfer(t: Transfer, fractions: FractionCandidate[]): Match | null {
  if (t.amountCents <= 0) return null;
  const text = normalize(t.description);

  // 1. Explicit order references (Q123) — exact charges, amount must agree.
  const refs = [...t.description.matchAll(/\bQ(\d{1,12})\b/gi)].map((m) => m[1]);
  if (refs.length > 0) {
    for (const f of fractions) {
      const charges = f.pending.filter((c) => refs.includes(c.orderSeq));
      if (charges.length > 0 && charges.reduce((s, c) => s + c.amountCents, 0) === t.amountCents) {
        return { fractionId: f.fractionId, chargeIds: charges.map((c) => c.id), confidence: "HIGH", reason: `Referência ${refs.map((r) => `Q${r}`).join(", ")} na descrição` };
      }
    }
  }

  const covering = fractions
    .map((f) => ({ f, charges: oldestCovering(f.pending, t.amountCents) }))
    .filter((x): x is { f: FractionCandidate; charges: PendingCharge[] } => x.charges !== null);
  if (covering.length === 0) return null;
  const toMatch = (x: (typeof covering)[number], confidence: Match["confidence"], reason: string): Match => ({
    fractionId: x.f.fractionId, chargeIds: x.charges.map((c) => c.id), confidence,
    reason: `${reason}; valor = ${x.charges.length} quota(s) mais antiga(s)`,
  });

  // 2. Fraction designation in the description.
  const byDesignation = covering.filter((x) => mentionsDesignation(text, x.f.designation));
  if (byDesignation.length === 1) return toMatch(byDesignation[0], "HIGH", `Fração ${byDesignation[0].f.designation} na descrição`);

  // 3. Payer name equals an owner's name.
  if (t.counterpartyName) {
    const byName = covering.filter((x) => x.f.ownerNames.some((n) => namesMatch(n, t.counterpartyName!)));
    if (byName.length === 1) return toMatch(byName[0], "HIGH", `Ordenante corresponde ao proprietário (${byName[0].f.designation})`);
  }

  // 4. Amount alone is unambiguous → suggestion only.
  if (covering.length === 1) return toMatch(covering[0], "MEDIUM", `Valor corresponde apenas à fração ${covering[0].f.designation}`);
  return null;
}
