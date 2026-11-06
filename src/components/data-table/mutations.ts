"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
export type EditKind = "tickets" | "condominiums";
const request = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tickets"), ids: z.array(z.uuid()).min(1).max(500), value: z.enum(["OPEN", "IN_PROGRESS", "AWAITING_QUOTES", "RESOLVED", "CLOSED"]) }),
  z.object({ kind: z.literal("condominiums"), ids: z.array(z.uuid()).min(1).max(500), value: z.string().trim().min(1).max(100) }),
]);
export async function bulkEdit(input: unknown) {
  await requireAdmin();
  const parsed = request.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Seleção ou valor inválido (máximo 500 registos)." };
  const data = parsed.data;
  try {
    const count = await sql.begin(async tx => {
      const ids = [...new Set(data.ids)];
      const rows = data.kind === "tickets"
        ? await tx`update maintenance_tickets set status = ${data.value}, updated_at = now() where id in ${tx(ids)} returning id`
        : await tx`update condominiums set city = ${data.value} where id in ${tx(ids)} returning id`;
      if (rows.length !== ids.length) throw new Error("stale selection");
      return rows.length;
    });
    revalidatePath("/admin", "layout");
    return { ok: true, message: `${count} registos atualizados.` };
  } catch { return { ok: false, message: "Não foi possível atualizar a seleção. Recarregue e tente novamente. Nenhum registo foi alterado." }; }
}
