import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { env, isClerkConfigured } from "./env";
import { adminConfigMissing } from "./setup";

export type Admin = { userId: string; email: string | null };

export function devBypassActive(): boolean {
  return !isClerkConfigured() && process.env.NODE_ENV !== "production" && process.env.COMUNIO_DEV_AUTH_BYPASS === "1";
}

/**
 * Gate for every admin page and server action. Proxy only does the optimistic
 * redirect; this is the authoritative check (close to the data).
 */
export async function requireAdmin(): Promise<Admin> {
  // Always a request-time check, never evaluated during prerendering.
  await connection();
  if (devBypassActive()) return { userId: "dev", email: "dev@localhost" };
  // Missing deployment configuration: explain instead of crashing (still fail closed).
  if (adminConfigMissing().length > 0) redirect("/setup");

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const allowed = env()
    .ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) {
    return { userId, email: null }; // dev only: production is caught by adminConfigMissing()
  }
  const user = await currentUser();
  const emails = user?.emailAddresses.map((e) => e.emailAddress.toLowerCase()) ?? [];
  const match = emails.find((e) => allowed.includes(e));
  if (!match) redirect("/sign-in?unauthorized=1");
  return { userId, email: match };
}
