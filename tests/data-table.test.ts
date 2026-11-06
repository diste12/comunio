import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { applyView, emptyView, emptyFilter, matches, parseView, csvValue, type Row } from "@/components/data-table/model";
import { normalizeTable } from "@/components/data-table/normalize";
const columns = [{ id: "c0", label: "Nome" }, { id: "c1", label: "Valor" }];
const rows: Row[] = [10, 2, -1, 1.11, 1.2].map((n, i) => ({ id: String(i), cells: [], values: [i % 2 ? "Lisboa" : "Porto", n], actions: [] }));
describe("table queries", () => {
  it("sorts raw decimals and negatives numerically in both directions", () => {
    for (const desc of [false, true]) expect(applyView(rows, columns, { ...emptyView(), sort: { column: "c1", desc } }).map(r => r.values[1])).toEqual(desc ? [10, 2, 1.2, 1.11, -1] : [-1, 1.11, 1.2, 2, 10]);
  });
  it("combines column filters with AND and selected values with OR", () => {
    expect(applyView(rows, columns, { ...emptyView(), filters: { c0: { ...emptyFilter(), values: ["Lisboa"] }, c1: { ...emptyFilter(), op: "between", value: "1", end: "2", values: ["2", "1.11"] } } }).map(r => r.values[1])).toEqual([2, 1.11]);
  });
  it("supports dates, empty, case-insensitive text, and exclusion", () => {
    expect(matches("2026-11-06", { ...emptyFilter(), op: "gt", value: "2026-10-01" })).toBe(true);
    expect(matches("2026-11-06T23:59:00Z", { ...emptyFilter(), op: "equals", value: "2026-11-06" })).toBe(true);
    expect(matches("—", { ...emptyFilter(), op: "empty" })).toBe(true);
    expect(matches("Lisboa", { ...emptyFilter(), value: "LIS" })).toBe(true);
    expect(matches("Lisboa", { ...emptyFilter(), op: "not", value: "lisboa" })).toBe(false);
  });
  it("validates stale/invalid saved views and keeps at least one visible column", () => {
    expect(parseView({ hidden: ["c0", "c1", "missing"], sort: { column: "missing" }, filters: { c0: { op: "injected" } } }, columns)).toEqual({ hidden: ["c0"], sort: null, filters: {} });
  });
  it("escapes CSV and neutralizes spreadsheet formulas", () => {
    expect(csvValue('a"b')).toBe('"a""b"'); expect(csvValue("=cmd()")).toBe('"\'=cmd()"');
  });
  it("normalizes nested JSX, stable IDs, typed values and empty states", () => {
    const table = normalizeTable([h("thead", { key: "h" }, h("tr", null, h("th", null, "Amount"))), h("tbody", { key: "b" }, [h("tr", { key: "x", "data-row-id": "uuid" }, h("td", { "data-value": 1.11 }, h("span", null, "1,11 €"))), false, h("tr", { key: "empty" }, h("td", { colSpan: 3 }, "Empty"))])]);
    expect(table.rows).toHaveLength(1); expect(table.rows[0].id).toBe("uuid"); expect(table.rows[0].values).toEqual([1.11]);
  });
});
