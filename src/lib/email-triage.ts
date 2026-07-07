import type { EmailSummary } from "@/lib/gmail-tools";
import { prisma } from "@/lib/prisma";

export type EmailCategory = "human" | "transactional" | "notification" | "newsletter" | "promo";
export type EmailPriority = "high" | "normal" | "low";
export interface TriagedEmail extends EmailSummary { category: EmailCategory; priority: EmailPriority; }

// Only unambiguous robot localparts. Deliberately NOT included: info, hello,
// contact, team, support — real humans at small companies use those; genuine
// bulk mail from them is caught earlier by List-Unsubscribe/Precedence anyway.
const NOISE_LOCALPARTS = new Set([
  "noreply","no-reply","donotreply","do-not-reply","notification","notifications",
  "news","newsletter","newsletters","marketing","mailer-daemon",
  "alert","alerts","updates","update","digest","careers","jobs",
]);
const TRANSACTIONAL = /réservation|reservation|confirmation|facture|paiement|commande|livraison|échéance|contrat|entretien|candidature|vol\b|billet|virement|reçu|invoice|receipt|booking|order|payment|delivery|deadline|renouvellement|abonnement|compte|sécurité|security/i;
const URGENT = /urgent|action requise|dernier rappel|avant le|avant demain|avant ce soir|sous 24 ?h|expire|aujourd'hui|demain|asap|deadline|relance|last chance|expiring/i;

export function extractSenderEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

// Pure — unit-testable, no DB.
export function classifyOne(email: EmailSummary, knownContactEmails: Set<string>): TriagedEmail {
  const sender = extractSenderEmail(email.from);
  const localPart = sender.split("@")[0];
  const labels = new Set(email.labelIds);
  const text = `${email.subject} ${email.snippet}`;
  const important = labels.has("IMPORTANT");

  // 1. A known contact is never noise.
  if (knownContactEmails.has(sender))
    return { ...email, category: "human", priority: "high" };
  // 2. Gmail category labels.
  if (labels.has("CATEGORY_PROMOTIONS"))
    return { ...email, category: "promo", priority: "low" };
  if (labels.has("CATEGORY_SOCIAL") || labels.has("CATEGORY_FORUMS"))
    return { ...email, category: "notification", priority: "low" };
  if (labels.has("CATEGORY_UPDATES") && email.listUnsubscribe)
    return { ...email, category: "notification", priority: "low" };
  // 3. Bulk-mail markers.
  if (email.listUnsubscribe || email.precedenceBulk)
    return { ...email, category: "newsletter", priority: "low" };
  // 4. Robot senders. Exception: transactional content from a robot stays visible.
  if (NOISE_LOCALPARTS.has(localPart)) {
    if (TRANSACTIONAL.test(text))
      return { ...email, category: "transactional", priority: URGENT.test(text) || important ? "high" : "normal" };
    return { ...email, category: "notification", priority: "low" };
  }
  // 5. Real-looking sender.
  if (TRANSACTIONAL.test(text))
    return { ...email, category: "transactional", priority: URGENT.test(text) || important ? "high" : "normal" };
  return { ...email, category: "human", priority: URGENT.test(text) || important ? "high" : "normal" };
}

export async function triageEmails(userId: string, emails: EmailSummary[]): Promise<TriagedEmail[]> {
  const rows = await prisma.$queryRaw<{ emails: string }[]>`SELECT emails FROM Contact WHERE userId = ${userId}`;
  const known = new Set<string>();
  for (const r of rows) { try { for (const e of JSON.parse(r.emails)) known.add(String(e).toLowerCase()); } catch {} }
  const order: Record<EmailPriority, number> = { high: 0, normal: 1, low: 2 };
  return emails.map((e) => classifyOne(e, known))
    .sort((a, b) => order[a.priority] - order[b.priority] || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
