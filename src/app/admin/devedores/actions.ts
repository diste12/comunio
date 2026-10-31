"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sendPreLitigationLetter } from "@/lib/services/collections";
import type { ActionState } from "../actions";

export async function sendLetterAction(fractionId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    const tracking = await sendPreLitigationLetter(z.uuid().parse(fractionId), admin.email ?? admin.userId);
    revalidatePath("/admin/devedores");
    return { ok: true, message: `Carta registada ${tracking}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
