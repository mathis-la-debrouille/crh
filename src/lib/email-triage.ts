import { prisma } from "@/lib/prisma";
import { classifyOne } from "@/lib/email-classify";
import type { EmailSummary } from "@/lib/gmail-tools";

export type { EmailCategory, EmailPriority, TriagedEmail } from "@/lib/email-classify";
export { classifyOne, extractSenderEmail } from "@/lib/email-classify";

export async function triageEmails(userId: string, emails: EmailSummary[]) {
  const rows = await prisma.$queryRaw<{ emails: string }[]>`SELECT emails FROM Contact WHERE userId = ${userId}`;
  const known = new Set<string>();
  for (const r of rows) { try { for (const e of JSON.parse(r.emails)) known.add(String(e).toLowerCase()); } catch {} }
  const order = { high: 0, normal: 1, low: 2 } as const;
  return emails.map((e) => classifyOne(e, known))
    .sort((a, b) => order[a.priority] - order[b.priority] || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
