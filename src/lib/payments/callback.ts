import { lisbonWallClockToDate } from "@/lib/dates";
import { toCents } from "@/lib/money";
import type { PaymentNotification } from "./types";

/**
 * Parse an Ifthenpay callback. The callback URL is configured in the Ifthenpay
 * backoffice with placeholders, e.g.:
 *
 *   https://<app>/api/webhooks/ifthenpay?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]
 *     &amount=[AMOUNT]&requestId=[REQUEST_ID]&entity=[ENTITY]&reference=[REFERENCE]
 *     &payment_datetime=[PAYMENT_DATETIME]&payment_method=[PAYMENT_METHOD]
 */
export function parseIfthenpayCallback(params: Record<string, string>): PaymentNotification | null {
  const amount = params.amount ?? params.valor;
  if (!amount) return null;
  const method = (params.payment_method ?? "").toUpperCase().includes("MBWAY") ? "MBWAY" : "MULTIBANCO";
  return {
    provider: "ifthenpay",
    orderId: params.orderId ?? params.orderid ?? null,
    entity: params.entity ?? params.entidade ?? null,
    reference: (params.reference ?? params.referencia ?? "").replace(/\s/g, "") || null,
    requestId: params.requestId ?? params.requestid ?? null,
    amountCents: toCents(amount.replace(",", ".")),
    method: params.payment_method ? method : params.reference || params.referencia ? "MULTIBANCO" : "MBWAY",
    paidAt: parsePaymentDate(params.payment_datetime ?? params.datahorapag) ?? new Date(),
    raw: params,
  };
}

/** Accepts "dd-MM-yyyy HH:mm:ss" (Ifthenpay style, Lisbon wall-clock) or ISO 8601. */
function parsePaymentDate(value: string | undefined): Date | null {
  if (!value) return null;
  const pt = /^(\d{2})[-/](\d{2})[-/](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (pt) {
    const [, d, m, y, hh, mm, ss = "00"] = pt;
    return lisbonWallClockToDate(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
  }
  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? null : iso;
}
