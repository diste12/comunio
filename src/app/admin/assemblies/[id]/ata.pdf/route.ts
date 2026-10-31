import { requireAdmin } from "@/lib/auth";
import { pdfResponse } from "@/lib/pdf/document";
import { minutesPdf } from "@/lib/services/minutes";

export async function GET(_req: Request, ctx: RouteContext<"/admin/assemblies/[id]/ata.pdf">) {
  await requireAdmin();
  const res = await minutesPdf((await ctx.params).id).catch(() => null);
  if (!res) return new Response("Ata não encontrada", { status: 404 });
  return pdfResponse(res.pdf, "ata.pdf");
}
