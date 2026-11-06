import { beforeEach, it, expect, vi } from "vitest";
import { bulkEdit } from "@/components/data-table/mutations";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
const { tx } = vi.hoisted(() => ({ tx: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: { begin: vi.fn(async (fn) => fn(tx)) } }));
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin", email: null }); tx.mockResolvedValue([{ id }]); });
it("requires admin authorization before any bulk write", async () => {
  vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("unauthorized"));
  await expect(bulkEdit({ kind: "tickets", ids: [id], value: "CLOSED" })).rejects.toThrow("unauthorized");
  expect(sql.begin).not.toHaveBeenCalled();
});
it.each([
  { kind: "tickets", ids: [id], value: "INVALID" },
  { kind: "condominiums", ids: [id], value: " " },
  { kind: "tickets", ids: ["bad"], value: "OPEN" },
  { kind: "tickets", ids: Array(501).fill(id), value: "OPEN" },
  { kind: "unknown", ids: [id], value: "OPEN" },
])("rejects malformed or unbounded bulk edits", async input => {
  expect((await bulkEdit(input)).ok).toBe(false); expect(sql.begin).not.toHaveBeenCalled();
});
it.each(["tickets", "condominiums"])("updates only selected %s and deduplicates IDs", async kind => {
  expect((await bulkEdit({ kind, ids: [id, id], value: kind === "tickets" ? "OPEN" : "Lisboa" })).ok).toBe(true);
  expect(sql.begin).toHaveBeenCalledOnce(); expect(tx.mock.calls[0][0]).toEqual([id]);
});
it("throws inside the transaction on a stale selection so all changes roll back", async () => {
  tx.mockResolvedValue([]);
  expect((await bulkEdit({ kind: "tickets", ids: [id], value: "OPEN" })).ok).toBe(false);
  await expect(vi.mocked(sql.begin).mock.results[0].value).rejects.toThrow("stale selection");
});
