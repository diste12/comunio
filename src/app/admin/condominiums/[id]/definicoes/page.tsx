import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { Card, Skeleton } from "@/components/ui";
import { SettingsForm } from "./_form";

export const metadata = { title: "Definições do condomínio" };

export default function SettingsPage({ params }: PageProps<"/admin/condominiums/[id]/definicoes">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: { params: PageProps<"/admin/condominiums/[id]/definicoes">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [c] = await sql<{
    name: string; bank_iban_current: string | null; ifthenpay_mb_key: string | null; ifthenpay_mbway_key: string | null;
    moloni_company_id: number | null; moloni_document_set_id: number | null; moloni_product_id: number | null;
    saltedge_connection_id: string | null; saltedge_account_id: string | null;
  }[]>`select * from condominiums where id = ${id}`;
  if (!c) notFound();
  const s = (v: string | number | null) => (v == null ? "" : String(v));
  return (
    <div className="space-y-4">
      <div>
        <Link href={`/admin/condominiums/${id}`} className="text-xs text-stone-500 hover:underline">← {c.name}</Link>
        <h1 className="mt-1 text-xl font-semibold">Definições</h1>
      </div>
      <Card>
        <SettingsForm
          condominiumId={id}
          values={{
            iban: s(c.bank_iban_current), ifthenpayMbKey: s(c.ifthenpay_mb_key), ifthenpayMbwayKey: s(c.ifthenpay_mbway_key),
            moloniCompanyId: s(c.moloni_company_id), moloniDocumentSetId: s(c.moloni_document_set_id), moloniProductId: s(c.moloni_product_id),
            saltedgeConnectionId: s(c.saltedge_connection_id), saltedgeAccountId: s(c.saltedge_account_id),
          }}
        />
      </Card>
    </div>
  );
}
