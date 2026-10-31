import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmtDate } from "@/lib/pdf/document";
import { listResidents } from "@/lib/services/onboarding";
import { Card, Skeleton } from "@/components/ui";
import { AddResidentForm, ResidentRow } from "./_rows";

export const metadata = { title: "Residentes" };

export default function ResidentsPage({ params }: PageProps<"/admin/condominiums/[id]/residentes">) {
  return (
    <Suspense fallback={<Skeleton rows={12} />}>
      <Residents params={params} />
    </Suspense>
  );
}

async function Residents({ params }: { params: PageProps<"/admin/condominiums/[id]/residentes">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [c] = await sql<{ name: string }[]>`select name from condominiums where id = ${id}`;
  if (!c) notFound();
  const [residents, fractions] = await Promise.all([
    listResidents(id),
    sql<{ id: string; designation: string }[]>`select id, designation from fractions where condominium_id = ${id} order by designation`,
  ]);
  const owners = residents.filter((r) => r.role === "Proprietário");
  const consented = owners.filter((r) => r.has_recorded_email_consent).length;
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/admin/condominiums/${id}`} className="text-xs text-stone-500 hover:underline">← {c.name}</Link>
        <h1 className="mt-1 text-xl font-semibold">Residentes</h1>
        <p className="text-sm text-stone-600">
          {owners.length} proprietários · {consented} com consentimento para convocatórias por email · {owners.length - consented} recebem carta registada
        </p>
      </div>
      <Card title="Adicionar residente"><AddResidentForm condominiumId={id} fractions={fractions} /></Card>
      <Card title={`${residents.length} residentes`}>
        <div className="-m-4">
          {residents.map((r) => (
            <ResidentRow
              key={r.id}
              condominiumId={id}
              r={{
                id: r.id, designation: r.designation, fullName: r.full_name, phone: r.phone_number, email: r.email ?? "",
                nif: r.nif ?? "", role: r.role, consent: r.has_recorded_email_consent,
                consentAt: r.email_consent_recorded_at ? fmtDate(r.email_consent_recorded_at) : null,
              }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
