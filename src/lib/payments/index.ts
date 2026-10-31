import "server-only";
import { env } from "@/lib/env";
import { IfthenpayProvider, MockPaymentsProvider } from "./ifthenpay";
import type { PaymentsProvider } from "./types";

export function paymentsProvider(): PaymentsProvider {
  return env().PAYMENTS_PROVIDER === "ifthenpay" ? new IfthenpayProvider() : new MockPaymentsProvider();
}

/** Provider orderId for a quota charge: short, numeric-ish, unique. */
export function orderIdFor(orderSeq: string | number | bigint): string {
  return `Q${orderSeq}`;
}

export function orderSeqFromOrderId(orderId: string): string | null {
  const m = /^Q(\d+)$/.exec(orderId.trim());
  return m ? m[1] : null;
}
