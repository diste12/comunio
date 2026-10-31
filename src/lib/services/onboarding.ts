import "server-only";
import { sql } from "@/lib/db";
import type { OnboardingFraction } from "@/lib/onboarding/csv";

export type CondoInput = {
  name: string;
  nif: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  iban: string | null;
};

export async function createCondominium(condo: CondoInput, fractions: OnboardingFraction[]) {
  const [dup] = await sql`select 1 from condominiums where nif_condominio = ${condo.nif}`;
  if (dup) throw new Error(`Já existe um condomínio com o NIF ${condo.nif}.`);
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      insert into condominiums ${tx({
        name: condo.name, nif_condominio: condo.nif, address: condo.address, postal_code: condo.postalCode,
        city: condo.city, bank_iban_current: condo.iban,
      })} returning id`;
    const inserted = await tx<{ id: string; designation: string }[]>`
      insert into fractions ${tx(fractions.map((f) => ({ condominium_id: c.id, designation: f.designation, permilagem: f.permilagem.toFixed(2) })))}
      returning id, designation`;
    const idOf = new Map(inserted.map((f) => [f.designation, f.id]));
    const residents = fractions.flatMap((f) =>
      f.residents.map((r) => ({
        fraction_id: idOf.get(f.designation)!, full_name: r.fullName, phone_number: r.phone, email: r.email, nif: r.nif,
        role: r.role, has_recorded_email_consent: r.emailConsent, email_consent_recorded_at: r.emailConsent ? new Date() : null,
      })),
    );
    if (residents.length > 0) await tx`insert into residents ${tx(residents)}`;
    return { id: c.id, fractions: inserted.length, residents: residents.length };
  });
}

export type CondoSettings = {
  iban: string | null;
  ifthenpayMbKey: string | null;
  ifthenpayMbwayKey: string | null;
  moloniCompanyId: number | null;
  moloniDocumentSetId: number | null;
  moloniProductId: number | null;
  saltedgeConnectionId: string | null;
  saltedgeAccountId: string | null;
};

export async function updateCondominiumSettings(id: string, s: CondoSettings) {
  await sql`
    update condominiums set
      bank_iban_current = ${s.iban}, ifthenpay_mb_key = ${s.ifthenpayMbKey}, ifthenpay_mbway_key = ${s.ifthenpayMbwayKey},
      moloni_company_id = ${s.moloniCompanyId}, moloni_document_set_id = ${s.moloniDocumentSetId}, moloni_product_id = ${s.moloniProductId},
      saltedge_connection_id = ${s.saltedgeConnectionId}, saltedge_account_id = ${s.saltedgeAccountId}
    where id = ${id}`;
}

export type ResidentRow = {
  id: string; fraction_id: string; designation: string; full_name: string; phone_number: string; email: string | null;
  nif: string | null; role: "Proprietário" | "Inquilino"; has_recorded_email_consent: boolean; email_consent_recorded_at: Date | null;
};

export async function listResidents(condominiumId: string) {
  return sql<ResidentRow[]>`
    select r.id, r.fraction_id, f.designation, r.full_name, r.phone_number, r.email, r.nif, r.role,
           r.has_recorded_email_consent, r.email_consent_recorded_at
    from residents r join fractions f on f.id = r.fraction_id
    where f.condominium_id = ${condominiumId} order by f.designation, r.role, r.full_name`;
}

export async function updateResident(id: string, r: { fullName: string; phone: string; email: string | null; nif: string | null; emailConsent: boolean }) {
  const consent = r.emailConsent && Boolean(r.email);
  await sql`
    update residents set full_name = ${r.fullName}, phone_number = ${r.phone}, email = ${r.email}, nif = ${r.nif},
      has_recorded_email_consent = ${consent},
      email_consent_recorded_at = case when ${consent}::bool then coalesce(email_consent_recorded_at, now()) else null end
    where id = ${id}`;
}

export async function addResident(fractionId: string, r: { fullName: string; phone: string; email: string | null; role: "Proprietário" | "Inquilino"; emailConsent: boolean }) {
  const consent = r.emailConsent && Boolean(r.email) && r.role === "Proprietário";
  await sql`
    insert into residents ${sql({
      fraction_id: fractionId, full_name: r.fullName, phone_number: r.phone, email: r.email, role: r.role,
      has_recorded_email_consent: consent, email_consent_recorded_at: consent ? new Date() : null,
    })}`;
}

export async function removeResident(id: string) {
  await sql`delete from residents where id = ${id}`;
}
