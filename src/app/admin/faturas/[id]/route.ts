import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { invoiceFile } from "@/lib/services/rfps";

export async function GET(_req: Request, ctx: RouteContext<"/admin/faturas/[id]">) {
  await requireAdmin();
  const id = (await ctx.params).id;
  if (!z.uuid().safeParse(id).success) return new Response("Inválido", { status: 400 });
  const f = await invoiceFile(id);
  if (!f) return new Response("Sem ficheiro", { status: 404 });
  return new Response(new Uint8Array(f.file_data), {
    headers: {
      // Never trust the uploaded type for rendering: only these three are accepted at upload time.
      "Content-Type": ["application/pdf", "image/jpeg", "image/png"].includes(f.file_type) ? f.file_type : "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(f.file_name)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
