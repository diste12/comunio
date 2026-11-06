// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewCondominiumForm } from "@/app/admin/condominiums/new/_form";
import { createCondominiumAction } from "@/app/admin/condominiums/actions";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push }),
}));
vi.mock("@/app/admin/condominiums/actions", () => ({ createCondominiumAction: vi.fn() }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); });

describe("condominium form validation", () => {
  it.each(["nif", "iban", "csv", "file", "server"] as const)("keeps all entered values after a %s error", async (invalidField) => {
    vi.mocked(createCondominiumAction).mockResolvedValue({
      ok: false, message: "Corrija os dados.",
      fieldErrors: invalidField === "server" ? undefined : { [invalidField]: "Valor inválido." },
    });
    const user = userEvent.setup();
    const { container } = render(createElement(NewCondominiumForm, { template: "original CSV", draftKey: "test-admin" }));
    const values = {
      name: "Edifício Teste", nif: "12345", address: "Rua do Teste 9",
      postalCode: "1000-001", city: "Lisboa", iban: "PT5000000000000000000000000", csv: "edited CSV",
    };
    for (const [name, value] of Object.entries(values)) {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
      await user.clear(input);
      await user.type(input, value);
    }
    const file = new File(["uploaded CSV"], "fractions.csv", { type: "text/csv" });
    const upload = container.querySelector<HTMLInputElement>('[name="file"]')!;
    await user.upload(upload, file);
    await user.click(screen.getByRole("button", { name: "Criar condomínio" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false));
    for (const [name, value] of Object.entries(values)) {
      expect(container.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value, name).toBe(value);
    }
    expect(upload.files?.[0]).toBe(file);
    if (invalidField !== "server") {
      const input = container.querySelector<HTMLInputElement>(`[name="${invalidField}"]`)!;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(`${invalidField}-error`);
      expect(document.activeElement).toBe(input);
    }
    // Correct only one field and resubmit: the rest of the draft and the File survive again.
    const nif = container.querySelector<HTMLInputElement>('[name="nif"]')!;
    await user.clear(nif);
    await user.type(nif, "55555");
    await user.click(screen.getByRole("button", { name: "Criar condomínio" }));
    await waitFor(() => expect(createCondominiumAction).toHaveBeenCalledTimes(2));
    const submitted = vi.mocked(createCondominiumAction).mock.calls[1][1];
    expect(submitted.get("nif")).toBe("55555");
    expect(submitted.get("name")).toBe(values.name);
    expect(submitted.get("csv")).toBe(values.csv);
    await waitFor(() => expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false));
    expect(nif.value).toBe("55555");
    expect(upload.files?.[0]).toBe(file);
  });

  it("keeps the form mounted and editable after a network timeout", async () => {
    vi.mocked(createCondominiumAction).mockRejectedValue(new Error("Failed to fetch"));
    const user = userEvent.setup();
    render(createElement(NewCondominiumForm, { template: "CSV draft", draftKey: "test-admin" }));
    await user.type(screen.getByLabelText("Nome"), "My building");
    await user.type(screen.getByLabelText("NIF do condomínio"), "55555");
    await user.click(screen.getByRole("button", { name: "Criar condomínio" }));
    expect((await screen.findByRole("alert")).textContent).toContain("tempo limite");
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("My building");
    expect((screen.getByLabelText("NIF do condomínio") as HTMLInputElement).value).toBe("55555");
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
  });

  it("restores all text and uploaded CSV contents after remounting", async () => {
    const user = userEvent.setup();
    const props = { template: "original", draftKey: "test-admin" };
    const first = render(createElement(NewCondominiumForm, props));
    const values = { name: "Saved building", nif: "55555", address: "Rua 1", postalCode: "1000-001", city: "Lisboa", iban: "PT50", csv: "pasted CSV" };
    for (const [name, value] of Object.entries(values)) {
      const input = first.container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      await user.clear(input); await user.type(input, value);
    }
    await user.upload(first.container.querySelector<HTMLInputElement>('[name="file"]')!, new File(["fracao;permilagem\nA;1000"], "saved.csv", { type: "text/csv" }));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("test-admin")!).upload.text).toBe("fracao;permilagem\nA;1000"));
    first.unmount();
    const second = render(createElement(NewCondominiumForm, props));
    await screen.findByRole("status");
    for (const [name, value] of Object.entries(values)) {
      expect(second.container.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value).toBe(name === "csv" ? "fracao;permilagem\nA;1000" : value);
    }
    expect(second.container.querySelector<HTMLInputElement>('[name="file"]')!.files?.length).toBe(0);
  });

  it("does not restore another admin's draft", async () => {
    sessionStorage.setItem("other-admin", JSON.stringify({ savedAt: Date.now(), values: { name: "Private draft" } }));
    render(createElement(NewCondominiumForm, { template: "original", draftKey: "test-admin" }));
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("");
  });

  it("expires old drafts", () => {
    sessionStorage.setItem("test-admin", JSON.stringify({ savedAt: Date.now() - 25 * 60 * 60 * 1000, values: { name: "Old draft" } }));
    render(createElement(NewCondominiumForm, { template: "original", draftKey: "test-admin" }));
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("");
    expect(sessionStorage.getItem("test-admin")).toBeNull();
  });

  it("clears the draft and navigates only after confirmed creation", async () => {
    vi.mocked(createCondominiumAction).mockResolvedValue({ ok: true, message: "Created", redirectTo: "/admin/condominiums/created" });
    const user = userEvent.setup();
    render(createElement(NewCondominiumForm, { template: "CSV", draftKey: "test-admin" }));
    await user.type(screen.getByLabelText("Nome"), "Saved building");
    await user.type(screen.getByLabelText("NIF do condomínio"), "55555");
    expect(sessionStorage.getItem("test-admin")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Criar condomínio" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/condominiums/created"));
    expect(sessionStorage.getItem("test-admin")).toBeNull();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });
});
