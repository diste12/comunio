import { Children, isValidElement, type ReactNode, type ReactElement } from "react";
import type { Row, RowAction, Value } from "./model";
type Props = { children?: ReactNode; className?: string; colSpan?: number; label?: string; bulk?: boolean; action?: RowAction["run"]; "data-value"?: Value; "data-row-id"?: string };
const elements = (nodes: ReactNode) => Children.toArray(nodes).filter(isValidElement) as ReactElement<Props>[];
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (!isValidElement<Props>(node)) return "";
  return node.props.label ?? textOf(node.props.children);
}
function actionsOf(node: ReactNode): RowAction[] {
  return elements(node).flatMap(el => el.props.action && el.props.label && el.props.bulk !== false ? [{ label: el.props.label, run: el.props.action }] : actionsOf(el.props.children));
}
export function normalizeTable(children: ReactNode) {
  const sections = elements(children);
  const head = sections.find(el => el.type === "thead");
  const body = sections.find(el => el.type === "tbody");
  const headers = elements(elements(head?.props.children)[0]?.props.children);
  const columns = headers.map((h, i) => ({ id: `c${i}`, label: textOf(h.props.children).trim() || "Ações" }));
  const rows: Row[] = elements(body?.props.children).flatMap((row, i) => {
    const cells = elements(row.props.children);
    if (cells.some(c => (c.props.colSpan ?? 1) > 1)) return [];
    return [{ id: row.props["data-row-id"] ?? String(row.key ?? i), className: row.props.className, cells,
      values: cells.map(c => c.props["data-value"] ?? (typeof c.props.children === "number" ? c.props.children : textOf(c.props.children).trim())), actions: actionsOf(row.props.children) }];
  });
  return { columns, rows };
}
