import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { appendTranscript } from "@/lib/services/assemblies";
import { transcribeAudio } from "@/lib/services/transcription";

export const maxDuration = 300;

/**
 * Upload meeting audio → Whisper → appended to the assembly transcript.
 * Note: Vercel caps request bodies at 4.5 MB; longer recordings must be split
 * client-side (or uploaded to Supabase Storage first — see README).
 */
export async function POST(req: Request, ctx: RouteContext<"/admin/assemblies/[id]/transcricao">) {
  await requireAdmin();
  const id = z.uuid().parse((await ctx.params).id);
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Sem ficheiro de áudio." }, { status: 400 });
  try {
    const { text, mock } = await transcribeAudio(file);
    await appendTranscript(id, text);
    return Response.json({ ok: true, mock, chars: text.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
