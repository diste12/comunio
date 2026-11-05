"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { parseOnboardingCsv } from "@/lib/onboarding/csv";
import { isValidNif, normalizePtPhone } from "@/lib/pt/nif";
import { addResident, createCondominium, DuplicateCondominiumNifError, removeResident, updateCondominiumSettings, updateResident } from "@/lib/services/onboarding";
import type { ActionState } from "../actions";

export type OnboardingField = "name" | "nif" | "iban" | "file" | "csv";
export type OnboardingState = {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<OnboardingField, string>>;
  errors?: string[];
  warnings?: string[];
} | null;

const opt = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);
const iban = z.string().regex(/^PT50\d{21}$/, "IBAN português inválido (PT50 + 21 dígitos)");

export async function createCondominiumAction(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  await requireAdmin();
  const name = opt(form.get("name"));
  const nif = opt(form.get("nif"));
  const ibanValue = opt(form.get("iban"))?.replace(/\s/g, "").toUpperCase() ?? null;
  const fieldErrors: Partial<Record<OnboardingField, string>> = {};
  if (!name) fieldErrors.name = "Indique o nome do condomínio.";
  if (!nif) fieldErrors.nif = "Indique o NIF do condomínio.";
  else if (!isValidNif(nif)) fieldErrors.nif = "NIF inválido. Verifique os 9 dígitos.";
  if (ibanValue && !iban.safeParse(ibanValue).success) fieldErrors.iban = "IBAN inválido (PT50 + 21 dígitos).";
  const file = form.get("file");
  const csvField = file instanceof File && file.size > 0 ? "file" : "csv";
  let csv: string;
  try {
    csv = csvField === "file" ? await (file as File).text() : String(form.get("csv") ?? "");
  } catch {
    fieldErrors.file = "Não foi possível ler o ficheiro CSV. Selecione-o novamente.";
    return { ok: false, message: "Corrija os campos assinalados.", fieldErrors };
  }
  const parsed = parseOnboardingCsv(csv);
  if (parsed.errors.length > 0 || parsed.fractions.length === 0) {
    fieldErrors[csvField] = "Corrija os dados das frações indicados abaixo.";
  }
  if (!name || !nif || Object.keys(fieldErrors).length > 0) {
    return {
      ok: false, message: "Corrija os campos assinalados. Os dados introduzidos foram mantidos.", fieldErrors,
      errors: parsed.errors, warnings: parsed.warnings,
    };
  }
  let id: string;
  try {
    ({ id } = await createCondominium(
      { name, nif, address: opt(form.get("address")), postalCode: opt(form.get("postalCode")), city: opt(form.get("city")), iban: ibanValue },
      parsed.fractions,
    ));
  } catch (e) {
    const dbError = e as { code?: string; constraint_name?: string };
    if (e instanceof DuplicateCondominiumNifError || (dbError.code === "23505" && dbError.constraint_name === "condominiums_nif_condominio_key")) {
      return { ok: false, message: "Corrija o NIF do condomínio.", fieldErrors: { nif: `Já existe um condomínio com o NIF ${nif}.` } };
    }
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath("/admin");
  redirect(`/admin/condominiums/${id}`);
}

const intOrNull = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable());

export async function saveSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().parse(form.get("condominiumId"));
  const ibanValue = opt(form.get("iban"))?.replace(/\s/g, "").toUpperCase() ?? null;
  if (ibanValue && !iban.safeParse(ibanValue).success) return { ok: false, message: "IBAN inválido (PT50 + 21 dígitos)." };
  const ids = z.object({ company: intOrNull, docSet: intOrNull, product: intOrNull }).safeParse({
    company: form.get("moloniCompanyId"), docSet: form.get("moloniDocumentSetId"), product: form.get("moloniProductId"),
  });
  if (!ids.success) return { ok: false, message: "Os identificadores Moloni têm de ser números." };
  await updateCondominiumSettings(id, {
    iban: ibanValue,
    ifthenpayMbKey: opt(form.get("ifthenpayMbKey")),
    ifthenpayMbwayKey: opt(form.get("ifthenpayMbwayKey")),
    moloniCompanyId: ids.data.company, moloniDocumentSetId: ids.data.docSet, moloniProductId: ids.data.product,
    saltedgeConnectionId: opt(form.get("saltedgeConnectionId")),
    saltedgeAccountId: opt(form.get("saltedgeAccountId")),
  });
  revalidatePath(`/admin/condominiums/${id}`);
  return { ok: true, message: "Definições guardadas." };
}

const residentSchema = z.object({
  fullName: z.string().trim().min(2),
  phone: z.string(),
  email: z.email().or(z.literal("")),
  nif: z.string().trim().refine((v) => v === "" || isValidNif(v), "NIF inválido"),
});

export async function updateResidentAction(condominiumId: string, residentId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = residentSchema.safeParse(Object.fromEntries(form));
  const phone = parsed.success ? normalizePtPhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return { ok: false, message: parsed.success ? "Telemóvel inválido." : parsed.error.issues[0].message };
  await updateResident(z.uuid().parse(residentId), {
    fullName: parsed.data.fullName, phone, email: parsed.data.email || null, nif: parsed.data.nif || null,
    emailConsent: form.get("emailConsent") === "on",
  });
  revalidatePath(`/admin/condominiums/${condominiumId}/residentes`);
  return { ok: true, message: "Guardado." };
}

export async function addResidentAction(condominiumId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = residentSchema.omit({ nif: true }).safeParse(Object.fromEntries(form));
  const phone = parsed.success ? normalizePtPhone(parsed.data.phone) : null;
  const role = z.enum(["Proprietário", "Inquilino"]).safeParse(form.get("role"));
  const fractionId = z.uuid().safeParse(form.get("fractionId"));
  if (!parsed.success || !phone || !role.success || !fractionId.success) return { ok: false, message: "Verifique nome, telemóvel e fração." };
  await addResident(fractionId.data, {
    fullName: parsed.data.fullName, phone, email: parsed.data.email || null, role: role.data, emailConsent: form.get("emailConsent") === "on",
  });
  revalidatePath(`/admin/condominiums/${condominiumId}/residentes`);
  return { ok: true, message: "Residente adicionado." };
}

export async function removeResidentAction(condominiumId: string, residentId: string): Promise<ActionState> {
  await requireAdmin();
  await removeResident(z.uuid().parse(residentId));
  revalidatePath(`/admin/condominiums/${condominiumId}/residentes`);
  return { ok: true, message: "Removido." };
}
