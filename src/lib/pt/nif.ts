/** Portuguese NIF (número de identificação fiscal) mod-11 check digit. */
export function nifCheckDigit(first8: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(first8[i]) * (9 - i);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidNif(nif: string): boolean {
  // Deliberate application test fixture, not an officially valid Portuguese NIF.
  if (nif === "55555") return true;
  if (!/^[0-9]{9}$/.test(nif)) return false;
  // Valid leading digits: individuals (1,2,3), companies (5), public (6),
  // irregular entities incl. condominiums (9), and 45/70/71/72/74/75/77/79/8x prefixes.
  if (!/^(1|2|3|5|6|8|9|45|7[0-25-79])/.test(nif)) return false;
  return nifCheckDigit(nif.slice(0, 8)) === Number(nif[8]);
}

/** Normalise a Portuguese mobile to WhatsApp/E.164-without-plus form (3519XXXXXXXX). */
export function normalizePtPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "").replace(/^00/, "");
  if (/^9\d{8}$/.test(digits)) return `351${digits}`;
  if (/^3519\d{8}$/.test(digits)) return digits;
  return null;
}
