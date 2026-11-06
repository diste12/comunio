import { afterAll, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { bulkEdit } from "@/components/data-table/mutations";
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ userId: "test-admin", email: null }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
afterAll(async () => { await sql.end(); });
it("edits exactly the selected buildings and rolls back the entire batch if a row disappeared", async () => {
  const buildings = await sql<{id:string}[]>`insert into condominiums (name,nif_condominio,city) values ('Bulk A','999999991','Porto'),('Bulk B','999999992','Porto') returning id`;
  expect((await bulkEdit({ kind: "condominiums", ids: [buildings[0].id], value: "Lisboa" })).ok).toBe(true);
  expect(await sql`select city from condominiums where id = ${buildings[1].id}`).toEqual([{city:"Porto"}]);
  expect((await bulkEdit({ kind: "condominiums", ids: [buildings[0].id, "00000000-0000-4000-8000-000000000001"], value: "Braga" })).ok).toBe(false);
  expect(await sql`select city from condominiums where id = ${buildings[0].id}`).toEqual([{city:"Lisboa"}]);
});
it("updates selected ticket statuses without changing other tickets", async () => {
  const [building] = await sql`select id from condominiums where nif_condominio = '999999991'`;
  const tickets = await sql<{id:string}[]>`insert into maintenance_tickets (condominium_id,category,description) values (${building.id},'OUTROS','Bulk A'),(${building.id},'OUTROS','Bulk B') returning id`;
  expect((await bulkEdit({ kind: "tickets", ids: [tickets[0].id], value: "RESOLVED" })).ok).toBe(true);
  expect(await sql`select status from maintenance_tickets where id = ${tickets[0].id}`).toEqual([{status:"RESOLVED"}]);
  expect(await sql`select status from maintenance_tickets where id = ${tickets[1].id}`).toEqual([{status:"OPEN"}]);
});
