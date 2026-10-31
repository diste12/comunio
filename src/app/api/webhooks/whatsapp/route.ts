import { after, connection, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/http/secrets";
import { parseInbound, verifyMetaSignature } from "@/lib/messaging/whatsapp";
import { handleInboundWhatsApp } from "@/lib/triage/agent";

/** Meta webhook verification handshake. */
export async function GET(req: NextRequest) {
  await connection(); // always per request, never prerendered
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && safeEqual(p.get("hub.verify_token"), env().WHATSAPP_VERIFY_TOKEN)) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

/** Inbound messages: acknowledge immediately, triage after the response. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const messages = parseInbound(payload);
  if (messages.length > 0) {
    after(async () => {
      for (const m of messages) {
        await handleInboundWhatsApp({ from: m.from, id: m.id, text: m.text }).catch((e) =>
          console.error(`[whatsapp] ${m.id}: ${(e as Error).message}`),
        );
      }
    });
  }
  return Response.json({ received: messages.length });
}
