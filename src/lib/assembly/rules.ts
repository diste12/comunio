/**
 * Assembly quorum and voting rules (Código Civil, as amended by Lei 8/2022).
 *
 * - Votes are weighted by permilagem (art. 1430.º n.º 2).
 * - 1st call: resolutions need a majority of the building's total capital
 *   (art. 1432.º n.º 3), i.e. more than 500‰ in favour.
 * - 2nd call: majority of the capital present, provided those present hold at
 *   least 1/4 of the total capital (art. 1432.º n.º 4).
 * - Two-thirds matters (e.g. innovations, art. 1425.º): majority of owners
 *   holding at least 2/3 of total capital, on either call.
 * - Unanimity matters: unanimous vote of all capital; or unanimous vote of those
 *   present holding ≥ 2/3 of capital, conditional on the absent owners not
 *   objecting after notification (art. 1432.º n.º 5 to 8).
 *
 * Permilagem is handled in hundredths (integers) to avoid float drift.
 */

export type Majority = "SIMPLE" | "TWO_THIRDS" | "UNANIMITY";
export type VoteChoice = "FAVOR" | "CONTRA" | "ABSTENCAO";
export type Call = 1 | 2;

export type WeightedFraction = { fractionId: string; permilagem: number };

const h = (p: number) => Math.round(p * 100);

export type QuorumState = {
  totalHundredths: number;
  presentHundredths: number;
  presentFractions: number;
  totalFractions: number;
  presentPct: number;
  /** Capital present could, in principle, pass a simple-majority item. */
  canDeliberate: { firstCall: boolean; secondCall: boolean };
};

export function computeQuorum(fractions: WeightedFraction[], presentIds: Iterable<string>): QuorumState {
  const present = new Set(presentIds);
  const totalHundredths = fractions.reduce((s, f) => s + h(f.permilagem), 0);
  const presentList = fractions.filter((f) => present.has(f.fractionId));
  const presentHundredths = presentList.reduce((s, f) => s + h(f.permilagem), 0);
  return {
    totalHundredths,
    presentHundredths,
    presentFractions: presentList.length,
    totalFractions: fractions.length,
    presentPct: totalHundredths ? presentHundredths / totalHundredths : 0,
    canDeliberate: {
      firstCall: presentHundredths * 2 > totalHundredths,
      secondCall: presentHundredths * 4 >= totalHundredths,
    },
  };
}

export type TallyOutcome = "APPROVED" | "REJECTED" | "NO_QUORUM" | "CONDITIONAL";

export type Tally = {
  favor: number;
  contra: number;
  abstencao: number;
  /** Present fractions that have not voted yet. */
  notVoted: number;
  favorFractions: number;
  outcome: TallyOutcome;
  /** Human-readable legal basis for the outcome (pt-PT). */
  basis: string;
};

export function tallyVotes(args: {
  fractions: WeightedFraction[];
  presentIds: Iterable<string>;
  votes: { fractionId: string; vote: VoteChoice }[];
  majority: Majority;
  call: Call;
}): Tally {
  const { fractions, majority, call } = args;
  const present = new Set(args.presentIds);
  const weight = new Map(fractions.map((f) => [f.fractionId, h(f.permilagem)]));
  const q = computeQuorum(fractions, present);
  const total = q.totalHundredths;
  const presentCap = q.presentHundredths;

  let favor = 0, contra = 0, abstencao = 0, favorFractions = 0;
  const voted = new Set<string>();
  for (const v of args.votes) {
    // Only present (or represented) fractions may vote; ignore stray votes.
    if (!present.has(v.fractionId) || voted.has(v.fractionId)) continue;
    voted.add(v.fractionId);
    const w = weight.get(v.fractionId) ?? 0;
    if (v.vote === "FAVOR") { favor += w; favorFractions++; }
    else if (v.vote === "CONTRA") contra += w;
    else abstencao += w;
  }
  const notVoted = presentCap - favor - contra - abstencao;
  const base = { favor, contra, abstencao, notVoted, favorFractions };

  if (majority === "UNANIMITY") {
    if (favor === total) return { ...base, outcome: "APPROVED", basis: "Unanimidade de todo o capital (art. 1432.º)." };
    if (favor === presentCap && presentCap * 3 >= total * 2 && presentCap > 0) {
      return {
        ...base,
        outcome: "CONDITIONAL",
        basis:
          "Unanimidade dos presentes com ≥ 2/3 do capital; aprovação condicionada à não oposição dos ausentes, a notificar no prazo de 30 dias (art. 1432.º n.º 5 a 8).",
      };
    }
    return { ...base, outcome: "REJECTED", basis: "Exige unanimidade (art. 1432.º)." };
  }

  if (majority === "TWO_THIRDS") {
    const capitalOk = favor * 3 >= total * 2;
    const headsOk = favorFractions * 2 > fractions.length;
    return {
      ...base,
      outcome: capitalOk && headsOk ? "APPROVED" : "REJECTED",
      basis: "Maioria dos condóminos representando 2/3 do valor total do prédio (art. 1425.º).",
    };
  }

  if (call === 1) {
    if (presentCap * 2 <= total) {
      return { ...base, outcome: "NO_QUORUM", basis: "1.ª convocatória: presentes não representam mais de metade do capital." };
    }
    return {
      ...base,
      outcome: favor * 2 > total ? "APPROVED" : "REJECTED",
      basis: "1.ª convocatória: maioria dos votos representativos do capital investido (art. 1432.º n.º 3).",
    };
  }
  if (presentCap * 4 < total) {
    return { ...base, outcome: "NO_QUORUM", basis: "2.ª convocatória: presentes representam menos de 1/4 do capital (art. 1432.º n.º 4)." };
  }
  return {
    ...base,
    outcome: favor * 2 > presentCap ? "APPROVED" : "REJECTED",
    basis: "2.ª convocatória: maioria dos votos dos presentes, com pelo menos 1/4 do capital (art. 1432.º n.º 4).",
  };
}

/** Lei 8/2022 / art. 1432.º n.º 1: convocation must be sent ≥ 10 days in advance. */
export const MIN_NOTICE_DAYS = 10;

export function noticeDeadline(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() - MIN_NOTICE_DAYS * 86_400_000);
}

export function hasMinimumNotice(scheduledAt: Date, sendAt: Date = new Date()): boolean {
  return sendAt.getTime() <= noticeDeadline(scheduledAt).getTime();
}

export function formatPermilagem(hundredths: number): string {
  return `${(hundredths / 100).toFixed(2).replace(".", ",")}‰`;
}
