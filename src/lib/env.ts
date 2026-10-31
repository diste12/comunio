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

  // Signs resident portal session cookies. Required in production.
  SESSION_SECRET: z.string().min(32).optional(),

  // WhatsApp Cloud API (Meta). "mock" logs messages to the DB only.
  WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default("v23.0"),

  // LLM + speech-to-text (OpenAI). Without a key, rule-based fallbacks are used.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("whisper-1"),

  // Email (Resend). "mock" records a fake message id.
  EMAIL_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Comunio <administracao@comunio.pt>"),

  // Open banking (Salt Edge) for transfer reconciliation. "mock" fabricates transfers.
  BANK_PROVIDER: z.enum(["mock", "saltedge"]).default("mock"),
  SALTEDGE_APP_ID: z.string().optional(),
  SALTEDGE_SECRET: z.string().optional(),

  // Registered mail (CTT). Only a mock exists for now.
  CTT_PROVIDER: z.enum(["mock"]).default("mock"),

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

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me-0123456789";

export function sessionSecret(): string {
  const secret = env().SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return DEV_SESSION_SECRET;
}

export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}
