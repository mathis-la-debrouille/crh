import type { EmailSummary } from "@/lib/gmail-tools";

export type EmailCategory = "human" | "transactional" | "notification" | "newsletter" | "promo";
export type EmailPriority = "high" | "normal" | "low";
export interface TriagedEmail extends EmailSummary { category: EmailCategory; priority: EmailPriority; }

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

export function classifyOne(email: EmailSummary, knownContactEmails: Set<string>): TriagedEmail {
  const sender = extractSenderEmail(email.from);
  const localPart = sender.split("@")[0];
  const labels = new Set(email.labelIds);
  const text = `${email.subject} ${email.snippet}`;
  const important = labels.has("IMPORTANT");

  if (knownContactEmails.has(sender))
    return { ...email, category: "human", priority: "high" };
  if (labels.has("CATEGORY_PROMOTIONS"))
    return { ...email, category: "promo", priority: "low" };
  if (labels.has("CATEGORY_SOCIAL") || labels.has("CATEGORY_FORUMS"))
    return { ...email, category: "notification", priority: "low" };
  if (labels.has("CATEGORY_UPDATES") && email.listUnsubscribe)
    return { ...email, category: "notification", priority: "low" };
  if (email.listUnsubscribe || email.precedenceBulk)
    return { ...email, category: "newsletter", priority: "low" };
  if (NOISE_LOCALPARTS.has(localPart)) {
    if (TRANSACTIONAL.test(text))
      return { ...email, category: "transactional", priority: URGENT.test(text) || important ? "high" : "normal" };
    return { ...email, category: "notification", priority: "low" };
  }
  if (TRANSACTIONAL.test(text))
    return { ...email, category: "transactional", priority: URGENT.test(text) || important ? "high" : "normal" };
  return { ...email, category: "human", priority: URGENT.test(text) || important ? "high" : "normal" };
}
