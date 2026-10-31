import { describe, expect, it } from "vitest";
import { classifyMessage } from "@/lib/triage/rules";
import { sign, verify } from "@/lib/tokens";

describe("classifyMessage", () => {
  it.each([
    ["Há uma fuga de água na garagem", "MAINTENANCE", "Canalização"],
    ["O elevador está parado outra vez", "MAINTENANCE", "Elevador"],
    ["Quanto devo de quotas?", "BILLING", undefined],
    ["Podem enviar-me a referência MB WAY?", "BILLING", undefined],
    ["Preciso do recibo de março", "PORTAL", undefined],
    ["Pode enviar-me o link do portal?", "PORTAL", undefined],
    ["A porta da entrada não fecha", "MAINTENANCE", "Portão/Portas"],
    ["Quando é a próxima assembleia?", "ASSEMBLY", undefined],
    ["Bom dia", "GREETING", undefined],
  ])("%s → %s", (text, intent, category) => {
    const c = classifyMessage(text);
    expect(c.intent).toBe(intent);
    if (category) expect(c.category).toBe(category);
  });
  it("flags floods as urgent", () => {
    expect(classifyMessage("A cave está inundada!").priority).toBe("URGENT");
  });
});

describe("signed values", () => {
  it("round-trips and rejects tampering", () => {
    const s = sign({ rid: "x", exp: 1 }, "secret");
    expect(verify(s, "secret")).toEqual({ rid: "x", exp: 1 });
    expect(verify(s, "other")).toBeNull();
    expect(verify(s.replace(/^./, "A"), "secret")).toBeNull();
  });
});

import { parseInbound } from "@/lib/messaging/whatsapp-parse";
describe("parseInbound", () => {
  it("extracts text messages from a Cloud API payload", () => {
    const payload = {
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "351912345678", profile: { name: "Ana" } }],
        messages: [
          { from: "351912345678", id: "wamid.1", type: "text", text: { body: "Olá" } },
          { from: "351912345678", id: "wamid.2", type: "image" },
        ],
      } }] }],
    };
    expect(parseInbound(payload)).toEqual([{ from: "351912345678", id: "wamid.1", text: "Olá", name: "Ana" }]);
  });
});
