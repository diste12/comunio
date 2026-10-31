"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { lisbonWallClockToDate } from "@/lib/dates";
import {
  AssemblyError,
  castVote,
  castVoteForAllPresent,
  closeAssembly,
  createAssembly,
  saveTranscript,
  sendConvocations,
  setAttendance,
  setVotingStatus,
  startSession,
} from "@/lib/services/assemblies";
import { approveMinutes, saveMinutes, upsertDraftMinutes } from "@/lib/services/minutes";
import type { ActionState } from "../actions";

const path = (id: string) => `/admin/assemblies/${id}`;

async function run(id: string, fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    revalidatePath(path(id));
    return { ok: true, message: message || "Feito." };
  } catch (e) {
    if (e instanceof AssemblyError || e instanceof Error) return { ok: false, message: e.message };
    throw e;
  }
}

const createSchema = z.object({
  condominiumId: z.uuid(),
  kind: z.enum(["ORDINARIA", "EXTRAORDINARIA"]),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  secondCallAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).or(z.literal("")),
  location: z.string().trim().min(3),
  onlineUrl: z.url().or(z.literal("")),
});

export async function createAssemblyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Verifique a data, o local e o link." };
  const titles = form.getAll("itemTitle").map(String);
  const majorities = form.getAll("itemMajority").map(String);
  const agenda = titles
    .map((title, i) => ({ title: title.trim(), majority: z.enum(["SIMPLE", "TWO_THIRDS", "UNANIMITY"]).catch("SIMPLE").parse(majorities[i]) }))
    .filter((i) => i.title.length > 0);
  let id: string;
  try {
    id = await createAssembly({
      condominiumId: parsed.data.condominiumId,
      kind: parsed.data.kind,
      scheduledAt: lisbonWallClockToDate(parsed.data.scheduledAt),
      secondCallAt: parsed.data.secondCallAt ? lisbonWallClockToDate(parsed.data.secondCallAt) : null,
      location: parsed.data.location,
      onlineUrl: parsed.data.onlineUrl || null,
      agenda,
    });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  redirect(path(id));
}

export async function sendConvocationsAction(id: string): Promise<ActionState> {
  await requireAdmin();
  return run(id, async () => {
    const r = await sendConvocations(id);
    return `Convocatórias: ${r.email} por email, ${r.registeredMail} por carta registada, ${r.failed} falhadas, ${r.skipped} já enviadas.`;
  });
}

export async function startSessionAction(id: string, call: 1 | 2): Promise<ActionState> {
  await requireAdmin();
  return run(id, () => startSession(id, call));
}

const modeSchema = z.enum(["PRESENT", "ONLINE", "REPRESENTED", "ABSENT"]);

export async function setAttendanceAction(id: string, fractionId: string, mode: string, representative?: string): Promise<ActionState> {
  await requireAdmin();
  const m = modeSchema.parse(mode);
  return run(id, () => setAttendance(id, z.uuid().parse(fractionId), m === "ABSENT" ? null : m, representative?.trim() || null));
}

export async function setVotingStatusAction(id: string, itemId: string, status: "OPEN" | "CLOSED" | "PENDING"): Promise<ActionState> {
  await requireAdmin();
  return run(id, async () => { await setVotingStatus(z.uuid().parse(itemId), status); });
}

const voteSchema = z.enum(["FAVOR", "CONTRA", "ABSTENCAO", "CLEAR"]);

export async function castVoteAction(id: string, itemId: string, fractionId: string, vote: string): Promise<ActionState> {
  await requireAdmin();
  const v = voteSchema.parse(vote);
  return run(id, async () => { await castVote(z.uuid().parse(itemId), z.uuid().parse(fractionId), v === "CLEAR" ? null : v); });
}

export async function castAllAction(id: string, itemId: string, vote: "FAVOR" | "CONTRA" | "ABSTENCAO"): Promise<ActionState> {
  await requireAdmin();
  return run(id, async () => { await castVoteForAllPresent(z.uuid().parse(itemId), vote); });
}

export async function closeAssemblyAction(id: string): Promise<ActionState> {
  await requireAdmin();
  return run(id, () => closeAssembly(id));
}

export async function saveTranscriptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().parse(form.get("assemblyId"));
  return run(id, () => saveTranscript(id, String(form.get("transcript") ?? "")).then(() => "Transcrição guardada."));
}

export async function generateMinutesAction(id: string): Promise<ActionState> {
  await requireAdmin();
  return run(id, () => upsertDraftMinutes(id).then(() => "Rascunho da ata gerado."));
}

export async function saveMinutesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().parse(form.get("assemblyId"));
  return run(id, () => saveMinutes(id, String(form.get("body") ?? "")).then(() => "Ata guardada."));
}

export async function approveMinutesAction(id: string): Promise<ActionState> {
  const admin = await requireAdmin();
  return run(id, () => approveMinutes(id, admin.email ?? admin.userId).then(() => "Ata aprovada e assinada."));
}
