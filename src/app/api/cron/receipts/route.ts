import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/http/secrets";
import { retryPendingReceipts } from "@/lib/services/reconcile";

/** Vercel Cron: retry Moloni receipts that failed at webhook time. */
export async function GET(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!safeEqual(auth, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await retryPendingReceipts());
}
