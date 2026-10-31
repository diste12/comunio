import "server-only";
import { createHash } from "node:crypto";

/**
 * Registered mail (carta registada com aviso de receção) via CTT.
 * Only a mock exists for the sprint: it returns a CTT-format tracking number
 * (RR#########PT, with the UPU S10 check digit) without sending anything.
 */
export async function sendRegisteredLetter(args: {
  recipientName: string;
  address: string;
  pdf: Uint8Array;
  withReceipt?: boolean;
}): Promise<{ tracking: string; provider: "mock" }> {
  const digest = createHash("sha256").update(args.recipientName + args.address + args.pdf.length + Date.now()).digest();
  const serial = String(digest.readUInt32BE(0) % 100_000_000).padStart(8, "0");
  return { tracking: `RR${serial}${s10CheckDigit(serial)}PT`, provider: "mock" };
}

export function s10CheckDigit(serial8: string): number {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = serial8.split("").reduce((s, d, i) => s + Number(d) * weights[i], 0);
  const c = 11 - (sum % 11);
  return c === 10 ? 0 : c === 11 ? 5 : c;
}
