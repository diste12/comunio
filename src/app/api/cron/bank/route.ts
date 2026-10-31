import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/http/secrets";
import { syncBank } from "@/lib/services/bank";

export const maxDuration = 300;

/** Vercel Cron (daily): pull credits from every connected account and reconcile. */
export async function GET(req: NextRequest) {
  if (!safeEqual(req.headers.get("authorization")?.replace(/^Bearer /, ""), env().CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (env().BANK_PROVIDER !== "saltedge") return Response.json({ skipped: "BANK_PROVIDER is not saltedge" });
  const condos = await sql<{ id: string }[]>`select id from condominiums where saltedge_connection_id is not null and saltedge_account_id is not null`;
  const totals = { condominiums: condos.length, inserted: 0, auto: 0, suggested: 0, unmatched: 0, errors: 0 };
  for (const c of condos) {
    try {
      const r = await syncBank(c.id);
      totals.inserted += r.inserted; totals.auto += r.auto; totals.suggested += r.suggested; totals.unmatched += r.unmatched;
    } catch {
      totals.errors++;
    }
  }
  return Response.json(totals);
}
