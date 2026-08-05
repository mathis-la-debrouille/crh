import { prisma } from "@/lib/prisma";
import { classifyOne } from "@/lib/email-classify";
import type { EmailSummary } from "@/lib/gmail-tools";

export type { EmailCategory, EmailPriority, TriagedEmail, SenderRuleAction } from "@/lib/email-classify";
export { classifyOne, extractSenderEmail, formatNoiseSenders } from "@/lib/email-classify";

export async function triageEmails(userId: string, emails: EmailSummary[]) {
  const [contactRows, ruleRows] = await Promise.all([
    prisma.$queryRaw<{ emails: string }[]>`SELECT emails FROM Contact WHERE userId = ${userId}`,
    prisma.$queryRaw<{ pattern: string; action: string }[]>`SELECT pattern, action FROM SenderRule WHERE userId = ${userId}`,
  ]);
  const known = new Set<string>();
  for (const r of contactRows) { try { for (const e of JSON.parse(r.emails)) known.add(String(e).toLowerCase()); } catch {} }
  const rules = new Map<string, "always_show" | "mute">();
  for (const r of ruleRows) rules.set(r.pattern.toLowerCase(), r.action as "always_show" | "mute");

  const order = { high: 0, normal: 1, low: 2 } as const;
  return emails.map((e) => classifyOne(e, known, rules))
    .sort((a, b) => order[a.priority] - order[b.priority] || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
