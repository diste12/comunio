import { describe, expect, it } from "vitest";
import { isValidNif, normalizePtPhone } from "@/lib/pt/nif";
import { centsToDecimal, toCents } from "@/lib/money";

describe("NIF", () => {
  it("validates check digits", () => {
    expect(isValidNif("501442600")).toBe(true);
    expect(isValidNif("501442601")).toBe(false);
    expect(isValidNif("12345")).toBe(false);
  });
});

describe("phone", () => {
  it("normalises PT mobiles", () => {
    expect(normalizePtPhone("912 345 678")).toBe("351912345678");
    expect(normalizePtPhone("+351 912345678")).toBe("351912345678");
    expect(normalizePtPhone("213456789")).toBeNull();
  });
});

describe("money", () => {
  it("round-trips numeric strings", () => {
    expect(toCents("123.45")).toBe(12345);
    expect(toCents("7.5")).toBe(750);
    expect(toCents("10")).toBe(1000);
    expect(centsToDecimal(12345)).toBe("123.45");
    expect(centsToDecimal(5)).toBe("0.05");
  });
});

import { parseEuroInput } from "@/lib/money";
describe("parseEuroInput", () => {
  it("accepts pt-PT and plain formats", () => {
    expect(parseEuroInput("10.000,50")).toBe(1_000_050);
    expect(parseEuroInput("10000")).toBe(1_000_000);
    expect(parseEuroInput("10.000")).toBe(1_000_000);
    expect(parseEuroInput("99.5")).toBe(9950);
    expect(parseEuroInput("€ 1 200")).toBe(120_000);
    expect(parseEuroInput("abc")).toBeNull();
  });
});
