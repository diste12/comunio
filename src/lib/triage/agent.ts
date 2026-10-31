import "server-only";
import type OpenAI from "openai";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { llm } from "@/lib/llm";
import { formatEur } from "@/lib/money";
import { sendWhatsAppText } from "@/lib/messaging/whatsapp";
import { fmtDateTime } from "@/lib/pdf/document";
import { requestMbWayForCharge } from "@/lib/services/references";
import {
  createMagicLink,
  createTicket,
  isOwner,
  nextAssembly,
  openTicketsForCondominium,
  payableCharges,
  residentsByPhone,
  type ResidentContext,
} from "@/lib/services/residents";
import { ticketRef } from "./ticket-ref";
import { classifyMessage, MAINTENANCE_CATEGORIES, type Intent, type MaintenanceCategory } from "./rules";

const SYSTEM_PROMPT = `És o assistente virtual da administração do condomínio "{CONDO}" (Portugal).
Falas português europeu (PT-PT), com frases curtas e cordiais, adequadas a WhatsApp.

Regras:
- Se o condómino perguntar por quotas, pagamentos ou dívidas, usa consultar_quotas e devolve as referências Multibanco (entidade, referência, valor). Se pedir MB WAY, usa pedir_mbway.
- Se reportar um problema no edifício (fuga, infiltração, elevador, luz, portão, limpeza…), usa abrir_ocorrencia com a categoria certa e confirma o número da ocorrência.
- Para recibos, histórico ou acesso ao portal, usa enviar_link_portal e inclui o link na resposta.
- Nunca inventes valores, datas ou referências: usa apenas o que as ferramentas devolvem.
- Inquilinos não têm acesso a dados financeiros do condomínio nem da fração.
- Não dês aconselhamento jurídico. Se não conseguires ajudar, diz que o administrador irá responder em breve.

Interlocutor: {NAME} ({ROLE}), fração(ões): {FRACTIONS}.`;

export type AgentReply = { text: string; intent: Intent };

/** Entry point for every inbound WhatsApp text. Idempotent on the WhatsApp message id. */
export async function handleInboundWhatsApp(msg: { from: string; id: string; text: string }): Promise<AgentReply | null> {
  const residents = await residentsByPhone(msg.from);
  const primary = residents.find(isOwner) ?? residents[0] ?? null;
  const classification = classifyMessage(msg.text);

  const inserted = await sql`
    insert into whatsapp_messages ${sql({
      resident_id: primary?.id ?? null, phone_number: msg.from, direction: "IN",
      wa_message_id: msg.id, body: msg.text, intent: classification.intent,
    })}
    on conflict (wa_message_id) do nothing returning id`;
  if (inserted.length === 0) return null; // Meta retried a message we already handled

  let reply: AgentReply;
  if (!primary) {
    reply = {
      intent: "OTHER",
      text: "Olá! Não encontrámos este número na nossa base de condóminos. Por favor contacte a administração para atualizar o seu contacto.",
    };
  } else {
    const client = llm();
    reply = client
      ? await runLlmAgent(client, residents, primary, msg.from, msg.text).catch((e) => {
          console.error("[triage] LLM failed, using rules:", (e as Error).message);
          return runRulesAgent(residents, primary, msg.text);
        })
      : await runRulesAgent(residents, primary, msg.text);
  }

  await sendWhatsAppText({ to: msg.from, body: reply.text, residentId: primary?.id, intent: reply.intent });
  return reply;
}

// ---------------------------------------------------------------------------
// Tools — every tool is scoped to the sender's own fractions
// ---------------------------------------------------------------------------

function pickResident(residents: ResidentContext[], primary: ResidentContext, designation?: string) {
  if (!designation) return primary;
  return residents.find((r) => r.designation.toLowerCase() === designation.toLowerCase()) ?? primary;
}

async function toolConsultarQuotas(residents: ResidentContext[], primary: ResidentContext, fracao?: string) {
  const r = pickResident(residents, primary, fracao);
  if (!isOwner(r)) return { erro: "Sem acesso: apenas proprietários podem consultar dados financeiros." };
  const charges = await payableCharges(r.fractionId);
  return {
    fracao: r.designation,
    quotas: charges.map((c) => ({
      quota_id: c.id,
      descricao: c.description,
      vencimento: c.dueDate,
      em_atraso: c.overdue,
      valor: formatEur(c.amountCents),
      multibanco: c.mbReference ? { entidade: c.mbEntity, referencia: c.mbReference } : null,
    })),
    total_em_divida: formatEur(charges.filter((c) => c.overdue).reduce((s, c) => s + c.amountCents, 0)),
  };
}

async function toolPedirMbway(
  residents: ResidentContext[],
  quotaId: string,
): Promise<{ erro: string } | { enviado: boolean; mensagem: string }> {
  const owned = residents.filter(isOwner).map((r) => r.fractionId);
  const [c] = await sql<{ fraction_id: string }[]>`select fraction_id from quota_charges where id = ${quotaId}::uuid`.catch(() => []);
  if (!c || !owned.includes(c.fraction_id)) return { erro: "Quota não encontrada para este condómino." };
  const res = await requestMbWayForCharge(quotaId);
  return { enviado: res.status === "000", mensagem: res.message };
}

async function toolAbrirOcorrencia(
  primary: ResidentContext,
  args: { categoria?: string; descricao?: string; prioridade?: string },
) {
  const category = (MAINTENANCE_CATEGORIES as readonly string[]).includes(args.categoria ?? "") ? args.categoria! : "Outro";
  const priority = (["NORMAL", "HIGH", "URGENT"] as const).find((p) => p === args.prioridade) ?? "NORMAL";
  const t = await createTicket({
    residentId: primary.id, condominiumId: primary.condominiumId, fractionId: primary.fractionId,
    category, description: args.descricao ?? "", priority, source: "WHATSAPP",
  });
  return { numero: ticketRef(t.id), categoria: category, prioridade: priority };
}

async function toolListarOcorrencias(primary: ResidentContext) {
  const tickets = await openTicketsForCondominium(primary.condominiumId, 5);
  return tickets.map((t) => ({ numero: ticketRef(t.id), categoria: t.category, estado: STATUS_PT[t.status] ?? t.status, descricao: t.description }));
}

async function toolProximaAssembleia(primary: ResidentContext) {
  const a = await nextAssembly(primary.condominiumId);
  if (!a) return { assembleia: null };
  return { data: fmtDateTime(a.scheduled_at), local: a.location, online: a.online_url, tipo: a.kind };
}

const STATUS_PT: Record<string, string> = {
  OPEN: "aberta", IN_PROGRESS: "em resolução", AWAITING_QUOTES: "a aguardar orçamentos", RESOLVED: "resolvida", CLOSED: "fechada",
};

// ---------------------------------------------------------------------------
// LLM agent (OpenAI tool calling)
// ---------------------------------------------------------------------------

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "consultar_quotas",
      description: "Quotas por pagar (vencidas e a vencer nos próximos 45 dias) com referências Multibanco. Só proprietários.",
      parameters: { type: "object", properties: { fracao: { type: "string", description: "Designação da fração, se tiver várias" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "pedir_mbway",
      description: "Envia um pedido de pagamento MB WAY para o telemóvel do proprietário, para uma quota.",
      parameters: { type: "object", properties: { quota_id: { type: "string" } }, required: ["quota_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "abrir_ocorrencia",
      description: "Regista uma ocorrência de manutenção nas partes comuns.",
      parameters: {
        type: "object",
        properties: {
          categoria: { type: "string", enum: [...MAINTENANCE_CATEGORIES] },
          descricao: { type: "string", description: "Descrição clara do problema e local" },
          prioridade: { type: "string", enum: ["NORMAL", "HIGH", "URGENT"], description: "URGENT para inundações, gás, pessoas presas" },
        },
        required: ["categoria", "descricao", "prioridade"],
      },
    },
  },
  { type: "function", function: { name: "listar_ocorrencias", description: "Ocorrências recentes do condomínio e respetivo estado.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "enviar_link_portal", description: "Gera um link de acesso pessoal ao portal (recibos, quotas, ocorrências, atas).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "proxima_assembleia", description: "Data e local da próxima assembleia de condóminos.", parameters: { type: "object", properties: {} } } },
];

async function runLlmAgent(
  client: OpenAI,
  residents: ResidentContext[],
  primary: ResidentContext,
  phone: string,
  text: string,
): Promise<AgentReply> {
  const history = await sql<{ direction: "IN" | "OUT"; body: string }[]>`
    select direction, body from (
      select direction, body, created_at from whatsapp_messages
      where phone_number = ${phone} and created_at > now() - interval '24 hours'
      order by created_at desc limit 11
    ) h order by created_at`;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT.replace("{CONDO}", primary.condominiumName)
        .replace("{NAME}", primary.fullName)
        .replace("{ROLE}", primary.role)
        .replace("{FRACTIONS}", residents.map((r) => `${r.designation} (${r.role})`).join(", ")),
    },
    // the current message is already the last IN row of the history
    ...history.map((m) => ({ role: m.direction === "IN" ? ("user" as const) : ("assistant" as const), content: m.body })),
  ];
  if (history.at(-1)?.body !== text) messages.push({ role: "user", content: text });

  let intent: Intent = classifyMessage(text).intent;
  for (let step = 0; step < 5; step++) {
    const res = await client.chat.completions.create({ model: env().OPENAI_MODEL, messages, tools: TOOLS });
    const msg = res.choices[0].message;
    const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
    if (calls.length === 0) return { text: msg.content?.trim() || fallbackHelp(primary), intent };
    messages.push(msg);
    for (const call of calls) {
      const args = safeJson(call.function.arguments);
      let result: unknown;
      switch (call.function.name) {
        case "consultar_quotas": intent = "BILLING"; result = await toolConsultarQuotas(residents, primary, args.fracao); break;
        case "pedir_mbway": intent = "BILLING"; result = await toolPedirMbway(residents, String(args.quota_id ?? "")); break;
        case "abrir_ocorrencia": intent = "MAINTENANCE"; result = await toolAbrirOcorrencia(primary, args); break;
        case "listar_ocorrencias": intent = "MAINTENANCE"; result = await toolListarOcorrencias(primary); break;
        case "enviar_link_portal": intent = "PORTAL"; result = { link: await createMagicLink(primary.id) }; break;
        case "proxima_assembleia": intent = "ASSEMBLY"; result = await toolProximaAssembleia(primary); break;
        default: result = { erro: "ferramenta desconhecida" };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { text: fallbackHelp(primary), intent };
}

function safeJson(s: string): Record<string, string> {
  try { return JSON.parse(s) as Record<string, string>; } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Rules agent (offline fallback)
// ---------------------------------------------------------------------------

async function runRulesAgent(residents: ResidentContext[], primary: ResidentContext, text: string): Promise<AgentReply> {
  const c = classifyMessage(text);
  const first = primary.fullName.split(" ")[0];
  switch (c.intent) {
    case "BILLING": {
      const q = await toolConsultarQuotas(residents, primary);
      if ("erro" in q) return { intent: c.intent, text: `${first}, ${q.erro} Para questões de pagamento, fale com o proprietário da fração.` };
      if (q.quotas.length === 0) return { intent: c.intent, text: `${first}, não tem quotas por pagar na fração ${q.fracao}. Obrigado! ✅` };
      if (/mb ?way/i.test(text)) {
        const target = q.quotas[0];
        const r = await toolPedirMbway(residents, target.quota_id);
        if ("erro" in r) return { intent: c.intent, text: r.erro };
        return { intent: c.intent, text: `Enviámos um pedido MB WAY de ${target.valor} (${target.descricao}). Confirme na app MB WAY nos próximos 4 minutos.` };
      }
      const lines = q.quotas.map(
        (x) => `• ${x.descricao} (${x.em_atraso ? "em atraso" : `vence ${x.vencimento}`}) — ${x.valor}\n  Entidade ${x.multibanco?.entidade} · Ref. ${x.multibanco?.referencia}`,
      );
      return {
        intent: c.intent,
        text: `${first}, estas são as quotas por pagar da fração ${q.fracao}:\n${lines.join("\n")}\n\nPrefere pagar por MB WAY? Responda "MB WAY".`,
      };
    }
    case "MAINTENANCE": {
      const t = await toolAbrirOcorrencia(primary, {
        categoria: c.category as MaintenanceCategory, descricao: text, prioridade: c.priority,
      });
      const urgent = t.prioridade === "URGENT" ? " Marcámos como URGENTE e o administrador foi alertado." : "";
      return { intent: c.intent, text: `Obrigado, ${first}. Registámos a ocorrência ${t.numero} (${t.categoria}).${urgent} Vamos mantê-lo informado.` };
    }
    case "PORTAL": {
      const link = await createMagicLink(primary.id);
      return { intent: c.intent, text: `Aqui está o seu acesso pessoal ao portal (válido 72h): ${link}` };
    }
    case "ASSEMBLY": {
      const a = await toolProximaAssembleia(primary);
      if (!("data" in a)) return { intent: c.intent, text: "De momento não há nenhuma assembleia convocada." };
      return { intent: c.intent, text: `A próxima assembleia é a ${a.data}, em ${a.local}.${a.online ? ` Participação online: ${a.online}` : ""}` };
    }
    default:
      return { intent: c.intent, text: fallbackHelp(primary) };
  }
}

function fallbackHelp(r: ResidentContext): string {
  const first = r.fullName.split(" ")[0];
  const billing = isOwner(r) ? "• consultar quotas e referências Multibanco / MB WAY\n" : "";
  return `Olá ${first}! Sou o assistente do ${r.condominiumName}. Posso ajudar a:\n${billing}• reportar um problema no prédio\n• enviar o link do seu portal\n• saber a data da próxima assembleia`;
}
