import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { pdfResponse } from "@/lib/pdf/document";
import { preLitigationLetterPdf } from "@/lib/services/collections";

export async function GET(_req: Request, ctx: RouteContext<"/admin/devedores/carta/[fractionId]">) {
  await requireAdmin();
  const id = (await ctx.params).fractionId;
  if (!z.uuid().safeParse(id).success) return new Response("Inválido", { status: 400 });
  const pdf = await preLitigationLetterPdf(id);
  return pdf ? pdfResponse(pdf, "interpelacao.pdf") : new Response("Não encontrado", { status: 404 });
}
