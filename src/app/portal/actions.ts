"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "@/lib/db";
import { endResidentSession, currentResident } from "@/lib/resident-session";
import { requestMbWayForCharge } from "@/lib/services/references";
import { createTicket, isOwner } from "@/lib/services/residents";
import { castOwnerVote, checkInOnline } from "@/lib/services/assemblies";
import { MAINTENANCE_CATEGORIES } from "@/lib/triage/rules";

export type PortalState = { ok: boolean; message: string } | null;

export async function payWithMbWay(chargeId: string): Promise<PortalState> {
  const me = await currentResident();
  if (!me || !isOwner(me)) return { ok: false, message: "Sessão inválida." };
  const [c] = await sql`select 1 from quota_charges where id = ${z.uuid().parse(chargeId)} and fraction_id = ${me.fractionId}`;
  if (!c) return { ok: false, message: "Quota não encontrada." };
  try {
    const r = await requestMbWayForCharge(chargeId);
    return { ok: r.status === "000", message: "Pedido enviado. Confirme na app MB WAY." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const ticketSchema = z.object({
  category: z.enum(MAINTENANCE_CATEGORIES),
  description: z.string().trim().min(5).max(2000),
});

export async function reportIssue(_prev: PortalState, form: FormData): Promise<PortalState> {
  const me = await currentResident();
  if (!me) return { ok: false, message: "Sessão inválida." };
  const parsed = ticketSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Descreva o problema (mínimo 5 caracteres)." };
  await createTicket({
    residentId: me.id, condominiumId: me.condominiumId, fractionId: me.fractionId,
    category: parsed.data.category, description: parsed.data.description, priority: "NORMAL", source: "PORTAL",
  });
  revalidatePath("/portal");
  return { ok: true, message: "Ocorrência registada. Obrigado!" };
}

export async function logout() {
  await endResidentSession();
  redirect("/portal");
}

export async function checkInAction(): Promise<PortalState> {
  const me = await currentResident();
  if (!me || !isOwner(me)) return { ok: false, message: "Só proprietários podem participar." };
  try {
    await checkInOnline(me.condominiumId, me.fractionId);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath("/portal");
  return { ok: true, message: "Presença registada." };
}

export async function voteAction(itemId: string, vote: string): Promise<PortalState> {
  const me = await currentResident();
  if (!me || !isOwner(me)) return { ok: false, message: "Só proprietários podem votar." };
  const v = z.enum(["FAVOR", "CONTRA", "ABSTENCAO"]).safeParse(vote);
  if (!v.success) return { ok: false, message: "Voto inválido." };
  try {
    await castOwnerVote(me.condominiumId, me.fractionId, z.uuid().parse(itemId), v.data);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath("/portal");
  return { ok: true, message: "Voto registado." };
}
