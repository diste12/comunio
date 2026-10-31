/** Postgres numeric comes back as a string ("123.45"); convert without float drift. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const s = typeof value === "number" ? value.toFixed(2) : value.trim();
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Cents → "123.45" (for numeric columns and provider APIs). */
export function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

export function formatEur(cents: number): string {
  return eur.format(cents / 100);
}

/** Parse user input like "10000", "10.000,50" or "10000.50" into cents. */
export function parseEuroInput(input: string): number | null {
  let s = input.replace(/[€\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return toCents(s);
}
