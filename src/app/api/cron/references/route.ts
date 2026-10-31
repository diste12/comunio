import { connection, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/http/secrets";
import { issueMultibancoReferences } from "@/lib/services/references";

export const maxDuration = 300;

/** Vercel Cron (daily): zero-touch Multibanco references for quotas due in the next 45 days, portfolio-wide. */
export async function GET(req: NextRequest) {
  await connection(); // always per request, never prerendered
  if (!safeEqual(req.headers.get("authorization")?.replace(/^Bearer /, ""), env().CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const condos = await sql<{ condominium_id: string }[]>`
    select distinct condominium_id from quota_charges
    where payment_status = 'PENDING' and mb_reference is null and due_date <= current_date + 45`;
  let issued = 0;
  const errors: string[] = [];
  for (const c of condos) {
    const r = await issueMultibancoReferences(c.condominium_id);
    issued += r.issued;
    errors.push(...r.errors.slice(0, 2));
  }
  return Response.json({ condominiums: condos.length, issued, errors: errors.slice(0, 20) });
}
