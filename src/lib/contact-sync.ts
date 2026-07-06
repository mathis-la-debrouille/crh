import { searchEmails, readEmail } from "@/lib/gmail-tools";
import { getValidAccessToken } from "@/lib/google";
import { upsertContact } from "@/lib/contacts";
import { prisma } from "@/lib/prisma";

// Mine sent emails to build/enrich contact records.
// Derives: register (tu/vous), toneNotes (avg length, greeting, closing), emailCount, lastInteraction.
export async function syncContactsFromSent(userId: string): Promise<void> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId);
  } catch {
    return;
  }

  const sent = await searchEmails(accessToken, "in:sent -to:me", 50);
  if (sent.length === 0) return;

  // Aggregate by recipient email
  const byEmail = new Map<string, { name: string; count: number; dates: string[]; ids: string[] }>();
  for (const m of sent) {
    // "to" field in our searchEmails returns sender; for sent mails, we need recipient
    // The from field will be the user's own address — skip; we need to look at snippet or read full message
    // Use the id to read a few full messages for the most frequent contacts
    const toMatch = m.from; // in:sent search returns messages where "from" = user; recipient comes from subject/thread context
    // Best approach: bucket by first email address we can extract from the message
    // We'll use a secondary approach: read message for full To header
    byEmail.set(m.id, { name: m.from, count: 1, dates: [m.date], ids: [m.id] });
  }

  // Read up to 10 sent messages to extract To: header and body for style analysis
  const sample = sent.slice(0, 10);
  const recipientMap = new Map<string, { name: string; count: number; bodies: string[]; dates: string[] }>();

  for (const m of sample) {
    try {
      const full = await readEmail(accessToken, m.id);
      if (!full) continue;

      const toHeader = full.to ?? "";
      const toEmails = toHeader.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
      const body = full.body ?? "";

      for (const email of toEmails) {
        const lc = email.toLowerCase();
        const existing = recipientMap.get(lc);
        if (existing) {
          existing.count++;
          existing.bodies.push(body);
          existing.dates.push(m.date);
        } else {
          const nameMatch = toHeader.match(new RegExp(`([^<,]+)<${email.replace(/[.+]/g, "\\$&")}>`, "i"));
          const name = nameMatch ? nameMatch[1].trim().replace(/"/g, "") : email.split("@")[0];
          recipientMap.set(lc, { name, count: 1, bodies: [body], dates: [m.date] });
        }
      }
    } catch {
      // individual read failure is not fatal
    }
  }

  // Upsert contacts with derived style info (skip junk/auto-generated addresses)
  for (const [email, info] of Array.from(recipientMap)) {
    if (isJunkEmail(email)) continue;

    const allText = info.bodies.join(" ");
    const register = detectRegister(allText);
    const toneNotes = deriveToneNotes(info.bodies);

    // Fix: sort once, take last element — never call pop() twice
    const sortedDates = [...info.dates].sort();
    const lastDateStr = sortedDates[sortedDates.length - 1];
    const lastDate = lastDateStr ? new Date(lastDateStr) : undefined;
    const lastInteraction = lastDate && !isNaN(lastDate.getTime()) ? lastDate : undefined;

    await upsertContact(userId, {
      displayName: info.name,
      emails: [email],
      register: register ?? undefined,
      toneNotes: toneNotes ?? undefined,
      lastInteraction,
      emailCount: info.count,
    });
  }

  console.log(`[contact-sync] synced ${recipientMap.size} contacts for user ${userId}`);
}

const JUNK_DOMAINS = /\b(noreply|no-reply|mailer|bounce|unsub|unsubscribe|newsletter|notifications?|alerts?|updates?|info|support|donotreply|do-not-reply|postmaster|daemon|mailchimp|sendgrid|mailgun|brevo|beehiiv|substack|hubspot|salesforce|marketo|pardot)\b/i;
const JUNK_LOCAL_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}|^[0-9a-f]{32}$/i; // UUID-like local parts

function isJunkEmail(email: string): boolean {
  const [local, domain] = email.split("@");
  if (!local || !domain) return true;
  if (JUNK_DOMAINS.test(domain)) return true;
  if (JUNK_DOMAINS.test(local)) return true;
  if (JUNK_LOCAL_PATTERN.test(local)) return true;
  // Local part with + contains UUID-like segments (e.g. unsubscribe tokens)
  if (local.includes("+") && /[0-9a-f]{8}-[0-9a-f]{4}/.test(local)) return true;
  return false;
}

function detectRegister(text: string): "tu" | "vous" | null {
  const tuMatches = (text.match(/\b(tu|ton|ta|tes|toi|t'|te )\b/gi) ?? []).length;
  const vousMatches = (text.match(/\b(vous|votre|vos|vôtre)\b/gi) ?? []).length;
  if (tuMatches === 0 && vousMatches === 0) return null;
  return tuMatches >= vousMatches ? "tu" : "vous";
}

function deriveToneNotes(bodies: string[]): string | null {
  if (bodies.length === 0) return null;
  const notes: string[] = [];

  const avgLen = Math.round(bodies.reduce((s, b) => s + b.length, 0) / bodies.length);
  if (avgLen < 200) notes.push("messages courts");
  else if (avgLen > 800) notes.push("messages longs");

  // Common greetings
  const allText = bodies.join(" ").toLowerCase();
  if (/bonjour|hello|salut|coucou/.test(allText)) {
    const g = allText.match(/\b(bonjour|hello|salut|coucou)\b/)?.[1];
    if (g) notes.push(`salutation: "${g}"`);
  }

  // Common closings
  if (/cordialement|bien à vous/.test(allText)) notes.push("ton formel");
  else if (/bonne journée|à bientôt|à\+|bisou/.test(allText)) notes.push("ton chaleureux");

  return notes.length > 0 ? notes.join(", ") : null;
}

export async function syncAllContacts(): Promise<void> {
  const users = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM User WHERE googleConnected = 1
  `;
  for (const u of users) {
    await syncContactsFromSent(u.id).catch((err) =>
      console.error("[contact-sync] error for", u.id, err)
    );
  }
}
