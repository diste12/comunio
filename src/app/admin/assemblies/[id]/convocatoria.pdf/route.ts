import { requireAdmin } from "@/lib/auth";
import { pdfResponse } from "@/lib/pdf/document";
import { convocationPdf, getAssembly } from "@/lib/services/assemblies";

export async function GET(_req: Request, ctx: RouteContext<"/admin/assemblies/[id]/convocatoria.pdf">) {
  await requireAdmin();
  const view = await getAssembly((await ctx.params).id).catch(() => null);
  if (!view) return new Response("Não encontrada", { status: 404 });
  return pdfResponse(await convocationPdf(view), "convocatoria.pdf");
}
