/**
 * Parse a bank statement export (CSV) as produced by Portuguese home-banking:
 * `;` or `,` separated, dates dd-mm-yyyy or yyyy-mm-dd, amounts "1.234,56".
 * Detects the date / description / amount (or credit) / payer columns by header.
 */
export type StatementLine = { externalId: string; bookedOn: string; description: string; amountCents: number; counterpartyName: string | null };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[€\s]/g, "");
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseDate(raw: string): string | null {
  const pt = /^(\d{2})[-/.](\d{2})[-/.](\d{4})/.exec(raw);
  if (pt) return `${pt[3]}-${pt[2]}-${pt[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function parseStatementCsv(text: string): StatementLine[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitLine(lines[0], sep).map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col("data valor", "data mov", "data", "date");
  const iDesc = col("descri", "movimento", "description", "detalhe");
  const iCredit = col("credito", "credit");
  const iAmount = col("montante", "valor", "amount", "importancia");
  const iPayer = col("ordenante", "nome", "payer", "contraparte");
  if (iDate < 0 || iDesc < 0 || (iCredit < 0 && iAmount < 0)) throw new Error("Cabeçalho não reconhecido: são precisas colunas de data, descrição e valor.");

  const out: StatementLine[] = [];
  for (const [n, line] of lines.slice(1).entries()) {
    const cells = splitLine(line, sep);
    const bookedOn = parseDate(cells[iDate] ?? "");
    const amountCents = parseAmount(cells[iCredit >= 0 ? iCredit : iAmount] ?? "");
    if (!bookedOn || amountCents === null || amountCents <= 0) continue; // debits and blank lines
    const description = cells[iDesc] ?? "";
    out.push({
      externalId: `${bookedOn}|${amountCents}|${description}|${n}`.slice(0, 128),
      bookedOn,
      description,
      amountCents,
      counterpartyName: iPayer >= 0 && iPayer !== iDesc ? cells[iPayer] || null : null,
    });
  }
  return out;
}
