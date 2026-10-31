export type InboundText = { from: string; id: string; text: string; name?: string };

/** Extract text messages from a Cloud API webhook payload. */
export function parseInbound(payload: unknown): InboundText[] {
  type Change = {
    value?: {
      contacts?: { wa_id: string; profile?: { name?: string } }[];
      messages?: { from: string; id: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } } }[];
    };
  };
  const entries = (payload as { entry?: { changes?: Change[] }[] })?.entry ?? [];
  const out: InboundText[] = [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const names = new Map((change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of change.value?.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title;
        if (text) out.push({ from: m.from, id: m.id, text, name: names.get(m.from) });
      }
    }
  }
  return out;
}
