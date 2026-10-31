import "server-only";
import { env } from "@/lib/env";
import type { StatementLine } from "./csv";

const API = "https://www.saltedge.com/api/v5";

/**
 * Salt Edge Account Information API: credit transactions of the condominium's
 * account since a date. TODO before go-live: verify against the current API
 * version with sandbox credentials (written without network access to the docs).
 */
export async function fetchSaltEdgeCredits(connectionId: string, accountId: string, fromDate: string): Promise<StatementLine[]> {
  const e = env();
  if (!e.SALTEDGE_APP_ID || !e.SALTEDGE_SECRET) throw new Error("Salt Edge credentials missing");
  const out: StatementLine[] = [];
  let fromId: string | undefined;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ connection_id: connectionId, account_id: accountId, ...(fromId ? { from_id: fromId } : {}) });
    const res = await fetch(`${API}/transactions?${qs}`, {
      headers: { Accept: "application/json", "Content-Type": "application/json", "App-id": e.SALTEDGE_APP_ID, Secret: e.SALTEDGE_SECRET },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Salt Edge HTTP ${res.status}`);
    const json = (await res.json()) as {
      data: { id: string; made_on: string; amount: number; description: string; extra?: { payer?: string; payee?: string } }[];
      meta?: { next_id?: string | null };
    };
    for (const t of json.data) {
      if (t.amount <= 0 || t.made_on < fromDate) continue;
      out.push({
        externalId: t.id,
        bookedOn: t.made_on,
        description: t.description,
        amountCents: Math.round(t.amount * 100),
        counterpartyName: t.extra?.payer ?? null,
      });
    }
    if (!json.meta?.next_id) break;
    fromId = json.meta.next_id;
  }
  return out;
}
