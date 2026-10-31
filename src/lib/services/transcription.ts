import "server-only";
import { env } from "@/lib/env";
import { llm } from "@/lib/llm";

/** OpenAI's transcription endpoint accepts files up to 25 MB per request. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function transcribeAudio(file: File): Promise<{ text: string; mock: boolean }> {
  if (file.size > MAX_AUDIO_BYTES) throw new Error("Ficheiro acima de 25 MB: divida a gravação em partes.");
  const client = llm();
  if (!client) {
    return {
      mock: true,
      text: `[Transcrição simulada de "${file.name}" — configure OPENAI_API_KEY para usar o Whisper.]`,
    };
  }
  const res = await client.audio.transcriptions.create({
    file,
    model: env().OPENAI_TRANSCRIBE_MODEL,
    language: "pt",
    prompt: "Assembleia de condóminos em Portugal: permilagem, fração, quotas, fundo comum de reserva, ordem de trabalhos.",
  });
  return { text: res.text, mock: false };
}
