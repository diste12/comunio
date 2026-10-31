import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailAttachment = { filename: string; content: Buffer };

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  const e = env();
  if (e.EMAIL_PROVIDER !== "resend") return { id: `mock-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
  const { data, error } = await new Resend(e.RESEND_API_KEY).emails.send({
    from: e.EMAIL_FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
    attachments: args.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
  if (error || !data) throw new Error(`Resend: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
