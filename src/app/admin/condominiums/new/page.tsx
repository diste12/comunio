import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { ONBOARDING_TEMPLATE } from "@/lib/onboarding/csv";
import { Card, Skeleton } from "@/components/ui";
import { NewCondominiumForm } from "./_form";

export const metadata = { title: "Novo condomínio" };
export const maxDuration = 600;

export default function NewCondominiumPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Novo condomínio</h1>
      <Suspense fallback={<Skeleton />}>
        <Gate />
      </Suspense>
    </div>
  );
}

async function Gate() {
  const admin = await requireAdmin();
  return (
    <Card>
      <NewCondominiumForm template={ONBOARDING_TEMPLATE} draftKey={`comunio:onboarding:${admin.userId}`} />
      <p className="mt-3 text-xs text-stone-500">
        A permilagem tem de somar 1000‰ (título constitutivo). O telemóvel é obrigatório para o WhatsApp. O consentimento para
        convocatórias por email (Lei n.º 8/2022) fica registado com data; sem ele, as convocatórias seguem por carta registada.
      </p>
    </Card>
  );
}
