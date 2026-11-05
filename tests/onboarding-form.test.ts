// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewCondominiumForm } from "@/app/admin/condominiums/new/_form";
import { createCondominiumAction } from "@/app/admin/condominiums/actions";

vi.mock("@/app/admin/condominiums/actions", () => ({ createCondominiumAction: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("condominium form validation", () => {
  it.each(["nif", "iban", "csv", "file", "server"] as const)("keeps all entered values after a %s error", async (invalidField) => {
    vi.mocked(createCondominiumAction).mockResolvedValue({
      ok: false, message: "Corrija os dados.",
      fieldErrors: invalidField === "server" ? undefined : { [invalidField]: "Valor inválido." },
    });
    const user = userEvent.setup();
    const { container } = render(createElement(NewCondominiumForm, { template: "original CSV" }));
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
});
