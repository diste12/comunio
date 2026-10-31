import { describe, expect, it } from "vitest";
import { parseIfthenpayCallback } from "@/lib/payments/callback";

describe("parseIfthenpayCallback", () => {
  it("parses a Multibanco callback", () => {
    const n = parseIfthenpayCallback({
      orderId: "Q42",
      amount: "91.67",
      entity: "12345",
      reference: "123 456 789",
      payment_datetime: "05-01-2027 14:03:22",
    })!;
    expect(n.amountCents).toBe(9167);
    expect(n.reference).toBe("123456789");
    expect(n.method).toBe("MULTIBANCO");
    expect(n.paidAt.toISOString()).toBe("2027-01-05T14:03:22.000Z");
  });
  it("detects MB WAY", () => {
    const n = parseIfthenpayCallback({ orderId: "Q7", amount: "10,50", requestId: "abc", payment_method: "MBWAY" })!;
    expect(n.method).toBe("MBWAY");
    expect(n.amountCents).toBe(1050);
  });
  it("rejects callbacks without amount", () => {
    expect(parseIfthenpayCallback({ orderId: "Q1" })).toBeNull();
  });
});
