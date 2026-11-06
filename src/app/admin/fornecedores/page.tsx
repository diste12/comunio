import { DataTable } from "@/components/data-table";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { listVendors } from "@/lib/services/rfps";
import { Card, Skeleton, td, th } from "@/components/ui";
import { VendorForm } from "./_form";

export const metadata = { title: "Fornecedores" };

export default function VendorsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fornecedores</h1>
      <Suspense fallback={<Skeleton />}>
        <Vendors />
      </Suspense>
    </div>
  );
}

async function Vendors() {
  await requireAdmin();
  const vendors = await listVendors();
  return (
    <>
      <Card title="Novo fornecedor"><VendorForm /></Card>
      <Card title={`${vendors.length} fornecedores`}>
        <div className="-m-4 overflow-x-auto">
          <DataTable id="vendors">
            <thead className="border-b border-stone-100 bg-stone-50">
              <tr><th className={th}>Nome</th><th className={th}>NIF</th><th className={th}>Contacto</th><th className={th}>Especialidades</th><th className={`${th} text-right`}>Convites</th><th className={`${th} text-right`}>Adjudicações</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {vendors.map((v) => (
                <tr data-row-id={v.id} key={v.id}>
                  <td className={`${td} font-medium`}>{v.name}</td>
                  <td className={`${td} font-mono text-xs`}>{v.nif ?? "—"}</td>
                  <td className={`${td} text-xs`}>{v.email}{v.phone_number && <div>+{v.phone_number}</div>}</td>
                  <td className={`${td} text-xs`}>{v.categories.join(", ") || "Geral"}</td>
                  <td className={`${td} text-right tabular-nums`}>{v.invitations}</td>
                  <td className={`${td} text-right tabular-nums`}>{v.wins}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </Card>
    </>
  );
}
