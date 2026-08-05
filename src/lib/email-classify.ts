import type { EmailSummary } from "@/lib/gmail-tools";

export type EmailCategory = "human" | "transactional" | "notification" | "newsletter" | "promo" | "invitation";
export type EmailPriority = "high" | "normal" | "low";
export interface TriagedEmail extends EmailSummary { category: EmailCategory; priority: EmailPriority; }

const NOISE_LOCALPARTS = new Set([
  "noreply","no-reply","donotreply","do-not-reply","notification","notifications",
  "news","newsletter","newsletters","marketing","mailer-daemon",
  "alert","alerts","updates","update","digest","careers","jobs",
]);
const TRANSACTIONAL = /réservation|reservation|confirmation|facture|paiement|commande|livraison|échéance|contrat|entretien|candidature|vol\b|billet|virement|reçu|invoice|receipt|booking|order|payment|delivery|deadline|renouvellement|abonnement|compte|sécurité|security/i;
const URGENT = /urgent|action requise|dernier rappel|avant le|avant demain|avant ce soir|sous 24 ?h|expire|aujourd'hui|demain|asap|deadline|relance|last chance|expiring/i;

const CRITICAL_STRONG = /impayé|mise en demeure|prélèvement|retard de paiement|avis d'échéance|échéance|mensualité|recouvrement|huissier|rejet de paiement|solde dû|facture n|dossier n|montant dû|payment due|overdue|amount due|final notice|direct debit/i;
const REGLEMENT_AMBIGUOUS = /règlement/i;           // payment OR regulation
const REGLEMENT_COSIGNAL = /dossier|facture|n°|n° ?\d|€|eur\b|compte client/i;

function isCriticalFinancial(text: string): boolean {
  return CRITICAL_STRONG.test(text)
    || (REGLEMENT_AMBIGUOUS.test(text) && REGLEMENT_COSIGNAL.test(text));
}

export function extractSenderEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function classifyBase(email: EmailSummary, knownContactEmails: Set<string>): TriagedEmail {
  const sender = extractSenderEmail(email.from);
  const localPart = sender.split("@")[0];
  const labels = new Set(email.labelIds);
  const text = `${email.subject} ${email.snippet}`;
  const important = labels.has("IMPORTANT");

  if (knownContactEmails.has(sender))
    return { ...email, category: "human", priority: "high" };

  const isInvite = /^(invitation|invitation mise à jour|updated invitation|annulé : |canceled event)/i.test(email.subject)
    || sender === "calendar-notification@google.com"
    || sender.endsWith("@group.calendar.google.com");
  if (isInvite) return { ...email, category: "invitation", priority: "normal" };

  // Money/administrative matters beat bulk-mail markers — banks and credit
  // companies send critical notices with List-Unsubscribe headers.
  if (isCriticalFinancial(text))
    return { ...email, category: "transactional", priority: "high" };
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

export type SenderRuleAction = "always_show" | "mute";

// Sender rules are checked first (computed here, before the known-contact check
// even runs) but applied last: the normal classification always runs so category
// is unaffected, only priority is overridden — a muted newsletter is still a
// "newsletter", it just won't surface; an always_show one keeps its category too.
export function classifyOne(
  email: EmailSummary,
  knownContactEmails: Set<string>,
  rules: Map<string, SenderRuleAction> = new Map(),
): TriagedEmail {
  const sender = extractSenderEmail(email.from);
  const ruleHit = rules.get(sender) ?? rules.get(sender.split("@")[1] ?? "");

  const base = classifyBase(email, knownContactEmails);
  if (ruleHit === "always_show") return { ...base, priority: "high" };
  if (ruleHit === "mute") return { ...base, priority: "low" };
  return base;
}

// Display name for a sender: the header's display name, falling back to the domain.
function senderDisplayName(from: string): string {
  const m = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(from);
  const name = m?.[1]?.trim();
  if (name) return name;
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  return email.split("@")[1] ?? email;
}

// "Upstream ×6, Medium, Twitch" — up to 4 distinct senders, "…" if more.
export function formatNoiseSenders(noise: TriagedEmail[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const e of noise) {
    const name = senderDisplayName(e.from);
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const top = order.slice(0, 4).map((name) => {
    const n = counts.get(name)!;
    return n > 1 ? `${name} ×${n}` : name;
  });
  let result = top.join(", ");
  if (order.length > 4) result += "…";
  return result;
}
