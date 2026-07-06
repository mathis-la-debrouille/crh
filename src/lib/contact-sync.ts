import { searchEmails, readEmail } from "@/lib/gmail-tools";
import { getValidAccessToken } from "@/lib/google";
import { getConnectedAccounts } from "@/lib/accounts";
import { upsertContact } from "@/lib/contacts";
import { prisma } from "@/lib/prisma";

export async function syncContactsFromSent(userId: string): Promise<void> {
  const accounts = await getConnectedAccounts(userId);
  let totalSynced = 0;

  for (const acct of accounts) {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(acct.id);
    } catch {
      continue;
    }

    const sent = await searchEmails(accessToken, "in:sent -to:me", 50);
    if (sent.length === 0) continue;

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
      } catch {}
    }

    for (const [email, info] of Array.from(recipientMap)) {
      if (isJunkEmail(email)) continue;

      const allText = info.bodies.join(" ");
      const register = detectRegister(allText);
      const toneNotes = deriveToneNotes(info.bodies);

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
        preferredAccountId: acct.id,
      });

      totalSynced++;
    }
  }

  console.log(`[contact-sync] synced ${totalSynced} contacts for user ${userId} across ${accounts.length} account(s)`);
}

const JUNK_DOMAINS = /\b(noreply|no-reply|mailer|bounce|unsub|unsubscribe|newsletter|notifications?|alerts?|updates?|info|support|donotreply|do-not-reply|postmaster|daemon|mailchimp|sendgrid|mailgun|brevo|beehiiv|substack|hubspot|salesforce|marketo|pardot)\b/i;
const JUNK_LOCAL_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}|^[0-9a-f]{32}$/i;

function isJunkEmail(email: string): boolean {
  const [local, domain] = email.split("@");
  if (!local || !domain) return true;
  if (JUNK_DOMAINS.test(domain)) return true;
  if (JUNK_DOMAINS.test(local)) return true;
  if (JUNK_LOCAL_PATTERN.test(local)) return true;
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
  const allText = bodies.join(" ").toLowerCase();
  if (/bonjour|hello|salut|coucou/.test(allText)) {
    const g = allText.match(/\b(bonjour|hello|salut|coucou)\b/)?.[1];
    if (g) notes.push(`salutation: "${g}"`);
  }
  if (/cordialement|bien à vous/.test(allText)) notes.push("ton formel");
  else if (/bonne journée|à bientôt|à\+|bisou/.test(allText)) notes.push("ton chaleureux");
  return notes.length > 0 ? notes.join(", ") : null;
}

export async function syncAllContacts(): Promise<void> {
  const users = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT userId as id FROM EmailAccount WHERE connected = 1
  `;
  for (const u of users) {
    await syncContactsFromSent(u.id).catch((err) =>
      console.error("[contact-sync] error for", u.id, err)
    );
  }
}
