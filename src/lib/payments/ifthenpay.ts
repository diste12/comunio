import "server-only";
import { createHash } from "node:crypto";
import { centsToDecimal } from "@/lib/money";
import type {
  MbWayRequest,
  MbWayResult,
  MultibancoReference,
  MultibancoRequest,
  PaymentsProvider,
} from "./types";

const API = "https://api.ifthenpay.com";

/**
 * Ifthenpay REST client.
 *
 * Endpoints/fields follow Ifthenpay's public API (multibanco/reference/init and
 * spg/payment/mbway). TODO before go-live: verify against the current docs with
 * sandbox keys — this sprint was built without network access to ifthenpay.com.
 */
export class IfthenpayProvider implements PaymentsProvider {
  readonly name = "ifthenpay" as const;

  async createMultibancoReference(req: MultibancoRequest): Promise<MultibancoReference> {
    if (!req.mbKey) throw new Error("Condominium has no Ifthenpay MB key configured");
    const body = {
      mbKey: req.mbKey,
      orderId: req.orderId,
      amount: centsToDecimal(req.amountCents),
      description: req.description.slice(0, 200),
      expiryDays: req.expiryDays,
    };
    const res = await post<{
      Status: string;
      Message: string;
      Entity: string;
      Reference: string;
      RequestId: string;
      ExpiryDate?: string;
    }>("/multibanco/reference/init", body);
    if (res.Status !== "0") throw new Error(`Ifthenpay MB error ${res.Status}: ${res.Message}`);
    return {
      entity: res.Entity,
      reference: res.Reference.replace(/\s/g, ""),
      requestId: res.RequestId,
      expiresAt: res.ExpiryDate ?? null,
    };
  }

  async requestMbWay(req: MbWayRequest): Promise<MbWayResult> {
    if (!req.mbWayKey) throw new Error("Condominium has no Ifthenpay MB WAY key configured");
    const res = await post<{ Status: string; Message: string; RequestId: string }>(
      "/spg/payment/mbway",
      {
        mbWayKey: req.mbWayKey,
        orderId: req.orderId,
        amount: centsToDecimal(req.amountCents),
        mobileNumber: `351#${req.phone.replace(/^351/, "")}`,
        email: req.email ?? "",
        description: req.description.slice(0, 100),
      },
    );
    return { requestId: res.RequestId, status: res.Status, message: res.Message };
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Ifthenpay ${path} HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Offline stand-in used in development and demos. Produces deterministic,
 * well-formed references so the rest of the pipeline can be exercised.
 */
export class MockPaymentsProvider implements PaymentsProvider {
  readonly name = "mock" as const;

  async createMultibancoReference(req: MultibancoRequest): Promise<MultibancoReference> {
    const digest = createHash("sha256").update(`mb:${req.orderId}`).digest();
    const reference = String(digest.readUInt32BE(0) % 1_000_000_000).padStart(9, "0");
    const expires = new Date(Date.now() + req.expiryDays * 86_400_000);
    return {
      entity: "99999",
      reference,
      requestId: `mock-mb-${req.orderId}`,
      expiresAt: req.expiryDays > 0 ? expires.toISOString().slice(0, 10) : null,
    };
  }

  async requestMbWay(req: MbWayRequest): Promise<MbWayResult> {
    return { requestId: `mock-mbway-${req.orderId}-${Date.now()}`, status: "000", message: "Mock push sent" };
  }
}
