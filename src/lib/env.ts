import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Payments (Ifthenpay). "mock" works without credentials.
  PAYMENTS_PROVIDER: z.enum(["mock", "ifthenpay"]).default("mock"),
  IFTHENPAY_ANTI_PHISHING_KEY: z.string().optional(),
  IFTHENPAY_MB_EXPIRY_DAYS: z.coerce.number().int().min(0).default(30),

  // Billing (Moloni). "mock" works without credentials.
  BILLING_PROVIDER: z.enum(["mock", "moloni"]).default("mock"),
  MOLONI_CLIENT_ID: z.string().optional(),
  MOLONI_CLIENT_SECRET: z.string().optional(),
  MOLONI_USERNAME: z.string().optional(),
  MOLONI_PASSWORD: z.string().optional(),

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  CRON_SECRET: z.string().optional(),

  // Comma-separated emails allowed into /admin (required in production).
  ADMIN_EMAILS: z.string().default(""),

  // Local-only escape hatch when Clerk keys are not configured. Ignored in production.
  COMUNIO_DEV_AUTH_BYPASS: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}
