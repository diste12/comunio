import "server-only";
import { env } from "@/lib/env";
import { MockBillingProvider, MoloniProvider } from "./moloni";
import type { BillingProvider } from "./types";

export function billingProvider(): BillingProvider {
  return env().BILLING_PROVIDER === "moloni" ? new MoloniProvider() : new MockBillingProvider();
}
