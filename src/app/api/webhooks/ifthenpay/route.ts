import { connection, after, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/http/secrets";
import { parseIfthenpayCallback } from "@/lib/payments/callback";
import { applyPayment, issueReceiptForCharge } from "@/lib/services/reconcile";

/**
 * Ifthenpay payment callback (Multibanco + MB WAY).
 * Zero-touch: marks the quota as paid, then issues the Moloni receipt after the
 * response is sent. Receipt failures are retried by /api/cron/receipts.
 */
async function handle(req: NextRequest) {
  await connection(); // always per request, never prerendered
  const params: Record<string, string> = Object.fromEntries(req.nextUrl.searchParams);
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      Object.assign(params, (await req.json().catch(() => ({}))) as Record<string, string>);
    } else if (type.includes("form")) {
      for (const [k, v] of (await req.formData()).entries()) params[k] = String(v);
    }
  }

  const expected = env().IFTHENPAY_ANTI_PHISHING_KEY;
  const devWithoutKey = !expected && process.env.NODE_ENV !== "production";
  if (!devWithoutKey && !safeEqual(params.key ?? params.chave, expected)) {
    return Response.json({ error: "invalid key" }, { status: 403 });
  }
  delete params.key;
  delete params.chave;

  const notification = parseIfthenpayCallback(params);
  if (!notification) return Response.json({ error: "missing amount" }, { status: 400 });

  const { outcome, chargeId } = await applyPayment(notification);
  if (outcome === "APPLIED" && chargeId) {
    after(async () => {
      await issueReceiptForCharge(chargeId).catch((e) =>
        console.error(`[receipt] charge ${chargeId}: ${(e as Error).message}`),
      );
    });
  }
  // Always 200 for well-formed, authenticated callbacks so the provider does not
  // retry forever; anomalies are kept in payment_events for review.
  return Response.json({ outcome });
}

export const GET = handle;
export const POST = handle;
