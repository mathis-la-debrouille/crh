/** Exported separately so it can be unit-tested without mocking the webhook. */

export type ParsedTime = { hours: number; minutes: number };

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
