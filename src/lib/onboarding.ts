/** Exported separately so it can be unit-tested without mocking the webhook. */

import { localToRFC3339 } from "@/lib/calendar-tools";

export type ParsedTime = { hours: number; minutes: number };

// True when a message looks like an actual request (something to look up or act
// on) rather than a greeting or a self-introduction. Used during onboarding to
// decide whether to answer first and ask for a profile later (never the reverse).
export function isRequestLike(body: string): boolean {
  const b = body.trim().toLowerCase();
  if (/^(salut|hello|hi|hey|bonjour|coucou|yo|hola)[\s!.?]*$/i.test(b)) return false;
  if (/\b(je suis|moi c'est|mon métier|je travaille|je m'appelle)\b/i.test(b)) return false;
  return /mails?|mes messages|agenda|calendrier|brief|rdv|rendez-vous|détail|résume|cherche|liste|quoi de neuf|whatsup|reçu/i.test(b) || b.endsWith("?");
}

// Next morning at 09:30 in the user's timezone, as an absolute instant.
export function nextMorning930(tz: string, now: Date = new Date()): Date {
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const [y, m, d] = todayLocal.split("-").map(Number);
  const tomorrowUtcAnchor = new Date(Date.UTC(y, m - 1, d + 1));
  const tomorrowLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(tomorrowUtcAnchor);
  return new Date(localToRFC3339(`${tomorrowLocal}T09:30:00`, tz));
}

export function parseTime(body: string): ParsedTime | "skip" | null {
  if (/plus tard|skip|non|pas maintenant/i.test(body)) return "skip";

  // "8h30", "8h", "18h05", "9:15"
  const hRe = /(?:^|\s)(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?:\s|$)/i;
  const mH = hRe.exec(body);
  if (mH) {
    const h = parseInt(mH[1], 10);
    const m = mH[2] !== undefined ? parseInt(mH[2], 10) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return { hours: h, minutes: m };
  }

  // "8am", "8 pm"
  const ampmRe = /(\d{1,2})\s*(am|pm)/i;
  const mAP = ampmRe.exec(body);
  if (mAP) {
    let h = parseInt(mAP[1], 10);
    const ap = mAP[2].toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) return { hours: h, minutes: 0 };
  }

  return null;
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}
