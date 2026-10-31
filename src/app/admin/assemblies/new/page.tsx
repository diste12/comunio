import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isoDateFromNow } from "@/lib/dates";
import { Card, Skeleton } from "@/components/ui";
import { NewAssemblyForm } from "./_form";

export const metadata = { title: "Nova assembleia" };

export default function NewAssemblyPage({ searchParams }: PageProps<"/admin/assemblies/new">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <New searchParams={searchParams} />
    </Suspense>
  );
}

async function New({ searchParams }: { searchParams: PageProps<"/admin/assemblies/new">["searchParams"] }) {
  await requireAdmin();
  const condo = (await searchParams).condo;
  if (typeof condo !== "string" || !z.uuid().safeParse(condo).success) notFound();
  const [c] = await sql<{ name: string }[]>`select name from condominiums where id = ${condo}`;
  if (!c) notFound();
  // Default: 3 weeks ahead at 19:00 — comfortably beyond the 10-day notice.
  const defaultDate = `${isoDateFromNow(21)}T19:00`;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Nova assembleia — {c.name}</h1>
      <Card>
        <NewAssemblyForm condominiumId={condo} defaultDate={defaultDate} />
      </Card>
    </div>
  );
}
