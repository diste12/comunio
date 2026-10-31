import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/http/secrets";

/**
 * Send a WhatsApp text and log it. Free-form text is only delivered inside the
 * 24h customer-service window (i.e. replies). Business-initiated messages such
 * as magic links need an approved template in production — see sendTemplate.
 */
export async function sendWhatsAppText(args: {
  to: string;
  body: string;
  residentId?: string | null;
  intent?: string | null;
}): Promise<{ id: string | null }> {
  const e = env();
  let id: string | null = null;
  if (e.WHATSAPP_PROVIDER === "meta") {
    const json = await graph({ to: args.to, type: "text", text: { body: args.body.slice(0, 4096), preview_url: true } });
    id = json.messages?.[0]?.id ?? null;
  } else {
    id = `mock-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  await sql`
    insert into whatsapp_messages ${sql({
      resident_id: args.residentId ?? null,
      phone_number: args.to,
      direction: "OUT",
      wa_message_id: id,
      body: args.body,
      intent: args.intent ?? null,
    })}`;
  return { id };
}

/** Business-initiated template message (e.g. "portal_link" with one URL parameter). */
export async function sendWhatsAppTemplate(args: {
  to: string;
  template: string;
  params: string[];
  fallbackBody: string;
  residentId?: string | null;
}) {
  if (env().WHATSAPP_PROVIDER !== "meta") return sendWhatsAppText({ to: args.to, body: args.fallbackBody, residentId: args.residentId, intent: "TEMPLATE" });
  const json = await graph({
    to: args.to,
    type: "template",
    template: {
      name: args.template,
      language: { code: "pt_PT" },
      components: [{ type: "body", parameters: args.params.map((text) => ({ type: "text", text })) }],
    },
  });
  const id = json.messages?.[0]?.id ?? null;
  await sql`
    insert into whatsapp_messages ${sql({
      resident_id: args.residentId ?? null, phone_number: args.to, direction: "OUT",
      wa_message_id: id, body: args.fallbackBody, intent: "TEMPLATE",
    })}`;
  return { id };
}

async function graph(message: Record<string, unknown>): Promise<{ messages?: { id: string }[] }> {
  const e = env();
  if (!e.WHATSAPP_ACCESS_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp credentials missing");
  const res = await fetch(
    `https://graph.facebook.com/${e.WHATSAPP_GRAPH_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...message }),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`WhatsApp send HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Verify Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret) return env().WHATSAPP_PROVIDER === "mock" && process.env.NODE_ENV !== "production";
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(header, expected);
}

export { parseInbound, type InboundText } from "./whatsapp-parse";
