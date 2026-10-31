import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type Block =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; bold?: boolean }
  | { type: "small"; text: string }
  | { type: "spacer"; size?: number }
  | { type: "table"; columns: { label: string; width: number; align?: "left" | "right" }[]; rows: string[][] }
  | { type: "signature"; lines: string[] };

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const WIDTH = A4[0] - MARGIN * 2;

const REPLACEMENTS: Record<string, string> = {
  "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "✓": "v", " ": " ", " ": " ", " ": " ", "\t": "  ",
};

/** Standard PDF fonts are WinAnsi: keep Portuguese text, map or drop the rest. */
function sanitizer(font: PDFFont) {
  const ok = new Map<string, boolean>();
  return (text: string) =>
    Array.from(text)
      .map((ch) => REPLACEMENTS[ch] ?? ch)
      .join("")
      .split("")
      .filter((ch) => {
        if (ch === "\n") return true;
        if (!ok.has(ch)) {
          try { font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); }
        }
        return ok.get(ch);
      })
      .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderPdf(blocks: Block[], opts: { footer?: string; title?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (opts.title) doc.setTitle(opts.title);
  doc.setProducer("Comunio");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = sanitizer(regular);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const ensure = (h: number) => {
    if (y - h < MARGIN + 20) {
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };
  const text = (s: string, x: number, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(s, { x, y, size, font, color });

  const flow = (s: string, size: number, font: PDFFont, gap = 4, color?: ReturnType<typeof rgb>) => {
    for (const line of wrap(clean(s), font, size, WIDTH)) {
      ensure(size + gap);
      y -= size + gap;
      text(line, MARGIN, size, font, color);
    }
  };

  for (const b of blocks) {
    switch (b.type) {
      case "title":
        flow(b.text, 16, bold, 6);
        y -= 8;
        break;
      case "heading":
        y -= 8;
        flow(b.text, 11.5, bold, 5);
        y -= 2;
        break;
      case "paragraph":
        flow(b.text, 10, b.bold ? bold : regular, 4.5);
        y -= 5;
        break;
      case "small":
        flow(b.text, 8, regular, 3, rgb(0.4, 0.4, 0.4));
        y -= 4;
        break;
      case "spacer":
        y -= b.size ?? 12;
        break;
      case "table": {
        const size = 8.5;
        const xs: number[] = [];
        let acc = MARGIN;
        for (const c of b.columns) { xs.push(acc); acc += c.width * WIDTH; }
        const drawRow = (cells: string[], font: PDFFont) => {
          const wrapped = cells.map((c, i) => wrap(clean(c), font, size, b.columns[i].width * WIDTH - 6));
          const h = Math.max(...wrapped.map((w) => w.length)) * (size + 3) + 4;
          ensure(h);
          wrapped.forEach((lines, i) => {
            lines.forEach((line, k) => {
              const col = b.columns[i];
              const w = font.widthOfTextAtSize(line, size);
              const x = col.align === "right" ? xs[i] + col.width * WIDTH - 4 - w : xs[i] + 2;
              page.drawText(line, { x, y: y - (k + 1) * (size + 3), size, font, color: rgb(0.1, 0.1, 0.1) });
            });
          });
          y -= h;
          page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
        };
        drawRow(b.columns.map((c) => c.label), bold);
        for (const r of b.rows) drawRow(r, regular);
        y -= 8;
        break;
      }
      case "signature":
        y -= 18;
        for (const line of b.lines) {
          ensure(40);
          y -= 28;
          page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 220, y }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
          y -= 11;
          text(clean(line), MARGIN, 8.5, regular);
        }
        break;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footer = clean(`${opts.footer ? opts.footer + " · " : ""}Página ${i + 1} de ${pages.length}`);
    p.drawText(footer, { x: MARGIN, y: 30, size: 7.5, font: regular, color: rgb(0.5, 0.5, 0.5) });
  });
  return doc.save();
}

export function pdfResponse(bytes: Uint8Array, filename: string, inline = true): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const dateFmt = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "Europe/Lisbon" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Lisbon" });
const timeFmt = new Intl.DateTimeFormat("pt-PT", { timeStyle: "short", timeZone: "Europe/Lisbon" });
export const fmtTime = (d: Date | string) => timeFmt.format(typeof d === "string" ? new Date(d) : d);
export const fmtDate = (d: Date | string) => dateFmt.format(typeof d === "string" ? new Date(d) : d);
export const fmtDateTime = (d: Date | string) => dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
