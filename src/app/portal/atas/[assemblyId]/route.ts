import { z } from "zod";
import { sql } from "@/lib/db";
import { pdfResponse } from "@/lib/pdf/document";
import { currentResident } from "@/lib/resident-session";
import { isOwner } from "@/lib/services/residents";
import { minutesPdf } from "@/lib/services/minutes";

/** Approved minutes for owners of the same condominium (they contain debt data). */
export async function GET(_req: Request, ctx: RouteContext<"/portal/atas/[assemblyId]">) {
  const { assemblyId } = await ctx.params;
  const me = await currentResident();
  if (!me || !isOwner(me) || !z.uuid().safeParse(assemblyId).success) return new Response("Não autorizado", { status: 403 });
  const [ok] = await sql`
    select 1 from assemblies a join minutes m on m.assembly_id = a.id
    where a.id = ${assemblyId} and a.condominium_id = ${me.condominiumId} and m.status = 'APPROVED'`;
  if (!ok) return new Response("Ata não encontrada", { status: 404 });
  const res = await minutesPdf(assemblyId);
  return res ? pdfResponse(res.pdf, "ata.pdf") : new Response("Ata não encontrada", { status: 404 });
}
