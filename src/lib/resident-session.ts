import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { sessionSecret } from "@/lib/env";
import { residentById, type ResidentContext } from "@/lib/services/residents";
import { sign, verify } from "@/lib/tokens";

const COOKIE = "comunio_resident";
const TTL_DAYS = 30;

type Session = { rid: string; exp: number };

export async function startResidentSession(residentId: string) {
  const exp = Date.now() + TTL_DAYS * 86_400_000;
  (await cookies()).set(COOKIE, sign({ rid: residentId, exp } satisfies Session, sessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(exp),
  });
}

export async function endResidentSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentResident(): Promise<ResidentContext | null> {
  await connection();
  const s = verify<Session>((await cookies()).get(COOKIE)?.value, sessionSecret());
  if (!s || s.exp < Date.now()) return null;
  return residentById(s.rid);
}
