// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableClient } from "@/components/data-table/table-client";
import type { Row } from "@/components/data-table/model";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), unstable_rethrow: () => {} }));
vi.mock("@/components/data-table/mutations", () => ({ bulkEdit: vi.fn() }));
const columns = [{ id: "c0", label: "Nome" }, { id: "c1", label: "Valor" }];
const success = vi.fn(async () => ({ ok: true, message: "OK" }));
const failure = vi.fn(async () => ({ ok: false, message: "Falhou" }));
const rows: Row[] = ["Ana", "Bia"].map((name, i) => ({ id: name, values: [name, i + 1], cells: [h("td", { key: "name" }, name), h("td", { key: "value" }, i + 1)], actions: [{ label: "Processar", run: i ? failure : success }] }));
const mount = (owner = "admin") => render(h(TableClient, { id: "test", owner, columns, rows }));
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, "", "/"); vi.clearAllMocks(); });
describe("interactive tables", () => {
  it("limits bulk actions to visible selection, confirms, and retains failures", async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByLabelText("Selecionar todos os resultados filtrados"));
    await user.selectOptions(screen.getByLabelText("Ação em massa"), "action:Processar");
    await user.click(screen.getByText("Aplicar à seleção"));
    expect(success).not.toHaveBeenCalled();
    await user.click(screen.getByText("Confirmar"));
    await waitFor(() => expect(failure).toHaveBeenCalledOnce());
    expect(success).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("Selecionar Ana") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Selecionar Bia") as HTMLInputElement).checked).toBe(true);
  });
  it("never acts on selected rows hidden by a filter", async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByLabelText("Selecionar todos os resultados filtrados"));
    await user.click(screen.getAllByText("Filtrar")[0]);
    await user.type(screen.getByLabelText("Filtro: Nome"), "Ana");
    await user.selectOptions(screen.getByLabelText("Ação em massa"), "action:Processar");
    await user.click(screen.getByText("Aplicar à seleção")); await user.click(screen.getByText("Confirmar"));
    await waitFor(() => expect(success).toHaveBeenCalledOnce()); expect(failure).not.toHaveBeenCalled();
  });
  it("saves, bookmarks, restores views and isolates admins", async () => {
    const user = userEvent.setup(); const first = mount();
    await user.click(screen.getByText("Colunas")); await user.click(screen.getByLabelText("Valor"));
    await user.type(screen.getByLabelText("Nome da vista"), "Minha vista"); await user.click(screen.getByText("Guardar nova vista"));
    await user.click(screen.getByLabelText("Favorito: Minha vista"));
    await user.click(screen.getByText("Minha vista"));
    expect(window.location.search).toContain("view-test");
    first.unmount(); const second = mount();
    await waitFor(() => expect(screen.getByText("Minha vista")).toBeTruthy());
    expect(screen.queryByRole("columnheader", { name: /Valor/ })).toBeNull();
    second.unmount(); window.history.replaceState(null, "", "/"); mount("other");
    expect(screen.queryByText("Minha vista")).toBeNull();
  });
});
