import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

let client: OpenAI | null | undefined;

/** OpenAI client, or null when no key is configured (rule-based fallbacks apply). */
export function llm(): OpenAI | null {
  if (client === undefined) client = env().OPENAI_API_KEY ? new OpenAI({ apiKey: env().OPENAI_API_KEY }) : null;
  return client;
}
