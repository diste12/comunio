/**
 * Deterministic intent classifier. Used as the offline fallback when no LLM key
 * is configured, and as a guard-rail hint for the LLM agent.
 */

export type Intent = "BILLING" | "MAINTENANCE" | "PORTAL" | "ASSEMBLY" | "GREETING" | "OTHER";

export type Classification = {
  intent: Intent;
  category?: MaintenanceCategory;
  priority?: "NORMAL" | "HIGH" | "URGENT";
};

export const MAINTENANCE_CATEGORIES = [
  "Elevador",
  "Canalização",
  "Eletricidade",
  "Iluminação",
  "Portão/Portas",
  "Limpeza",
  "Estrutura/Fachada",
  "Segurança",
  "Outro",
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

const strip = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`).test(text));

const CATEGORY_WORDS: [MaintenanceCategory, string[]][] = [
  ["Elevador", ["elevador", "ascensor"]],
  ["Canalização", ["fuga", "infiltra", "agua", "cano", "canaliza", "esgoto", "inunda", "humidade", "goteira", "torneira"]],
  ["Iluminação", ["lampada", "luz da escada", "luzes", "ilumina", "escuro"]],
  ["Eletricidade", ["eletric", "electric", "quadro", "disjuntor", "tomada", "curto"]],
  ["Portão/Portas", ["portao", "porta\\b", "portas\\b", "fechadura", "comando", "intercomunicador", "campainha"]],
  ["Limpeza", ["limpeza", "lixo", "sujo", "contentor", "pragas", "barata", "rato"]],
  ["Estrutura/Fachada", ["fachada", "fissura", "racha", "telhado", "cobertura", "reboco", "varanda"]],
  ["Segurança", ["assalt", "roubo", "arromba", "incendio", "extintor", "gas"]],
];

const MAINTENANCE_HINTS = ["avaria", "avariad", "partid", "estragad", "nao funciona", "parad", "problema", "reparar", "arranjar"];
const URGENT = ["inunda", "incendio", "gas", "preso no elevador", "presa no elevador", "curto", "fumo"];

export function classifyMessage(raw: string): Classification {
  const text = strip(raw);
  const category = CATEGORY_WORDS.find(([, words]) => has(text, words))?.[0];
  if (category || has(text, MAINTENANCE_HINTS)) {
    const priority = has(text, URGENT) ? "URGENT" : category === "Elevador" ? "HIGH" : "NORMAL";
    return { intent: "MAINTENANCE", category: category ?? "Outro", priority };
  }
  if (has(text, ["quota", "pagar", "pagamento", "mb ?way", "mbway", "multibanco", "referencia", "divida", "dever", "devo", "saldo", "prestac"])) {
    return { intent: "BILLING" };
  }
  if (has(text, ["recibo", "portal", "link", "acesso", "entrar", "login", "fatura"])) return { intent: "PORTAL" };
  if (has(text, ["assembleia", "reuniao", "ata", "convocatoria"])) return { intent: "ASSEMBLY" };
  if (has(text, ["ola", "bom dia", "boa tarde", "boa noite", "obrigad"])) return { intent: "GREETING" };
  return { intent: "OTHER" };
}
