import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCondominiumAction } from "@/app/admin/condominiums/actions";
import { createCondominium } from "@/lib/services/onboarding";
import { ONBOARDING_TEMPLATE } from "@/lib/onboarding/csv";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/services/onboarding", () => ({
  createCondominium: vi.fn(), DuplicateCondominiumNifError: class extends Error {},
}));

const form = (values: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: "Teste", nif: "501442600", csv: ONBOARDING_TEMPLATE, ...values })) data.set(key, value);
  return data;
};
beforeEach(() => vi.resetAllMocks());

describe("createCondominiumAction", () => {
  it("reports every invalid field without attempting a write", async () => {
    const state = await createCondominiumAction(null, form({ name: " ", nif: "12345", iban: "invalid", csv: "bad CSV" }));
    expect(Object.keys(state!.fieldErrors!)).toEqual(["name", "nif", "iban", "csv"]);
    expect(state?.errors?.length).toBeGreaterThan(0);
    expect(createCondominium).not.toHaveBeenCalled();
  });
  it("attaches uploaded CSV errors to the file field", async () => {
    const data = form();
    data.set("file", new File(["bad CSV"], "fractions.csv"));
    const state = await createCondominiumAction(null, data);
    expect(state?.fieldErrors?.file).toBeDefined();
    expect(state?.fieldErrors?.csv).toBeUndefined();
    expect(createCondominium).not.toHaveBeenCalled();
  });
  it("allows the explicit test NIF and retains the successful redirect", async () => {
    vi.mocked(createCondominium).mockResolvedValue({ id: "created-id", fractions: 3, residents: 4 });
    await expect(createCondominiumAction(null, form({ nif: "55555" }))).rejects.toThrow("redirect:/admin/condominiums/created-id");
    expect(createCondominium).toHaveBeenCalledWith(expect.objectContaining({ nif: "55555" }), expect.any(Array));
  });
  it("reports a concurrent duplicate NIF beside the NIF field", async () => {
    vi.mocked(createCondominium).mockRejectedValue({ code: "23505", constraint_name: "condominiums_nif_condominio_key" });
    const state = await createCondominiumAction(null, form());
    expect(state?.fieldErrors?.nif).toContain("Já existe");
  });
  it("returns other save failures to the same form", async () => {
    vi.mocked(createCondominium).mockRejectedValue(new Error("Falha ao guardar."));
    expect(await createCondominiumAction(null, form())).toMatchObject({ ok: false, message: "Falha ao guardar." });
  });
});
