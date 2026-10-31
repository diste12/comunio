import { describe, expect, it } from "vitest";
import { computeQuorum, hasMinimumNotice, tallyVotes } from "@/lib/assembly/rules";

// 4 fractions: A 400‰, B 300‰, C 200‰, D 100‰
const fr = [
  { fractionId: "A", permilagem: 400 },
  { fractionId: "B", permilagem: 300 },
  { fractionId: "C", permilagem: 200 },
  { fractionId: "D", permilagem: 100 },
];
const v = (fractionId: string, vote: "FAVOR" | "CONTRA" | "ABSTENCAO") => ({ fractionId, vote });

describe("computeQuorum", () => {
  it("sums permilagem of present fractions", () => {
    const q = computeQuorum(fr, ["A", "C"]);
    expect(q.presentHundredths).toBe(60_000);
    expect(q.presentPct).toBeCloseTo(0.6);
    expect(q.canDeliberate).toEqual({ firstCall: true, secondCall: true });
  });
  it("needs more than half on 1st call and 1/4 on 2nd", () => {
    expect(computeQuorum(fr, ["A", "D"]).canDeliberate.firstCall).toBe(false); // exactly 500‰
    expect(computeQuorum(fr, ["C"]).canDeliberate.secondCall).toBe(false); // 200‰
    expect(computeQuorum(fr, ["C", "D"]).canDeliberate.secondCall).toBe(true); // 300‰
  });
});

describe("tallyVotes", () => {
  it("1st call needs > 50% of total capital in favour", () => {
    const base = { fractions: fr, presentIds: ["A", "B", "C"], majority: "SIMPLE" as const, call: 1 as const };
    expect(tallyVotes({ ...base, votes: [v("A", "FAVOR"), v("C", "FAVOR"), v("B", "CONTRA")] }).outcome).toBe("APPROVED");
    // 500‰ in favour is not a majority of 1000‰
    expect(tallyVotes({ ...base, votes: [v("A", "FAVOR"), v("D", "FAVOR"), v("B", "CONTRA")] }).outcome).toBe("REJECTED");
  });
  it("ignores votes from absent fractions", () => {
    const t = tallyVotes({
      fractions: fr, presentIds: ["B", "C", "D"], majority: "SIMPLE", call: 1,
      votes: [v("A", "FAVOR"), v("B", "FAVOR"), v("C", "FAVOR"), v("D", "FAVOR")],
    });
    expect(t.favor).toBe(60_000);
    expect(t.outcome).toBe("APPROVED");
  });
  it("2nd call: majority of present capital with ≥ 1/4 present", () => {
    const t = tallyVotes({
      fractions: fr, presentIds: ["C", "D"], majority: "SIMPLE", call: 2,
      votes: [v("C", "FAVOR"), v("D", "CONTRA")],
    });
    expect(t.outcome).toBe("APPROVED");
    expect(
      tallyVotes({ fractions: fr, presentIds: ["C"], majority: "SIMPLE", call: 2, votes: [v("C", "FAVOR")] }).outcome,
    ).toBe("NO_QUORUM");
  });
  it("two-thirds needs 2/3 of capital and a majority of owners", () => {
    const base = { fractions: fr, presentIds: ["A", "B", "C", "D"], majority: "TWO_THIRDS" as const, call: 1 as const };
    expect(tallyVotes({ ...base, votes: [v("A", "FAVOR"), v("B", "FAVOR"), v("C", "CONTRA")] }).outcome).toBe("REJECTED"); // 2 of 4 owners
    expect(tallyVotes({ ...base, votes: [v("A", "FAVOR"), v("B", "FAVOR"), v("D", "FAVOR")] }).outcome).toBe("APPROVED"); // 800‰, 3 owners
  });
  it("unanimity of those present with ≥ 2/3 is conditional on the absent", () => {
    const t = tallyVotes({
      fractions: fr, presentIds: ["A", "B"], majority: "UNANIMITY", call: 1,
      votes: [v("A", "FAVOR"), v("B", "FAVOR")],
    });
    expect(t.outcome).toBe("CONDITIONAL");
    const all = tallyVotes({
      fractions: fr, presentIds: ["A", "B", "C", "D"], majority: "UNANIMITY", call: 1,
      votes: fr.map((f) => v(f.fractionId, "FAVOR")),
    });
    expect(all.outcome).toBe("APPROVED");
  });
});

describe("notice period", () => {
  it("requires 10 days", () => {
    const meeting = new Date("2027-03-20T18:00:00Z");
    expect(hasMinimumNotice(meeting, new Date("2027-03-10T17:00:00Z"))).toBe(true);
    expect(hasMinimumNotice(meeting, new Date("2027-03-11T09:00:00Z"))).toBe(false);
  });
});
