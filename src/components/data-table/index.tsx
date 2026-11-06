import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { TableClient } from "./table-client";
import { normalizeTable } from "./normalize";
import type { EditKind } from "./mutations";
/** Server adapter keeps existing rich cells and server actions intact. */
export async function DataTable({ id, children, editKind }: { id: string; children: ReactNode; editKind?: EditKind }) {
  const admin = await requireAdmin();
  return <TableClient id={id} owner={admin.userId} editKind={editKind} {...normalizeTable(children)} />;
}
